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

/// Canonical JSON used for approval-token HMACs. Must produce byte-identical
/// output to `canonicalJson` in
/// apps/desktop/src/main/services/helper/approval-token.ts:
/// keys sorted by UTF-8 byte order, no whitespace, integers without a
/// decimal point, other numbers formatted with the ECMAScript Number-to-String
/// rules over the shortest round-trip digits, strings escaped like
/// JSON.stringify (only `"`, `\`, and control characters below U+0020).
public enum CanonicalJSON {
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
            let keys = object.keys.sorted { Array($0.utf8).lexicographicallyPrecedes(Array($1.utf8)) }
            for (index, key) in keys.enumerated() {
                if index > 0 { output += "," }
                writeString(key, into: &output)
                output += ":"
                write(object[key] ?? .null, into: &output)
            }
            output += "}"
        }
    }

    /// ECMA-262 Number::toString (7.1.12.1) applied to Swift's shortest
    /// round-trip digits, so both sides print the same text for any finite
    /// double. Non-finite values have no JSON form; the TypeScript side throws.
    static func formatNumber(_ value: Double) -> String {
        guard value.isFinite else { return "null" }
        if value == 0 { return "0" }
        let (digits, pointPosition) = shortestDigits(abs(value))
        let k = digits.count
        let n = pointPosition
        var body: String
        if k <= n, n <= 21 {
            body = digits + String(repeating: "0", count: n - k)
        } else if n > 0, n <= 21 {
            body = String(digits.prefix(n)) + "." + String(digits.dropFirst(n))
        } else if n > -6, n <= 0 {
            body = "0." + String(repeating: "0", count: -n) + digits
        } else {
            let exponent = n - 1
            let sign = exponent < 0 ? "-" : "+"
            let mantissa = k == 1 ? digits : String(digits.prefix(1)) + "." + String(digits.dropFirst(1))
            body = mantissa + "e" + sign + String(abs(exponent))
        }
        return value < 0 ? "-" + body : body
    }

    /// Splits Swift's description ("12345.678", "1e-05", "1.5e+21", "3.0")
    /// into significant digits and the position of the decimal point
    /// relative to the first digit.
    private static func shortestDigits(_ magnitude: Double) -> (digits: String, pointPosition: Int) {
        let description = String(magnitude)
        var mantissa = Substring(description)
        var exponent = 0
        if let eIndex = description.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = description[..<eIndex]
            exponent = Int(description[description.index(after: eIndex)...]) ?? 0
        }
        let parts = mantissa.split(separator: ".", omittingEmptySubsequences: false)
        let integerPart = String(parts[0])
        let fractionPart = parts.count > 1 ? String(parts[1]) : ""
        var digits = integerPart + fractionPart
        var pointPosition = integerPart.count + exponent
        while digits.count > 1, digits.hasPrefix("0") {
            digits.removeFirst()
            pointPosition -= 1
        }
        while digits.count > 1, digits.hasSuffix("0") {
            digits.removeLast()
        }
        return (digits, pointPosition)
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
