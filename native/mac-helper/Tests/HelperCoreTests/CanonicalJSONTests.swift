import XCTest
@testable import HelperCore

/// Parity vectors shared with apps/desktop/test/approval-token.test.ts.
/// The expected strings were produced by the TypeScript `canonicalJson`;
/// both suites must keep them identical.
final class CanonicalJSONTests: XCTestCase {
    func testClickVector() {
        let value: JSONValue = .object(["type": .string("click"), "x": .int(10), "y": .number(20.5), "button": .string("left")])
        XCTAssertEqual(CanonicalJSON.encode(value), #"{"button":"left","type":"click","x":10,"y":20.5}"#)
    }

    func testHotkeyVector() {
        let value: JSONValue = .object(["type": .string("hotkey"), "modifiers": .array([.string("cmd"), .string("shift")]), "key": .string("p")])
        XCTAssertEqual(CanonicalJSON.encode(value), #"{"key":"p","modifiers":["cmd","shift"],"type":"hotkey"}"#)
    }

    func testTypeTextEscapingVector() {
        let text = "He said \"hi\"\n\ttab \\ slash \u{01} caf\u{E9} \u{2028} \u{1F600}"
        let value: JSONValue = .object(["type": .string("type_text"), "text": .string(text)])
        let expected = "{\"text\":\"He said \\\"hi\\\"\\n\\ttab \\\\ slash \\u0001 caf\u{E9} \u{2028} \u{1F600}\",\"type\":\"type_text\"}"
        XCTAssertEqual(CanonicalJSON.encode(value), expected)
    }

    func testScrollFractionVector() {
        let value: JSONValue = .object(["type": .string("scroll"), "x": .number(0.30000000000000004), "y": .number(-1.5), "deltaX": .int(0), "deltaY": .int(-120)])
        XCTAssertEqual(CanonicalJSON.encode(value), #"{"deltaX":0,"deltaY":-120,"type":"scroll","x":0.30000000000000004,"y":-1.5}"#)
    }

    func testIntegralDoublesPrintAsIntegers() {
        let value: JSONValue = .object(["type": .string("move"), "x": .number(3.0), "y": .number(-0.0)])
        XCTAssertEqual(CanonicalJSON.encode(value), #"{"type":"move","x":3,"y":0}"#)
    }

    func testByteOrderKeysNullsAndNesting() {
        let value: JSONValue = .object([
            "B": .int(2), "b": .int(1), "a": .null,
            "nested": .object(["z": .array([.bool(true), .bool(false), .null, .number(0.00001), .int(123_456_789_012_345)]), "y": .string("")])
        ])
        XCTAssertEqual(CanonicalJSON.encode(value), #"{"B":2,"a":null,"b":1,"nested":{"y":"","z":[true,false,null,0.00001,123456789012345]}}"#)
    }

    func testParsedWireActionRoundTripsToTheSameCanonicalForm() throws {
        let wire = #"{"y":20.5,"x":10,"button":"left","type":"click"}"#
        let parsed = try XCTUnwrap(JSONParser.parse(wire).successValue?.objectValue)
        XCTAssertEqual(CanonicalJSON.encode(.object(parsed)), #"{"button":"left","type":"click","x":10,"y":20.5}"#)
    }

    func testNumberFormattingFollowsEcmaScriptRules() {
        XCTAssertEqual(CanonicalJSON.formatNumber(0.1), "0.1")
        XCTAssertEqual(CanonicalJSON.formatNumber(0.00001), "0.00001")
        XCTAssertEqual(CanonicalJSON.formatNumber(0.000001), "0.000001")
        XCTAssertEqual(CanonicalJSON.formatNumber(0.0000001), "1e-7")
        XCTAssertEqual(CanonicalJSON.formatNumber(1.5e-7), "1.5e-7")
        XCTAssertEqual(CanonicalJSON.formatNumber(1e16), "10000000000000000")
        XCTAssertEqual(CanonicalJSON.formatNumber(1e21), "1e+21")
        XCTAssertEqual(CanonicalJSON.formatNumber(1.5e21), "1.5e+21")
        XCTAssertEqual(CanonicalJSON.formatNumber(123456.789), "123456.789")
        XCTAssertEqual(CanonicalJSON.formatNumber(-2.5), "-2.5")
        XCTAssertEqual(CanonicalJSON.formatNumber(-0.0), "0")
        XCTAssertEqual(CanonicalJSON.formatNumber(.nan), "null")
    }
}
