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
/// `staticTextValue` must only be populated for AXStaticText; the resolver
/// ignores it for every other role as a second line of defence.
public struct AXNodeFacts: Equatable {
    public let role: String
    public let subrole: String?
    public let title: String?
    public let description: String?
    public let staticTextValue: String?
    /// True when the node's frame contains the point that was hit.
    public let containsPoint: Bool

    public init(role: String, subrole: String? = nil, title: String? = nil, description: String? = nil,
                staticTextValue: String? = nil, containsPoint: Bool = false) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.staticTextValue = staticTextValue
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
public struct AXNameResolver<Node> {
    public static var maxDescendantDepth: Int { 3 }
    public static var maxDescendantNodes: Int { 40 }
    public static var maxDescendantNameLength: Int { 120 }
    public static var maxAncestorNameLength: Int { 256 }
    /// How far up a non-row hit may look for the row that contains it.
    public static var maxRowAncestorDistance: Int { 3 }
    /// How deep a container hit (outline, table, list) may look for the row under the point.
    public static var maxRowDescendantDepth: Int { 2 }

    private static var labelRoles: Set<String> { ["AXStaticText", "AXTextField", "AXLink", "AXButton", "AXImage"] }
    private static var containerRoles: Set<String> { ["AXOutline", "AXTable", "AXList"] }
    private static var rowRole: String { "AXRow" }

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
        let isContainer = Self.containerRoles.contains(hitFacts.role)
        if !isContainer, let below = descendantLabel(of: hit) {
            return AXResolvedName(name: below, source: .descendant)
        }
        if let row = containingRow(of: hit, hitFacts: hitFacts), let inRow = descendantLabel(of: row) {
            return AXResolvedName(name: inRow, source: .descendant)
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

    /// Breadth-first over AXChildren, bounded by depth and node budget.
    private func descendantLabel(of root: Node) -> String? {
        var frontier: [(node: Node, depth: Int)] = children(root).map { ($0, 1) }
        var visited = 0
        while !frontier.isEmpty, visited < Self.maxDescendantNodes {
            let (node, depth) = frontier.removeFirst()
            visited += 1
            let nodeFacts = facts(node)
            if Self.labelRoles.contains(nodeFacts.role),
               let label = Self.ownLabel(nodeFacts, maxLength: Self.maxDescendantNameLength) {
                return label
            }
            if depth < Self.maxDescendantDepth {
                frontier.append(contentsOf: children(node).map { ($0, depth + 1) })
            }
        }
        return nil
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
