import Foundation

/// Builders for the two stdout message kinds. Every message becomes exactly
/// one line through `JSONLineEncoder`.
public enum ProtocolMessages {
    public static func response(id: String, result: JSONValue) -> JSONValue {
        .object([
            "type": .string("response"),
            "id": .string(id),
            "v": .string(ProtocolConstants.protocolVersion),
            "ok": .bool(true),
            "result": result
        ])
    }

    public static func response(id: String, error: HelperError) -> JSONValue {
        .object([
            "type": .string("response"),
            "id": .string(id),
            "v": .string(ProtocolConstants.protocolVersion),
            "ok": .bool(false),
            "error": .object([
                "code": .string(error.code.rawValue),
                "message": .string(error.message)
            ])
        ])
    }

    public static func event(name: HelperEventName, timestampMs: Double, seq: Int,
                             data: [String: JSONValue]) -> JSONValue {
        .object([
            "type": .string("event"),
            "v": .string(ProtocolConstants.protocolVersion),
            "event": .string(name.rawValue),
            "ts": .number(timestampMs),
            "seq": .int(seq),
            "data": .object(data)
        ])
    }

    /// Encodes and guarantees a single physical line (no CR/LF inside).
    public static func encodeLine(_ value: JSONValue) -> String {
        let encoded = JSONLineEncoder.encode(value)
        if encoded.contains("\n") || encoded.contains("\r") {
            return encoded.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        }
        return encoded
    }
}

/// Thread-safe monotonically increasing sequence number plus wall-clock stamp.
public final class EventSequencer {
    private let lock = NSLock()
    private var counter = 0
    private let clock: () -> Double

    public init(clock: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.clock = clock
    }

    public func next() -> (seq: Int, timestampMs: Double) {
        lock.lock()
        defer { lock.unlock() }
        let seq = counter
        counter += 1
        return (seq, clock())
    }
}

/// Lock-protected boolean used as the emergency-stop flag. Readers are cheap;
/// writers are rare. Kept in HelperCore so the cancellation contract is testable.
public final class StopFlag {
    private let lock = NSLock()
    private var stopped = false

    public init() {}

    public var isSet: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    public func set() {
        lock.lock()
        stopped = true
        lock.unlock()
    }

    public func clear() {
        lock.lock()
        stopped = false
        lock.unlock()
    }
}
