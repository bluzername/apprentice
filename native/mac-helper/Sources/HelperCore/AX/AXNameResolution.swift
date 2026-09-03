import Foundation

/// Where an element's display name came from. Raw values are the exact
/// `nameSource` strings in AxElementSchema.
public enum AXNameSource: String, Equatable {
    /// The hit element's own title, description, or (static text only) value.
    case own = "self"
    /// A labelled child below the hit element, or below the row that contains it.
    case descendant
    /// The nearest titled ancestor.
    case ancestor
}

/// The privacy-safe facts the resolver is allowed to see about one AX node.
/// `staticTextValue` must only be populated for AXStaticText and
/// `textFieldValue` only for AXTextField; the resolver ignores each for every
/// other role as a second line of defence, and only ever uses a text field
/// value under the list-row conditions in `rowTextFieldLabel`.
public struct AXNodeFacts: Equatable {
    public let role: String
    public let subrole: String?
    public let title: String?
    public let description: String?
    public let staticTextValue: String?
    /// AXValue of a plain AXTextField (never a secure field). Read-only list labels only.
    public let textFieldValue: String?
    /// AXFocused. A focused field may be receiving keystrokes, so its value is never used.
    public let isFocused: Bool
    /// True when the field is being edited right now (AXEditable true, or an active field editor).
    public let isEditable: Bool
    /// True when the node's frame contains the point that was hit.
    public let containsPoint: Bool

    public init(role: String, subrole: String? = nil, title: String? = nil, description: String? = nil,
                staticTextValue: String? = nil, textFieldValue: String? = nil, isFocused: Bool = false,
                isEditable: Bool = false, containsPoint: Bool = false) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.staticTextValue = staticTextValue
        self.textFieldValue = textFieldValue
        self.isFocused = isFocused
        self.isEditable = isEditable
        self.containsPoint = containsPoint
    }
}

public struct AXResolvedName: Equatable {
    public let name: String
    public let source: AXNameSource

    public init(name: String, source: AXNameSource) {
        self.name = name
        self.source = source
    }
}

/// Pure name selection over an abstract AX tree. The executable feeds it live
/// AXUIElements through the closures; tests feed it a struct tree.
///
/// Order: own label, labelled descendants of the hit, labelled descendants of
/// the row containing the hit, titled ancestors. Each descendant walk is
/// bounded to `maxDescendantDepth` levels and `maxDescendantNodes` visits.
///
/// Inside a row the label is chosen in this order: a filename-looking label on
/// an image, static text or read-only text field; the first cell's label; the
/// first label found breadth-first.
public struct AXNameResolver<Node> {
    public static var maxDescendantDepth: Int { 3 }
    public static var maxDescendantNodes: Int { 40 }
    public static var maxDescendantNameLength: Int { 120 }
    public static var maxAncestorNameLength: Int { 256 }
    /// How far up a non-row hit may look for the row that contains it.
    public static var maxRowAncestorDistance: Int { 3 }
    /// How deep a container hit (outline, table, list) may look for the row under the point.
    public static var maxRowDescendantDepth: Int { 2 }
    /// Longest text field value that may serve as a list-row label.
    public static var maxTextFieldLabelLength: Int { 120 }
    /// How far above a text field its AXRow or AXCell must sit for the value to count as a list label.
    public static var maxTextFieldRowDistance: Int { 3 }

    private static var labelRoles: Set<String> { ["AXStaticText", "AXTextField", "AXLink", "AXButton", "AXImage"] }
    private static var filenameLabelRoles: Set<String> { ["AXImage", "AXStaticText", "AXTextField"] }
    private static var containerRoles: Set<String> { ["AXOutline", "AXTable", "AXList"] }
    /// Containers whose rows may expose read-only text field values as labels.
    private static var listLabelContainerRoles: Set<String> { ["AXOutline", "AXTable"] }
    private static var rowRole: String { "AXRow" }
    private static var cellRole: String { "AXCell" }
    private static var textFieldRole: String { "AXTextField" }

    private let facts: (Node) -> AXNodeFacts
    private let children: (Node) -> [Node]
    private let parent: (Node) -> Node?

    public init(facts: @escaping (Node) -> AXNodeFacts,
                children: @escaping (Node) -> [Node],
                parent: @escaping (Node) -> Node?) {
        self.facts = facts
        self.children = children
        self.parent = parent
    }

    public func resolve(hit: Node) -> AXResolvedName? {
        let hitFacts = facts(hit)
        if AXRoleMapping.isSecure(axRole: hitFacts.role, subrole: hitFacts.subrole) { return nil }
        if let own = Self.ownLabel(hitFacts, maxLength: Self.maxAncestorNameLength) {
            return AXResolvedName(name: own, source: .own)
        }
        if let listLabel = rowTextFieldLabel(of: hit, facts: hitFacts) {
            return AXResolvedName(name: listLabel, source: .own)
        }
        let isContainer = Self.containerRoles.contains(hitFacts.role)
        let isRowPart = hitFacts.role == Self.rowRole || hitFacts.role == Self.cellRole
        if !isContainer, !isRowPart, let below = descendantLabel(of: hit) {
            return AXResolvedName(name: below, source: .descendant)
        }
        if let row = containingRow(of: hit, hitFacts: hitFacts), let inRow = rowLabel(of: row) {
            return AXResolvedName(name: inRow, source: .descendant)
        }
        if isRowPart, let below = descendantLabel(of: hit) {
            return AXResolvedName(name: below, source: .descendant)
        }
        if let above = ancestorTitle(of: hit) {
            return AXResolvedName(name: above, source: .ancestor)
        }
        return nil
    }

    /// Title, then description, then (static text only) the string value.
    static func ownLabel(_ node: AXNodeFacts, maxLength: Int) -> String? {
        if AXRoleMapping.isSecure(axRole: node.role, subrole: node.subrole) { return nil }
        let candidates = [node.title, node.description, node.role == "AXStaticText" ? node.staticTextValue : nil]
        for candidate in candidates {
            guard let candidate else { continue }
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, trimmed.count <= maxLength { return trimmed }
        }
        return nil
    }

    /// "invoice.pdf", "notes.txt": a dot followed by a 2-5 letter extension at the end.
    static func looksLikeFilename(_ label: String) -> Bool {
        label.range(of: #"\.[A-Za-z]{2,5}$"#, options: .regularExpression) != nil
    }

    /// The value of a read-only text field that acts as a list-view label (Finder
    /// filenames, Mail subjects). Every condition must hold: plain AXTextField,
    /// not secure, not focused, not being edited, inside an AXRow or AXCell of an
    /// AXOutline or AXTable within `maxTextFieldRowDistance` levels, at most
    /// `maxTextFieldLabelLength` characters, single line.
    private func rowTextFieldLabel(of node: Node, facts nodeFacts: AXNodeFacts) -> String? {
        guard nodeFacts.role == Self.textFieldRole,
              !AXRoleMapping.isSecure(axRole: nodeFacts.role, subrole: nodeFacts.subrole),
              !nodeFacts.isFocused, !nodeFacts.isEditable,
              let raw = nodeFacts.textFieldValue else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= Self.maxTextFieldLabelLength,
              value.rangeOfCharacter(from: .newlines) == nil,
              isInsideListRow(node) else { return nil }
        return value
    }

    /// AXRow or AXCell within `maxTextFieldRowDistance` levels above, itself inside an AXOutline or AXTable.
    private func isInsideListRow(_ node: Node) -> Bool {
        var current = node
        for _ in 0..<Self.maxTextFieldRowDistance {
            guard let above = parent(current) else { return false }
            let role = facts(above).role
            if role == Self.rowRole || role == Self.cellRole { return isInsideListContainer(above) }
            current = above
        }
        return false
    }

    private func isInsideListContainer(_ node: Node) -> Bool {
        var current = node
        for _ in 0..<Self.maxTextFieldRowDistance {
            guard let above = parent(current) else { return false }
            if Self.listLabelContainerRoles.contains(facts(above).role) { return true }
            current = above
        }
        return false
    }

    /// Label of a labelled descendant, or a read-only list-row text field value.
    private func descendantOwnLabel(_ node: Node, facts nodeFacts: AXNodeFacts) -> String? {
        guard Self.labelRoles.contains(nodeFacts.role) else { return nil }
        if let label = Self.ownLabel(nodeFacts, maxLength: Self.maxDescendantNameLength) { return label }
        return rowTextFieldLabel(of: node, facts: nodeFacts)
    }

    private struct DescendantLabel {
        let label: String
        let role: String
        /// Index of the row child this label sits under.
        let topIndex: Int
    }

    /// Breadth-first over AXChildren, bounded by depth and node budget. Stops
    /// after the first label unless `collectAll`, which is used by row resolution.
    private func descendantLabels(of root: Node, collectAll: Bool) -> [DescendantLabel] {
        var frontier: [(node: Node, depth: Int, topIndex: Int)] = children(root).enumerated().map { ($0.element, 1, $0.offset) }
        var visited = 0
        var found: [DescendantLabel] = []
        while !frontier.isEmpty, visited < Self.maxDescendantNodes {
            let (node, depth, topIndex) = frontier.removeFirst()
            visited += 1
            let nodeFacts = facts(node)
            if let label = descendantOwnLabel(node, facts: nodeFacts) {
                found.append(DescendantLabel(label: label, role: nodeFacts.role, topIndex: topIndex))
                if !collectAll { return found }
            }
            if depth < Self.maxDescendantDepth {
                frontier.append(contentsOf: children(node).map { ($0, depth + 1, topIndex) })
            }
        }
        return found
    }

    private func descendantLabel(of root: Node) -> String? {
        descendantLabels(of: root, collectAll: false).first?.label
    }

    /// A filename-looking label, else the first cell's label, else the first label found.
    private func rowLabel(of row: Node) -> String? {
        let labels = descendantLabels(of: row, collectAll: true)
        if let filename = labels.first(where: { Self.filenameLabelRoles.contains($0.role) && Self.looksLikeFilename($0.label) }) {
            return filename.label
        }
        if let firstCellIndex = children(row).firstIndex(where: { facts($0).role == Self.cellRole }),
           let inFirstCell = labels.first(where: { $0.topIndex == firstCellIndex }) {
            return inFirstCell.label
        }
        return labels.first?.label
    }

    /// The row that contains the hit: the hit itself, the nearest AXRow above
    /// it, or (for outline/table/list hits) the row under the point.
    private func containingRow(of hit: Node, hitFacts: AXNodeFacts) -> Node? {
        if hitFacts.role == Self.rowRole { return hit }
        if Self.containerRoles.contains(hitFacts.role) { return rowUnderPoint(in: hit) }
        var current = hit
        for _ in 0..<Self.maxRowAncestorDistance {
            guard let above = parent(current) else { return nil }
            let aboveFacts = facts(above)
            if aboveFacts.role == Self.rowRole { return above }
            if Self.containerRoles.contains(aboveFacts.role) { return nil }
            current = above
        }
        return nil
    }

    private func rowUnderPoint(in container: Node) -> Node? {
        var frontier: [(node: Node, depth: Int)] = children(container).map { ($0, 1) }
        var visited = 0
        while !frontier.isEmpty, visited < Self.maxDescendantNodes {
            let (node, depth) = frontier.removeFirst()
            visited += 1
            let nodeFacts = facts(node)
            if nodeFacts.role == Self.rowRole {
                if nodeFacts.containsPoint { return node }
                continue
            }
            if depth < Self.maxRowDescendantDepth {
                frontier.append(contentsOf: children(node).map { ($0, depth + 1) })
            }
        }
        return nil
    }

    private func ancestorTitle(of hit: Node) -> String? {
        var current = hit
        var climbed = 0
        while climbed < ProtocolConstants.maxAncestors, let above = parent(current) {
            climbed += 1
            let aboveFacts = facts(above)
            if let title = aboveFacts.title?.trimmingCharacters(in: .whitespacesAndNewlines),
               !title.isEmpty, title.count <= Self.maxAncestorNameLength {
                return title
            }
            current = above
        }
        return nil
    }
}
