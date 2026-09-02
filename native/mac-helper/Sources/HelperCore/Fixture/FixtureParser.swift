import Foundation

/// One line of a fixture JSONL file: {"delayMs":number,"event":string,"data":object}.
public struct FixtureRecord: Equatable {
    public let delayMs: Double
    public let event: HelperEventName
    public let data: [String: JSONValue]

    public init(delayMs: Double, event: HelperEventName, data: [String: JSONValue]) {
        self.delayMs = delayMs
        self.event = event
        self.data = data
    }
}

public enum FixtureParseError: Error, Equatable {
    case malformedLine(lineNumber: Int, reason: String)
}

public enum FixtureParser {
    public static func parse(text: String) -> Result<[FixtureRecord], FixtureParseError> {
        var records: [FixtureRecord] = []
        let lines = text.components(separatedBy: .newlines)
        for (index, rawLine) in lines.enumerated() {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            switch parseLine(line, lineNumber: index + 1) {
            case let .success(record): records.append(record)
            case let .failure(error): return .failure(error)
            }
        }
        return .success(records)
    }

    public static func parseLine(_ line: String, lineNumber: Int) -> Result<FixtureRecord, FixtureParseError> {
        guard case let .success(value) = JSONParser.parse(line), let object = value.objectValue else {
            return .failure(.malformedLine(lineNumber: lineNumber, reason: "not a JSON object"))
        }
        guard let delay = object["delayMs"]?.doubleValue, delay.isFinite, delay >= 0 else {
            return .failure(.malformedLine(lineNumber: lineNumber, reason: "delayMs must be a non-negative number"))
        }
        guard let eventName = object["event"]?.stringValue, let event = HelperEventName(rawValue: eventName) else {
            return .failure(.malformedLine(lineNumber: lineNumber, reason: "unknown event name"))
        }
        let data = object["data"]?.objectValue ?? [:]
        if let rawData = object["data"], rawData.objectValue == nil {
            return .failure(.malformedLine(lineNumber: lineNumber, reason: "data must be an object"))
        }
        return .success(FixtureRecord(delayMs: delay, event: event, data: data))
    }

    /// Cumulative emission offsets in milliseconds, one per record, in file order.
    public static func cumulativeOffsets(_ records: [FixtureRecord]) -> [Double] {
        var total = 0.0
        return records.map { record in
            total += record.delayMs
            return total
        }
    }
}
