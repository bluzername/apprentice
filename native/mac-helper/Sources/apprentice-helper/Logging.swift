import Foundation

/// All diagnostics go to stderr with a `[helper]` prefix. stdout is reserved
/// for protocol lines and must never receive log output.
enum Log {
    private static let lock = NSLock()

    static func info(_ message: String) {
        write("[helper] \(message)\n")
    }

    static func warn(_ message: String) {
        write("[helper] warning: \(message)\n")
    }

    static func error(_ message: String) {
        write("[helper] error: \(message)\n")
    }

    private static func write(_ text: String) {
        lock.lock()
        defer { lock.unlock() }
        FileHandle.standardError.write(Data(text.utf8))
    }
}

/// Plain-text failure used where a message is the only payload.
struct MessageError: Error {
    let message: String
}
