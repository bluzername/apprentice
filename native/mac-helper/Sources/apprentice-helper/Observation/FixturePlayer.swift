import Foundation
import HelperCore

/// Replays parsed fixture records as protocol events with real timestamps
/// and the shared sequence counter. Cancellable between records.
final class FixturePlayer {
    private let records: [FixtureRecord]
    private let writer: OutputWriter
    private let cancelled = StopFlag()
    private var thread: Thread?

    var onFinished: (() -> Void)?

    init(records: [FixtureRecord], writer: OutputWriter) {
        self.records = records
        self.writer = writer
    }

    static func load(path: String) -> Result<[FixtureRecord], HelperError> {
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            return .failure(HelperError(.invalidRequest, "fixture file could not be read: \(path)"))
        }
        switch FixtureParser.parse(text: text) {
        case let .success(records):
            return .success(records)
        case let .failure(.malformedLine(lineNumber, reason)):
            return .failure(HelperError(.invalidRequest, "fixture line \(lineNumber): \(reason)"))
        }
    }

    func start() {
        let thread = Thread { [self] in run() }
        thread.name = "apprentice.helper.fixture"
        thread.start()
        self.thread = thread
    }

    func stop() {
        cancelled.set()
    }

    private func run() {
        for record in records {
            guard sleepUnlessCancelled(ms: record.delayMs) else { return }
            writer.emit(record.event, data: record.data)
        }
        guard !cancelled.isSet else { return }
        Log.info("fixture replay finished (\(records.count) events)")
        onFinished?()
    }

    private func sleepUnlessCancelled(ms: Double) -> Bool {
        let deadline = Date().addingTimeInterval(ms / 1000)
        while Date() < deadline {
            if cancelled.isSet { return false }
            let remaining = deadline.timeIntervalSinceNow
            usleep(UInt32(max(0, min(0.025, remaining)) * 1_000_000))
        }
        return !cancelled.isSet
    }
}
