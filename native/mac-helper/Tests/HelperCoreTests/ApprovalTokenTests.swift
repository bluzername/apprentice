import XCTest
@testable import HelperCore

/// HMAC vectors shared with apps/desktop/test/approval-token.test.ts.
final class ApprovalTokenTests: XCTestCase {
    private let secretHex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    private let click: [String: JSONValue] = ["type": .string("click"), "x": .int(10), "y": .number(20.5), "button": .string("left")]
    private let hotkey: [String: JSONValue] = ["type": .string("hotkey"), "modifiers": .array([.string("cmd"), .string("shift")]), "key": .string("p")]

    private var secret: ApprovalSecret { ApprovalSecret(hex: secretHex)! }

    func testExpectedTokensMatchTypeScriptVectors() {
        XCTAssertEqual(ApprovalTokenVerifier.expectedToken(secret: secret, action: click),
                       "c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae")
        XCTAssertEqual(ApprovalTokenVerifier.expectedToken(secret: secret, action: hotkey),
                       "2145f65a27e89dcbffe949bfe5f3da9c9674947ddda3c889e97be4fcc97db1ec")
        XCTAssertEqual(ApprovalTokenVerifier.expectedToken(secret: secret, action: ["type": .string("wait"), "ms": .int(10)]),
                       "8ef5402410fe0f7b1d9c99ed181d11e486d645848445ccd787e0de46a4884868")
    }

    func testCorrectTokenVerifies() {
        let token = "c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae"
        XCTAssertNotNil(ApprovalTokenVerifier.verify(token: token, action: click, secret: secret).successValue)
    }

    func testMutatedActionRejected() {
        let token = "c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae"
        var mutated = click
        mutated["x"] = .int(11)
        XCTAssertEqual(ApprovalTokenVerifier.verify(token: token, action: mutated, secret: secret).failureError,
                       ApprovalTokenVerifier.mismatchError)
    }

    func testWrongSecretRejected() {
        let other = ApprovalSecret(hex: String(repeating: "ff", count: 32))!
        let token = "c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae"
        XCTAssertEqual(ApprovalTokenVerifier.verify(token: token, action: click, secret: other).failureError,
                       ApprovalTokenVerifier.mismatchError)
    }

    func testMalformedTokensRejected() {
        for token in ["", "short", String(repeating: "zz", count: 32), String(repeating: "ab", count: 31), String(repeating: "AB", count: 32)] {
            XCTAssertEqual(ApprovalTokenVerifier.verify(token: token, action: click, secret: secret).failureError,
                           ApprovalTokenVerifier.mismatchError, "token \(token) should be rejected")
        }
    }

    func testMissingSecretRefusesEverything() {
        let token = "c0a70714081beb3cd5a34ac31a0f771352d32df8152d28654d33bef0b4b97dae"
        XCTAssertEqual(ApprovalTokenVerifier.verify(token: token, action: click, secret: nil).failureError,
                       ApprovalTokenVerifier.missingSecretError)
        XCTAssertEqual(ApprovalTokenVerifier.missingSecretError.message, "helper started without an approval secret")
    }

    func testSecretParsing() {
        XCTAssertNotNil(ApprovalSecret(hex: secretHex))
        XCTAssertNil(ApprovalSecret(hex: String(secretHex.dropLast(2))))
        XCTAssertNil(ApprovalSecret(hex: secretHex.uppercased()))
        XCTAssertNil(ApprovalSecret(hex: secretHex + "00"))
        XCTAssertNil(ApprovalSecret.fromEnvironment([:]))
        XCTAssertNil(ApprovalSecret.fromEnvironment([ApprovalSecret.environmentVariable: "nope"]))
        XCTAssertNotNil(ApprovalSecret.fromEnvironment([ApprovalSecret.environmentVariable: secretHex]))
    }
}
