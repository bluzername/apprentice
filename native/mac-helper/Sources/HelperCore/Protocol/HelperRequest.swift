import Foundation

/// A decoded request line: {"id","v","cmd","params"?}.
public struct HelperRequest: Equatable {
    public let id: String
    public let version: String
    public let command: HelperCommand
    public let params: [String: JSONValue]

    public init(id: String, version: String = ProtocolConstants.protocolVersion,
                command: HelperCommand, params: [String: JSONValue] = [:]) {
        self.id = id
        self.version = version
        self.command = command
        self.params = params
    }

    public func toJSON() -> JSONValue {
        var object: [String: JSONValue] = [
            "id": .string(id),
            "v": .string(version),
            "cmd": .string(command.rawValue)
        ]
        if !params.isEmpty { object["params"] = .object(params) }
        return .object(object)
    }
}

/// Outcome of decoding one stdin line. Failures carry the id to respond with
/// ("unknown" when the line could not be parsed far enough to find one).
public enum DecodedLine: Equatable {
    case request(HelperRequest)
    case failure(id: String, error: HelperError)
}

public enum RequestDecoder {
    public static func decode(line: String) -> DecodedLine {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure(id: ProtocolConstants.unknownRequestId,
                            error: HelperError(.invalidRequest, "empty line"))
        }
        guard case let .success(value) = JSONParser.parse(trimmed) else {
            return .failure(id: ProtocolConstants.unknownRequestId,
                            error: HelperError(.invalidRequest, "malformed JSON"))
        }
        guard let object = value.objectValue else {
            return .failure(id: ProtocolConstants.unknownRequestId,
                            error: HelperError(.invalidRequest, "request must be a JSON object"))
        }
        return decode(object: object)
    }

    public static func decode(object: [String: JSONValue]) -> DecodedLine {
        guard let id = object["id"]?.stringValue, !id.isEmpty,
              id.count <= ProtocolConstants.maxRequestIdLength else {
            return .failure(id: ProtocolConstants.unknownRequestId,
                            error: HelperError(.invalidRequest, "missing or invalid id"))
        }
        guard let version = object["v"]?.stringValue, version == ProtocolConstants.protocolVersion else {
            return .failure(id: id, error: HelperError(
                .invalidRequest, "unsupported protocol version; expected \(ProtocolConstants.protocolVersion)"))
        }
        guard let commandName = object["cmd"]?.stringValue else {
            return .failure(id: id, error: HelperError(.invalidRequest, "missing cmd"))
        }
        guard let command = HelperCommand(rawValue: commandName) else {
            return .failure(id: id, error: HelperError(.unknownCommand, "unknown command: \(commandName)"))
        }
        var params: [String: JSONValue] = [:]
        if let rawParams = object["params"] {
            guard let parsed = rawParams.objectValue else {
                return .failure(id: id, error: HelperError(.invalidRequest, "params must be an object"))
            }
            params = parsed
        }
        return .request(HelperRequest(id: id, version: version, command: command, params: params))
    }
}
