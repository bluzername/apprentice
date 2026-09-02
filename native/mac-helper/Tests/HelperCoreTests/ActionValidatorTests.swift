import XCTest
@testable import HelperCore

final class ActionValidatorTests: XCTestCase {
    private let displays = [PointRect(x: 0, y: 0, width: 1440, height: 900),
                            PointRect(x: 1440, y: -100, width: 1920, height: 1080)]
    private let token: JSONValue = .string("approved-token-1")

    private func validate(_ action: [String: JSONValue], token: JSONValue? = nil) -> Result<ValidatedAction, HelperError> {
        ActionValidator.validate(params: ["action": .object(action), "approvalToken": token ?? self.token], displays: displays)
    }

    func testValidClickAccepted() {
        let result = validate(["type": .string("click"), "x": .int(10), "y": .number(20.5), "button": .string("left")])
        XCTAssertEqual(result.successValue?.action, .click(x: 10, y: 20.5, button: .left))
        XCTAssertEqual(result.successValue?.approvalToken, "approved-token-1")
    }

    func testPointOnSecondDisplayAccepted() {
        let result = validate(["type": .string("move"), "x": .int(3000), "y": .int(-50)])
        XCTAssertEqual(result.successValue?.action, .move(x: 3000, y: -50))
    }

    func testOutOfBoundsRejected() {
        let result = validate(["type": .string("double_click"), "x": .int(5000), "y": .int(10)])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }

    func testNonFiniteCoordinateRejected() {
        let result = validate(["type": .string("move"), "x": .number(.infinity), "y": .int(10)])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }

    func testShortTokenRejected() {
        let result = validate(["type": .string("wait"), "ms": .int(10)], token: .string("short"))
        XCTAssertEqual(result.failureError?.code, .actionRejected)
        XCTAssertNil(ActionValidator.validate(params: ["action": .object(["type": .string("wait"), "ms": .int(1)])],
                                              displays: displays).successValue)
    }

    func testUnknownKeyRejected() {
        let result = validate(["type": .string("press_key"), "key": .string("capslock")])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }

    func testEveryKeyNameAcceptedForPressKey() {
        for name in KeyNames.all {
            let result = validate(["type": .string("press_key"), "key": .string(name)])
            XCTAssertNotNil(result.successValue, "key \(name) should be accepted")
        }
    }

    func testUnknownModifierRejected() {
        let result = validate(["type": .string("hotkey"), "modifiers": .array([.string("super")]), "key": .string("p")])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }

    func testHotkeyModifiersResolved() {
        let result = validate(["type": .string("hotkey"),
                               "modifiers": .array([.string("cmd"), .string("shift"), .string("command")]),
                               "key": .string("p")])
        XCTAssertEqual(result.successValue?.action, .hotkey(modifiers: [.command, .shift], keyName: "p", keyCode: 35))
    }

    func testTooManyModifiersRejected() {
        let result = validate(["type": .string("hotkey"),
                               "modifiers": .array([.string("cmd"), .string("shift"), .string("alt"), .string("ctrl")]),
                               "key": .string("p")])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }

    func testTextLengthLimit() {
        let ok = validate(["type": .string("type_text"), "text": .string(String(repeating: "a", count: 2000))])
        XCTAssertNotNil(ok.successValue)
        let tooLong = validate(["type": .string("type_text"), "text": .string(String(repeating: "a", count: 2001))])
        XCTAssertEqual(tooLong.failureError?.code, .actionRejected)
    }

    func testScrollRequiresIntegerDeltas() {
        let ok = validate(["type": .string("scroll"), "x": .int(1), "y": .int(1), "deltaX": .int(0), "deltaY": .int(-120)])
        XCTAssertEqual(ok.successValue?.action, .scroll(x: 1, y: 1, deltaX: 0, deltaY: -120))
        let bad = validate(["type": .string("scroll"), "x": .int(1), "y": .int(1), "deltaX": .number(1.5), "deltaY": .int(0)])
        XCTAssertEqual(bad.failureError?.code, .actionRejected)
    }

    func testWaitRange() {
        XCTAssertNotNil(validate(["type": .string("wait"), "ms": .int(15000)]).successValue)
        XCTAssertEqual(validate(["type": .string("wait"), "ms": .int(15001)]).failureError?.code, .actionRejected)
        XCTAssertEqual(validate(["type": .string("wait"), "ms": .int(-1)]).failureError?.code, .actionRejected)
    }

    func testUnsupportedTypeRejected() {
        XCTAssertEqual(validate(["type": .string("ask_user"), "question": .string("?")]).failureError?.code, .actionRejected)
        XCTAssertEqual(validate(["type": .string("done")]).failureError?.code, .actionRejected)
    }

    func testUnknownMouseButtonRejected() {
        let result = validate(["type": .string("click"), "x": .int(1), "y": .int(1), "button": .string("back")])
        XCTAssertEqual(result.failureError?.code, .actionRejected)
    }
}
