import Foundation

/// Minimal JSON model used for every protocol payload. Mirrors the shapes the
/// TypeScript Zod schemas accept; no Foundation types leak across the wire.
public enum JSONValue: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public var objectValue: [String: JSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    public var doubleValue: Double? {
        switch self {
        case let .int(value): return Double(value)
        case let .number(value): return value
        default: return nil
        }
    }

    public var intValue: Int? {
        switch self {
        case let .int(value): return value
        case let .number(value):
            guard value.isFinite, value == value.rounded(), abs(value) < 9_007_199_254_740_992 else { return nil }
            return Int(value)
        default: return nil
        }
    }

    public var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }

    public subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }
}

public enum JSONParseError: Error, Equatable {
    case invalidUTF8
    case malformed(String)
}

public enum JSONParser {
    /// Parses one JSON text into a `JSONValue`. Uses Foundation's parser and
    /// then normalizes the untyped tree so booleans and integers are preserved.
    public static func parse(_ text: String) -> Result<JSONValue, JSONParseError> {
        guard let data = text.data(using: .utf8) else { return .failure(.invalidUTF8) }
        return parse(data)
    }

    public static func parse(_ data: Data) -> Result<JSONValue, JSONParseError> {
        do {
            let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            return .success(convert(object))
        } catch {
            return .failure(.malformed(error.localizedDescription))
        }
    }

    private static func convert(_ any: Any) -> JSONValue {
        switch any {
        case is NSNull:
            return .null
        case let number as NSNumber:
            return convertNumber(number)
        case let string as String:
            return .string(string)
        case let array as [Any]:
            return .array(array.map(convert))
        case let dictionary as [String: Any]:
            var result: [String: JSONValue] = [:]
            for (key, value) in dictionary { result[key] = convert(value) }
            return .object(result)
        default:
            return .null
        }
    }

    private static func convertNumber(_ number: NSNumber) -> JSONValue {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return .bool(number.boolValue)
        }
        let type = String(cString: number.objCType)
        let integerTypes: Set<String> = ["c", "s", "i", "l", "q", "C", "S", "I", "L", "Q"]
        if integerTypes.contains(type) {
            return .int(number.intValue)
        }
        let double = number.doubleValue
        if double.isFinite, double == double.rounded(), abs(double) < 9_007_199_254_740_992 {
            return .int(Int(double))
        }
        return .number(double)
    }
}
