import XCTest
@testable import HelperCore

final class ProtocolCodecTests: XCTestCase {
    func testRequestDecodeRoundTrip() throws {
        let request = HelperRequest(id: "abc", command: .performAction,
                                    params: ["approvalToken": .string("token-123"), "n": .int(2)])
        let line = JSONLineEncoder.encode(request.toJSON())
        guard case let .request(decoded) = RequestDecoder.decode(line: line) else {
            return XCTFail("expected request")
        }
        XCTAssertEqual(decoded, request)
    }

    func testRequestWithoutParamsDecodes() {
        guard case let .request(decoded) = RequestDecoder.decode(line: #"{"id":"1","v":"1.0","cmd":"ping"}"#) else {
            return XCTFail("expected request")
        }
        XCTAssertEqual(decoded.command, .ping)
        XCTAssertEqual(decoded.params, [:])
    }

    func testUnknownCommandIsReportedWithRequestId() {
        let decoded = RequestDecoder.decode(line: #"{"id":"7","v":"1.0","cmd":"launchRockets"}"#)
        XCTAssertEqual(decoded, .failure(id: "7", error: HelperError(.unknownCommand, "unknown command: launchRockets")))
    }

    func testMalformedLineUsesUnknownId() {
        guard case let .failure(id, error) = RequestDecoder.decode(line: "{not json") else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(id, "unknown")
        XCTAssertEqual(error.code, .invalidRequest)
    }

    func testMissingIdIsInvalidRequest() {
        guard case let .failure(id, error) = RequestDecoder.decode(line: #"{"v":"1.0","cmd":"ping"}"#) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(id, "unknown")
        XCTAssertEqual(error.code, .invalidRequest)
    }

    func testWrongVersionIsInvalidRequest() {
        guard case let .failure(id, error) = RequestDecoder.decode(line: #"{"id":"9","v":"2.0","cmd":"ping"}"#) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(id, "9")
        XCTAssertEqual(error.code, .invalidRequest)
    }

    func testNonObjectParamsRejected() {
        guard case let .failure(_, error) = RequestDecoder.decode(line: #"{"id":"9","v":"1.0","cmd":"ping","params":[1]}"#) else {
            return XCTFail("expected failure")
        }
        XCTAssertEqual(error.code, .invalidRequest)
    }

    func testEveryCommandNameDecodes() {
        for command in HelperCommand.allCases {
            let line = #"{"id":"x","v":"1.0","cmd":"\#(command.rawValue)"}"#
            guard case let .request(request) = RequestDecoder.decode(line: line) else {
                return XCTFail("command \(command.rawValue) failed to decode")
            }
            XCTAssertEqual(request.command, command)
        }
    }

    func testSuccessResponseShape() throws {
        let line = ProtocolMessages.encodeLine(ProtocolMessages.response(id: "1", result: .object(["pong": .bool(true)])))
        let parsed = try XCTUnwrap(JSONParser.parse(line).successValue)
        XCTAssertEqual(parsed["type"], .string("response"))
        XCTAssertEqual(parsed["id"], .string("1"))
        XCTAssertEqual(parsed["v"], .string("1.0"))
        XCTAssertEqual(parsed["ok"], .bool(true))
        XCTAssertEqual(parsed["result"]?["pong"], .bool(true))
        XCTAssertNil(parsed["error"])
    }

    func testErrorResponseShape() throws {
        let line = ProtocolMessages.encodeLine(ProtocolMessages.response(id: "2", error: HelperError(.captureFailed, "nope")))
        let parsed = try XCTUnwrap(JSONParser.parse(line).successValue)
        XCTAssertEqual(parsed["ok"], .bool(false))
        XCTAssertEqual(parsed["error"]?["code"], .string("capture_failed"))
        XCTAssertEqual(parsed["error"]?["message"], .string("nope"))
        XCTAssertNil(parsed["result"])
    }

    func testEventShape() throws {
        let line = ProtocolMessages.encodeLine(ProtocolMessages.event(
            name: .mouseDown, timestampMs: 1_700_000_000_123.5, seq: 4,
            data: ["x": .number(10.5), "y": .int(20), "button": .string("left"), "bundleId": .string("com.a")]))
        let parsed = try XCTUnwrap(JSONParser.parse(line).successValue)
        XCTAssertEqual(parsed["type"], .string("event"))
        XCTAssertEqual(parsed["event"], .string("mouseDown"))
        XCTAssertEqual(parsed["seq"], .int(4))
        XCTAssertEqual(parsed["ts"]?.doubleValue, 1_700_000_000_123.5)
        XCTAssertEqual(parsed["data"]?["x"], .number(10.5))
    }

    func testErrorCodesMatchContract() {
        let expected = ["invalid_request", "unknown_command", "permission_denied", "not_available",
                        "capture_failed", "ocr_failed", "action_rejected", "emergency_stopped", "internal"]
        XCTAssertEqual(HelperErrorCode.allCases.map(\.rawValue), expected)
    }

    func testErrorMessageIsTruncated() {
        let error = HelperError(.internalError, String(repeating: "x", count: 5000))
        XCTAssertEqual(error.message.count, ProtocolConstants.maxErrorMessageLength)
    }
}

extension Result {
    var successValue: Success? {
        if case let .success(value) = self { return value }
        return nil
    }

    var failureError: Failure? {
        if case let .failure(error) = self { return error }
        return nil
    }
}
