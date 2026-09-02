import AppKit
import Foundation
import HelperCore

/// Entry point. Flags:
///   --self-test        print capabilities as a response line and exit 0
///   --fixture <path>   start fixture replay immediately, then serve stdin
struct CommandLineOptions {
    var selfTest = false
    var fixturePath: String?

    static func parse(_ arguments: [String]) -> Result<CommandLineOptions, MessageError> {
        var options = CommandLineOptions()
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--self-test":
                options.selfTest = true
            case "--fixture":
                index += 1
                guard index < arguments.count else { return .failure(MessageError(message: "--fixture requires a path")) }
                options.fixturePath = arguments[index]
            default:
                return .failure(MessageError(message: "unknown argument: \(arguments[index])"))
            }
            index += 1
        }
        return .success(options)
    }
}

let options: CommandLineOptions
switch CommandLineOptions.parse(CommandLine.arguments) {
case let .success(parsed):
    options = parsed
case let .failure(message):
    Log.error(message.message)
    exit(2)
}

// A closed stdout pipe must not kill the process mid-action; EOF on stdin is
// the shutdown signal instead.
signal(SIGPIPE, SIG_IGN)

if options.selfTest {
    let writer = OutputWriter(sequencer: EventSequencer())
    writer.respond(id: "self-test", result: CapabilitiesBuilder.current().toJSON())
    writer.flush()
    exit(0)
}

// NSApplication is required for NSWorkspace notifications; the helper never
// shows UI so it stays out of the Dock and app switcher.
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)

let server = HelperServer(fixturePath: options.fixturePath)
server.start()
Log.info("apprentice-helper \(ProtocolConstants.helperVersion) ready (pid \(ProcessInfo.processInfo.processIdentifier))")
application.run()
