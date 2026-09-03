import XCTest
@testable import HelperCore

/// Minimal in-memory AX tree. `value` stands in for AXValue; the facts
/// adapter below only forwards it for static text, mirroring the helper.
private final class TestNode {
    let role: String
    let subrole: String?
    let title: String?
    let description: String?
    let value: String?
    let containsPoint: Bool
    private(set) var children: [TestNode] = []
    /// Strong on purpose: the tests build trees as discarded temporaries, so a weak parent would vanish.
    private(set) var parent: TestNode?

    init(_ role: String, subrole: String? = nil, title: String? = nil, description: String? = nil,
         value: String? = nil, containsPoint: Bool = false, children: [TestNode] = []) {
        self.role = role
        self.subrole = subrole
        self.title = title
        self.description = description
        self.value = value
        self.containsPoint = containsPoint
        self.children = children
        for child in children { child.parent = self }
    }
}

private func makeResolver(readValueForEveryRole: Bool = false) -> AXNameResolver<TestNode> {
    AXNameResolver<TestNode>(
        facts: { node in
            let exposeValue = readValueForEveryRole || node.role == "AXStaticText"
            return AXNodeFacts(role: node.role, subrole: node.subrole, title: node.title, description: node.description,
                               staticTextValue: exposeValue ? node.value : nil, containsPoint: node.containsPoint)
        },
        children: { $0.children },
        parent: { $0.parent }
    )
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

    func testUnlabelledTextFieldInsideRowUsesTheRowLabelNotTheWindow() {
        // The Finder list-view case: the hit is the editable filename field (value never read),
        // so the name must come from the row that contains it rather than the window title.
        let field = TestNode("AXTextField", value: "download-1.pdf")
        let row = TestNode("AXRow", children: [
            TestNode("AXCell", children: [TestNode("AXImage", description: "PDF document"), field]),
            TestNode("AXCell", children: [TestNode("AXStaticText", value: "Today at 10:32")])
        ])
        _ = TestNode("AXWindow", title: "Apprentice-test-invoices", children: [TestNode("AXOutline", children: [row])])
        XCTAssertEqual(makeResolver().resolve(hit: field), AXResolvedName(name: "PDF document", source: .descendant))
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

    func testTextFieldValueIsNeverUsedEvenWhenForwarded() {
        let field = TestNode("AXTextField", value: "jane@example.com")
        _ = TestNode("AXWindow", title: "Compose", children: [field])
        XCTAssertEqual(makeResolver(readValueForEveryRole: true).resolve(hit: field), AXResolvedName(name: "Compose", source: .ancestor))
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
