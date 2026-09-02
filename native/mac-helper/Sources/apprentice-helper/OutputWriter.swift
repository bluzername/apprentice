import Foundation
import HelperCore

/// Serializes protocol messages to stdout, one JSON object per line, flushed
/// after every write. Sequence numbers are assigned under the same lock as the
/// write so event order on the wire always matches `seq` order.
final class OutputWriter {
    private let lock = NSLock()
    private let sequencer: EventSequencer

    init(sequencer: EventSequencer) {
        self.sequencer = sequencer
    }

    func respond(id: String, result: JSONValue) {
        write(ProtocolMessages.response(id: id, result: result))
    }

    func respond(id: String, error: HelperError) {
        write(ProtocolMessages.response(id: id, error: error))
    }

    func respond(id: String, _ outcome: Result<JSONValue, HelperError>) {
        switch outcome {
        case let .success(result): respond(id: id, result: result)
        case let .failure(error): respond(id: id, error: error)
        }
    }

    func emit(_ event: HelperEventName, data: [String: JSONValue]) {
        lock.lock()
        defer { lock.unlock() }
        let stamp = sequencer.next()
        writeLocked(ProtocolMessages.event(name: event, timestampMs: stamp.timestampMs, seq: stamp.seq, data: data))
    }

    func write(_ value: JSONValue) {
        lock.lock()
        defer { lock.unlock() }
        writeLocked(value)
    }

    func flush() {
        lock.lock()
        defer { lock.unlock() }
        fflush(stdout)
    }

    private func writeLocked(_ value: JSONValue) {
        let line = ProtocolMessages.encodeLine(value) + "\n"
        fputs(line, stdout)
        fflush(stdout)
    }
}
