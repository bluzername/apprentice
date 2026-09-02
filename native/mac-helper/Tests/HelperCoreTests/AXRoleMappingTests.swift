import XCTest
@testable import HelperCore

final class AXRoleMappingTests: XCTestCase {
    func testCoreRoleMappings() {
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXButton"), .button)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXTextField"), .textbox)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXSecureTextField"), .secure)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXLink"), .link)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXMenuItem"), .menuitem)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXCheckBox"), .checkbox)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXRadioButton"), .radio)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXComboBox"), .combobox)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXPopUpButton"), .popupbutton)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXStaticText"), .statictext)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXWindow"), .window)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXWebArea"), .webarea)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXTextArea"), .textarea)
    }

    func testUnknownRoleMapsToUnknown() {
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXSomethingNew"), .unknown)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: ""), .unknown)
    }

    func testSubroleRefinements() {
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXTextField", subrole: "AXSecureTextField"), .secure)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXButton", subrole: "AXToggle"), .checkbox)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXButton", subrole: "AXMenuButton"), .popupbutton)
        XCTAssertEqual(AXRoleMapping.semanticRole(forAXRole: "AXStaticText", subrole: "AXHeading"), .heading)
    }

    func testSecureAndTextEntryDetection() {
        XCTAssertTrue(AXRoleMapping.isSecure(axRole: "AXSecureTextField"))
        XCTAssertTrue(AXRoleMapping.isSecure(axRole: "AXTextField", subrole: "AXSecureTextField"))
        XCTAssertFalse(AXRoleMapping.isSecure(axRole: "AXTextField"))
        XCTAssertTrue(AXRoleMapping.isTextEntry(axRole: "AXTextField"))
        XCTAssertTrue(AXRoleMapping.isTextEntry(axRole: "AXTextArea"))
        XCTAssertTrue(AXRoleMapping.isTextEntry(axRole: "AXSecureTextField"))
        XCTAssertFalse(AXRoleMapping.isTextEntry(axRole: "AXButton"))
    }

    func testActionableRoles() {
        XCTAssertTrue(AXRoleMapping.isActionable(.button))
        XCTAssertTrue(AXRoleMapping.isActionable(.link))
        XCTAssertTrue(AXRoleMapping.isActionable(.menuitem))
        XCTAssertFalse(AXRoleMapping.isActionable(.statictext))
        XCTAssertFalse(AXRoleMapping.isActionable(.unknown))
    }
}
