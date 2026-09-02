import Foundation

/// Deterministic single-line JSON serializer. Keys are sorted, strings are
/// escaped so that the output never contains a raw newline, and non-finite
/// numbers become `null` (JSON has no representation for them).
public enum JSONLineEncoder {
    public static func encode(_ value: JSONValue) -> String {
        var output = ""
        write(value, into: &output)
        return output
    }

    private static func write(_ value: JSONValue, into output: inout String) {
        switch value {
        case .null:
            output += "null"
        case let .bool(bool):
            output += bool ? "true" : "false"
        case let .int(int):
            output += String(int)
        case let .number(double):
            output += formatNumber(double)
        case let .string(string):
            writeString(string, into: &output)
        case let .array(array):
            output += "["
            for (index, element) in array.enumerated() {
                if index > 0 { output += "," }
                write(element, into: &output)
            }
            output += "]"
        case let .object(object):
            output += "{"
            for (index, key) in object.keys.sorted().enumerated() {
                if index > 0 { output += "," }
                writeString(key, into: &output)
                output += ":"
                write(object[key] ?? .null, into: &output)
            }
            output += "}"
        }
    }

    private static func formatNumber(_ double: Double) -> String {
        guard double.isFinite else { return "null" }
        if double == double.rounded(), abs(double) < 1e15 {
            return String(Int64(double))
        }
        return String(double)
    }

    private static func writeString(_ string: String, into output: inout String) {
        output += "\""
        for scalar in string.unicodeScalars {
            switch scalar {
            case "\"": output += "\\\""
            case "\\": output += "\\\\"
            case "\n": output += "\\n"
            case "\r": output += "\\r"
            case "\t": output += "\\t"
            case "\u{08}": output += "\\b"
            case "\u{0C}": output += "\\f"
            case "\u{2028}": output += "\\u2028"
            case "\u{2029}": output += "\\u2029"
            default:
                if scalar.value < 0x20 {
                    output += String(format: "\\u%04x", scalar.value)
                } else {
                    output.unicodeScalars.append(scalar)
                }
            }
        }
        output += "\""
    }
}
