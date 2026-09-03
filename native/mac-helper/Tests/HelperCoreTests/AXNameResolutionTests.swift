import XCTest
@testable import HelperCore

/// Minimal in-memory AX tree. `value` stands in for AXValue; the facts
/// adapter below forwards it as `staticTextValue` for static text and as
/// `textFieldValue` for plain text fields, mirroring the helper.
private final class TestNode {
    let role: String
    let subrole: String?
    let title: String?
    let description: String?
    let value: String?
    let focused: Bool
    let editing: Bool
    let containsPoint: Bool
    private(set) var children: [TestNode] = []
    /// Strong on purpose: the tests build trees as discarded temporaries, so a weak parent would vanish.
    private(set) var parent: TestNode?

    init(_ role: String, subrole: String? = nil, title: String? = nil, description: String? = nil,
         value: String? = nil, focused: Bool = false, editing: Bool = false, containsPoint: Bool = false,
         children: [TestNode] = []) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.value = value
        self.focused = focused
        self.editing = editing
        self.containsPoint = containsPoint
        self.children = children
        for child in children { child.parent = self }
    }
}

private func makeResolver(readValueForEveryRole: Bool = false) -> AXNameResolver<TestNode> {
    AXNameResolver<TestNode>(
        facts: { node in
            let exposeStatic = readValueForEveryRole || node.role == "AXStaticText"
            let exposeField = readValueForEveryRole || node.role == "AXTextField"
            return AXNodeFacts(role: node.role, subrole: node.subrole, title: node.title, description: node.description,
                               staticTextValue: exposeStatic ? node.value : nil,
                               textFieldValue: exposeField ? node.value : nil,
                               isFocused: node.focused, isEditable: node.editing, containsPoint: node.containsPoint)
        },
        children: { $0.children },
        parent: { $0.parent }
    )
}

/// Finder list view: outline > row > [name cell: image + filename text field, date cell: static text].
private func finderRow(field: TestNode, imageDescription: String? = nil, container: String = "AXOutline") -> TestNode {
    let row = TestNode("AXRow", children: [
        TestNode("AXCell", children: [TestNode("AXImage", description: imageDescription), field]),
        TestNode("AXCell", children: [TestNode("AXStaticText", value: "Today at 12:50")])
    ])
    _ = TestNode("AXWindow", title: "Apprentice-test-invoices", children: [TestNode(container, children: [row])])
    return row
}

final class AXNameResolutionTests: XCTestCase {
    func testElementWithOwnTitleWinsOverEverything() {
        let hit = TestNode("AXButton", title: "Save", children: [TestNode("AXStaticText", value: "Ignored")])
        _ = TestNode("AXWindow", title: "Doc", children: [hit])
        XCTAssertEqual(makeResolver().resolve(hit: hit), AXResolvedName(name: "Save", source: .own))
    }

    func testStaticTextUsesItsValueAsOwnName() {
        let hit = TestNode("AXStaticText", value: "  download-1.pdf ")
        XCTAssertEqual(makeResolver().resolve(hit: hit), AXResolvedName(name: "download-1.pdf", source: .own))
    }

    func testRowHitTakesItsFirstLabelledChild() {
        let row = TestNode("AXRow", children: [
            TestNode("AXCell", children: [TestNode("AXImage"), TestNode("AXStaticText", value: "download-1.pdf")]),
            TestNode("AXCell", children: [TestNode("AXStaticText", value: "Today at 10:32")])
        ])
        _ = TestNode("AXWindow", title: "Apprentice-test-invoices", children: [TestNode("AXOutline", children: [row])])
        XCTAssertEqual(makeResolver().resolve(hit: row), AXResolvedName(name: "download-1.pdf", source: .descendant))
    }

    func testCellHitFindsLabelTwoLevelsDown() {
        let cell = TestNode("AXCell", children: [
            TestNode("AXGroup", children: [TestNode("AXGroup", children: [TestNode("AXStaticText", value: "invoice-42.pdf")])])
        ])
        _ = TestNode("AXWindow", title: "Invoices", children: [TestNode("AXRow", children: [cell])])
        XCTAssertEqual(makeResolver().resolve(hit: cell), AXResolvedName(name: "invoice-42.pdf", source: .descendant))
    }

    func testFinderRowResolvesToTheFilenameNotTheDateColumn() {
        // Image + idle filename text field + date static text: the filename wins whether the
        // hit is the row, the name cell, the date cell, or the field itself.
        let field = TestNode("AXTextField", value: "download-1.pdf")
        let row = finderRow(field: field, imageDescription: "PDF document")
        XCTAssertEqual(makeResolver().resolve(hit: row), AXResolvedName(name: "download-1.pdf", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: row.children[0]), AXResolvedName(name: "download-1.pdf", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: row.children[1]), AXResolvedName(name: "download-1.pdf", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: field), AXResolvedName(name: "download-1.pdf", source: .own))
    }

    func testFocusedTextFieldValueIsNeverUsed() {
        // A focused field may be taking keystrokes (Finder rename): fall back to the image label.
        let field = TestNode("AXTextField", value: "download-1.pdf", focused: true)
        let row = finderRow(field: field, imageDescription: "PDF document")
        XCTAssertEqual(makeResolver().resolve(hit: field), AXResolvedName(name: "PDF document", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: row), AXResolvedName(name: "PDF document", source: .descendant))
        // Without any other label the row gives nothing and the window title is used.
        let bare = TestNode("AXTextField", value: "secret-draft.txt", focused: true)
        let bareRow = finderRow(field: bare)
        XCTAssertEqual(makeResolver().resolve(hit: bare), AXResolvedName(name: "Today at 12:50", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: bareRow), AXResolvedName(name: "Today at 12:50", source: .descendant))
    }

    func testEditableTextFieldInsideRowIsNeverUsed() {
        let field = TestNode("AXTextField", value: "download-1.pdf", editing: true)
        let row = finderRow(field: field, imageDescription: "PDF document")
        XCTAssertEqual(makeResolver().resolve(hit: field), AXResolvedName(name: "PDF document", source: .descendant))
        XCTAssertEqual(makeResolver().resolve(hit: row), AXResolvedName(name: "PDF document", source: .descendant))
    }

    func testRowWithoutFilenameFallsBackToTheFirstCellLabel() {
        // Mail-like row: the first cell holds the sender, a later cell the subject and date.
        let row = TestNode("AXRow", children: [
            TestNode("AXCell", children: [TestNode("AXStaticText", value: "Accounts payable")]),
            TestNode("AXCell", children: [TestNode("AXTextField", value: "Invoice reminder"), TestNode("AXStaticText", value: "Yesterday")])
        ])
        _ = TestNode("AXWindow", title: "Inbox", children: [TestNode("AXTable", children: [row])])
        XCTAssertEqual(makeResolver().resolve(hit: row), AXResolvedName(name: "Accounts payable", source: .descendant))
        // Breadth-first would otherwise have found the deeper first-cell label after the second cell's field.
        let nested = TestNode("AXRow", children: [
            TestNode("AXCell", children: [TestNode("AXGroup", children: [TestNode("AXStaticText", value: "Deep sender")])]),
            TestNode("AXCell", children: [TestNode("AXStaticText", value: "Shallow subject")])
        ])
        _ = TestNode("AXWindow", title: "Inbox", children: [TestNode("AXTable", children: [nested])])
        XCTAssertEqual(makeResolver().resolve(hit: nested), AXResolvedName(name: "Deep sender", source: .descendant))
    }

    func testTextFieldValueOutsideOutlineOrTableRowsIsNeverUsed() {
        // AXList rows and bare windows are not list-view labels.
        let inList = TestNode("AXTextField", value: "todo.txt")
        _ = finderRow(field: inList, container: "AXList")
        XCTAssertEqual(makeResolver().resolve(hit: inList), AXResolvedName(name: "Today at 12:50", source: .descendant))
        let tooDeep = TestNode("AXTextField", value: "deep.txt")
        let row = TestNode("AXRow", children: [TestNode("AXGroup", children: [TestNode("AXGroup", children: [TestNode("AXGroup", children: [tooDeep])])])])
        _ = TestNode("AXWindow", title: "Files", children: [TestNode("AXOutline", children: [row])])
        XCTAssertEqual(makeResolver().resolve(hit: tooDeep), AXResolvedName(name: "Files", source: .ancestor))
    }

    func testMultilineOrOverlongTextFieldValuesAreNeverUsed() {
        let multiline = TestNode("AXTextField", value: "line one\nline two.txt")
        _ = finderRow(field: multiline)
        XCTAssertEqual(makeResolver().resolve(hit: multiline), AXResolvedName(name: "Today at 12:50", source: .descendant))
        let long = TestNode("AXTextField", value: String(repeating: "a", count: AXNameResolver<TestNode>.maxTextFieldLabelLength + 1) + ".pdf")
        _ = finderRow(field: long)
        XCTAssertEqual(makeResolver().resolve(hit: long), AXResolvedName(name: "Today at 12:50", source: .descendant))
    }

    func testOutlineHitPrefersTheRowUnderThePoint() {
        let outline = TestNode("AXOutline", children: [
            TestNode("AXRow", children: [TestNode("AXStaticText", value: "first.pdf")]),
            TestNode("AXRow", containsPoint: true, children: [TestNode("AXStaticText", value: "second.pdf")])
        ])
        _ = TestNode("AXWindow", title: "Folder", children: [outline])
        XCTAssertEqual(makeResolver().resolve(hit: outline), AXResolvedName(name: "second.pdf", source: .descendant))
    }

    func testOutlineHitOnEmptyAreaFallsBackToAncestorTitle() {
        let outline = TestNode("AXOutline", children: [TestNode("AXRow", children: [TestNode("AXStaticText", value: "first.pdf")])])
        _ = TestNode("AXWindow", title: "Folder", children: [TestNode("AXScrollArea", children: [outline])])
        XCTAssertEqual(makeResolver().resolve(hit: outline), AXResolvedName(name: "Folder", source: .ancestor))
    }

    func testNoLabelAnywhereBelowFallsBackToNearestTitledAncestor() {
        let hit = TestNode("AXGroup", children: [TestNode("AXGroup"), TestNode("AXImage")])
        _ = TestNode("AXWindow", title: "Doc - Google Docs", children: [
            TestNode("AXGroup", children: [TestNode("AXToolbar", title: "Formatting", children: [hit])])
        ])
        XCTAssertEqual(makeResolver().resolve(hit: hit), AXResolvedName(name: "Formatting", source: .ancestor))
    }

    func testNothingResolvesWhenTreeHasNoLabels() {
        let hit = TestNode("AXGroup")
        _ = TestNode("AXWindow", children: [hit])
        XCTAssertNil(makeResolver().resolve(hit: hit))
    }

    func testSecureFieldNeverExposesItsValue() {
        let secureByRole = TestNode("AXSecureTextField", value: "hunter2")
        let secureBySubrole = TestNode("AXTextField", subrole: "AXSecureTextField", title: "Password", value: "hunter2")
        _ = TestNode("AXWindow", title: "Login", children: [secureByRole, secureBySubrole])
        // Even a misbehaving facts adapter that forwards values for every role must not leak.
        let leaky = makeResolver(readValueForEveryRole: true)
        XCTAssertNil(leaky.resolve(hit: secureByRole))
        XCTAssertNil(leaky.resolve(hit: secureBySubrole))
        // A secure field among descendants is skipped, so the resolver moves on to the next label.
        let form = TestNode("AXGroup", children: [secureByRole, TestNode("AXButton", title: "Sign in")])
        XCTAssertEqual(leaky.resolve(hit: form), AXResolvedName(name: "Sign in", source: .descendant))
    }

    func testTextFieldValueOutsideRowsIsNeverUsedEvenWhenForwarded() {
        let field = TestNode("AXTextField", value: "jane@example.com")
        _ = TestNode("AXWindow", title: "Compose", children: [field])
        XCTAssertEqual(makeResolver(readValueForEveryRole: true).resolve(hit: field), AXResolvedName(name: "Compose", source: .ancestor))
        // A secure field inside a list row is still never read, even by a leaky adapter.
        let secure = TestNode("AXTextField", subrole: "AXSecureTextField", value: "hunter2.txt")
        _ = finderRow(field: secure)
        XCTAssertEqual(makeResolver(readValueForEveryRole: true).resolve(hit: secure), nil)
    }

    func testDescendantWalkIsBoundedByDepthAndNodeBudget() {
        let deep = TestNode("AXGroup", children: [TestNode("AXGroup", children: [TestNode("AXGroup", children: [
            TestNode("AXGroup", children: [TestNode("AXStaticText", value: "Four levels down")])
        ])])])
        _ = TestNode("AXWindow", title: "Deep", children: [deep])
        XCTAssertEqual(makeResolver().resolve(hit: deep), AXResolvedName(name: "Deep", source: .ancestor))

        let wide = TestNode("AXGroup", children: (0..<AXNameResolver<TestNode>.maxDescendantNodes).map { _ in TestNode("AXGroup") }
            + [TestNode("AXStaticText", value: "Past the budget")])
        _ = TestNode("AXWindow", title: "Wide", children: [wide])
        XCTAssertEqual(makeResolver().resolve(hit: wide), AXResolvedName(name: "Wide", source: .ancestor))
    }

    func testOverlongDescendantLabelsAreSkipped() {
        let long = String(repeating: "x", count: AXNameResolver<TestNode>.maxDescendantNameLength + 1)
        let hit = TestNode("AXGroup", children: [TestNode("AXStaticText", value: long), TestNode("AXButton", title: "OK")])
        XCTAssertEqual(makeResolver().resolve(hit: hit), AXResolvedName(name: "OK", source: .descendant))
    }
}
