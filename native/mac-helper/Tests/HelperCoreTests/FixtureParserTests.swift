import XCTest
@testable import HelperCore

final class FixtureParserTests: XCTestCase {
    private let sample = """
    {"delayMs":0,"event":"helperReady","data":{}}

    # comment line
    {"delayMs":100,"event":"frontmostAppChanged","data":{"bundleId":"com.apple.Safari","name":"Safari","pid":42}}
    {"delayMs":50.5,"event":"mouseDown","data":{"x":10,"y":20,"button":"left","bundleId":"com.apple.Safari"}}
    """

    func testParsesRecordsInOrder() throws {
        let records = try XCTUnwrap(FixtureParser.parse(text: sample).successValue)
        XCTAssertEqual(records.count, 3)
        XCTAssertEqual(records.map(\.event), [.helperReady, .frontmostAppChanged, .mouseDown])
        XCTAssertEqual(records[1].data["pid"], .int(42))
        XCTAssertEqual(records[2].delayMs, 50.5)
    }

    func testCumulativeOffsets() throws {
        let records = try XCTUnwrap(FixtureParser.parse(text: sample).successValue)
        XCTAssertEqual(FixtureParser.cumulativeOffsets(records), [0, 100, 150.5])
    }

    func testRejectsUnknownEventName() {
        let result = FixtureParser.parse(text: #"{"delayMs":1,"event":"keystroke","data":{}}"#)
        XCTAssertEqual(result.failureError, .malformedLine(lineNumber: 1, reason: "unknown event name"))
    }

    func testRejectsNegativeDelayAndBadJSON() {
        XCTAssertEqual(FixtureParser.parse(text: #"{"delayMs":-1,"event":"helperReady"}"#).failureError,
                       .malformedLine(lineNumber: 1, reason: "delayMs must be a non-negative number"))
        XCTAssertEqual(FixtureParser.parse(text: "ok\n{bad").failureError,
                       .malformedLine(lineNumber: 1, reason: "not a JSON object"))
    }

    func testRejectsNonObjectData() {
        XCTAssertEqual(FixtureParser.parse(text: #"{"delayMs":1,"event":"helperReady","data":[1]}"#).failureError,
                       .malformedLine(lineNumber: 1, reason: "data must be an object"))
    }

    func testSampleFixtureFileParsesAndCoversEveryEvent() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures/sample-observation.jsonl")
        let text = try String(contentsOf: url, encoding: .utf8)
        let records = try XCTUnwrap(FixtureParser.parse(text: text).successValue)
        XCTAssertGreaterThanOrEqual(records.count, 10)
        XCTAssertLessThanOrEqual(records.count, 20)
        XCTAssertEqual(Set(records.map(\.event)), Set(HelperEventName.allCases))
        XCTAssertEqual(FixtureParser.cumulativeOffsets(records).last, records.reduce(0) { $0 + $1.delayMs })
    }
}
