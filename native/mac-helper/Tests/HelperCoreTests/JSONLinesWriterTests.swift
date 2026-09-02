import XCTest
@testable import HelperCore

final class JSONLinesWriterTests: XCTestCase {
    func testEncoderNeverEmitsNewlines() {
        let value: JSONValue = .object([
            "title": .string("line one\nline two\r\nthree\u{2028}four"),
            "nested": .array([.string("\n"), .object(["k": .string("\r")])])
        ])
        let line = ProtocolMessages.encodeLine(value)
        XCTAssertFalse(line.contains("\n"))
        XCTAssertFalse(line.contains("\r"))
        XCTAssertFalse(line.contains("\u{2028}"))
        XCTAssertEqual(JSONParser.parse(line).successValue, value)
    }

    func testKeysAreSortedForDeterminism() {
        let line = JSONLineEncoder.encode(.object(["z": .int(1), "a": .int(2), "m": .null]))
        XCTAssertEqual(line, #"{"a":2,"m":null,"z":1}"#)
    }

    func testNumbersEncodeCompactly() {
        XCTAssertEqual(JSONLineEncoder.encode(.number(2.0)), "2")
        XCTAssertEqual(JSONLineEncoder.encode(.number(2.5)), "2.5")
        XCTAssertEqual(JSONLineEncoder.encode(.number(.nan)), "null")
        XCTAssertEqual(JSONLineEncoder.encode(.int(-7)), "-7")
        XCTAssertEqual(JSONLineEncoder.encode(.bool(false)), "false")
    }

    func testControlCharactersAreEscaped() {
        let line = JSONLineEncoder.encode(.string("a\u{01}b\"c\\d\tt"))
        XCTAssertEqual(line, #""a\u0001b\"c\\d\tt""#)
    }

    func testParserPreservesBooleansAndIntegers() throws {
        let parsed = try XCTUnwrap(JSONParser.parse(#"{"b":true,"i":1,"d":1.5,"s":"x","n":null,"a":[1,2]}"#).successValue)
        XCTAssertEqual(parsed["b"], .bool(true))
        XCTAssertEqual(parsed["i"], .int(1))
        XCTAssertEqual(parsed["d"], .number(1.5))
        XCTAssertEqual(parsed["s"], .string("x"))
        XCTAssertEqual(parsed["n"], .null)
        XCTAssertEqual(parsed["a"], .array([.int(1), .int(2)]))
    }

    func testSequencerIsMonotonic() {
        var now = 100.0
        let sequencer = EventSequencer(clock: { now })
        let first = sequencer.next()
        now = 250
        let second = sequencer.next()
        XCTAssertEqual(first.seq, 0)
        XCTAssertEqual(second.seq, 1)
        XCTAssertEqual(first.timestampMs, 100)
        XCTAssertEqual(second.timestampMs, 250)
    }

    func testStopFlagSetAndClear() {
        let flag = StopFlag()
        XCTAssertFalse(flag.isSet)
        flag.set()
        XCTAssertTrue(flag.isSet)
        flag.clear()
        XCTAssertFalse(flag.isSet)
    }

    func testCapabilitiesEncodesAllFields() throws {
        let caps = Capabilities(arch: "arm64", macosVersion: "14.0.0", features: .init(
            accessibility: true, screenCaptureKit: true, cgEvents: true, visionOcr: true, fixtureStream: true))
        let parsed = try XCTUnwrap(JSONParser.parse(JSONLineEncoder.encode(caps.toJSON())).successValue)
        XCTAssertEqual(parsed["helperVersion"], .string("0.1.0"))
        XCTAssertEqual(parsed["protocolVersion"], .string("1.0"))
        XCTAssertEqual(parsed["arch"], .string("arm64"))
        XCTAssertEqual(parsed["macosVersion"], .string("14.0.0"))
        let features = try XCTUnwrap(parsed["features"]?.objectValue)
        XCTAssertEqual(Set(features.keys), ["accessibility", "screenCaptureKit", "cgEvents", "visionOcr", "fixtureStream"])
    }
}
