import XCTest
@testable import HelperCore

final class ActionValidatorTests: XCTestCase {
    private let displays = [PointRect(x: 0, y: 0, width: 1440, height: 900),
                            PointRect(x: 1440, y: -100, width: 1920, height: 1080)]
    private let secret = ApprovalSecret(hex: String(repeating: "ab", count: 32))!

    /// Mints the correct token for `action` unless an explicit token is given.
    private func validate(_ action: [String: JSONValue], token: JSONValue? = nil) -> Result<ValidatedAction, HelperError> {
        let presented = token ?? .string(ApprovalTokenVerifier.expectedToken(secret: secret, action: action))
        return ActionValidator.validate(params: ["action": .object(action), "approvalToken": presented], displays: displays, secret: secret)
    }

    func testValidClickAccepted() {
        let action: [String: JSONValue] = ["type": .string("click"), "x": .int(10), "y": .number(20.5), "button": .string("left")]
        let result = validate(action)
        XCTAssertEqual(result.successValue?.action, .click(x: 10, y: 20.5, button: .left))
        XCTAssertEqual(result.successValue?.approvalToken, ApprovalTokenVerifier.expectedToken(secret: secret, action: action))
    }

    func testTokenForDifferentActionRejected() {
        let approved: [String: JSONValue] = ["type": .string("wait"), "ms": .int(10)]
        let token = JSONValue.string(ApprovalTokenVerifier.expectedToken(secret: secret, action: approved))
        XCTAssertNotNil(validate(approved, token: token).successValue)
        let mutated = validate(["type": .string("wait"), "ms": .int(11)], token: token)
        XCTAssertEqual(mutated.failureError, ApprovalTokenVerifier.mismatchError)
    }

    func testMissingSecretRefusesEvenCorrectlyShapedToken() {
        let action: [String: JSONValue] = ["type": .string("wait"), "ms": .int(10)]
        let token = JSONValue.string(ApprovalTokenVerifier.expectedToken(secret: secret, action: action))
        let result = ActionValidator.validate(params: ["action": .object(action), "approvalToken": token], displays: displays, secret: nil)
        XCTAssertEqual(result.failureError, ApprovalTokenVerifier.missingSecretError)
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
                                              displays: displays, secret: secret).successValue)
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

    /// cmd+q and cmd+opt+esc are refused by the helper itself, even with a valid
    /// approval token: nothing upstream may authorize quitting or force-quitting.
    func testDeniedHotkeysRejectedEvenWithAValidToken() {
        let denied: [[JSONValue]] = [
            [.string("cmd")],
            [.string("command")],
            [.string("cmd"), .string("shift")]
        ]
        for modifiers in denied {
            let action: [String: JSONValue] = ["type": .string("hotkey"), "modifiers": .array(modifiers), "key": .string("q")]
            let result = validate(action)
            XCTAssertNil(result.successValue, "cmd+q with \(modifiers) must not be executable")
            XCTAssertEqual(result.failureError?.code, .actionRejected)
            XCTAssertEqual(result.failureError?.message, HotkeyDenylist.rejectionMessage)
        }
        for key in ["escape", "esc"] {
            let action: [String: JSONValue] = ["type": .string("hotkey"),
                                               "modifiers": .array([.string("cmd"), .string("option")]),
                                               "key": .string(key)]
            let result = validate(action)
            XCTAssertNil(result.successValue, "cmd+opt+\(key) must not be executable")
            XCTAssertEqual(result.failureError?.message, HotkeyDenylist.rejectionMessage)
        }
    }

    func testDenylistDoesNotCatchOrdinaryShortcuts() {
        for (modifiers, key) in [([JSONValue.string("cmd")], "w"), ([JSONValue.string("cmd")], "s"), ([JSONValue.string("cmd"), JSONValue.string("shift")], "w"), ([JSONValue.string("cmd")], "escape")] {
            let result = validate(["type": .string("hotkey"), "modifiers": .array(modifiers), "key": .string(key)])
            XCTAssertNotNil(result.successValue, "\(modifiers)+\(key) should still be executable")
        }
        // A quit-shaped key without Command is an ordinary keystroke.
        XCTAssertNotNil(validate(["type": .string("hotkey"), "modifiers": .array([.string("ctrl")]), "key": .string("q")]).successValue)
        XCTAssertNotNil(validate(["type": .string("press_key"), "key": .string("q")]).successValue)
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
