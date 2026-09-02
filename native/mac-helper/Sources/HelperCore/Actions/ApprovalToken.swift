import CryptoKit
import Foundation

/// Per-spawn secret handed to the helper by the Electron main process through
/// the APPRENTICE_HELPER_SECRET environment variable (32 bytes, hex).
public struct ApprovalSecret {
    public static let environmentVariable = "APPRENTICE_HELPER_SECRET"
    public static let byteCount = 32

    let key: SymmetricKey

    /// Fails unless `hex` is exactly 64 hex characters.
    public init?(hex: String) {
        guard let bytes = HexBytes.decode(hex), bytes.count == Self.byteCount else { return nil }
        key = SymmetricKey(data: bytes)
    }

    public init(bytes: Data) {
        key = SymmetricKey(data: bytes)
    }

    /// Reads the secret from `environment` (defaults to the process
    /// environment). `nil` when the variable is missing or malformed; the
    /// value is never logged.
    public static func fromEnvironment(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> ApprovalSecret? {
        guard let raw = environment[environmentVariable] else { return nil }
        return ApprovalSecret(hex: raw)
    }
}

/// Verifies `approvalToken == hex(HMAC-SHA256(secret, CanonicalJSON(action)))`.
public enum ApprovalTokenVerifier {
    public static let tokenLength = 64
    public static let missingSecretError = HelperError(.actionRejected, "helper started without an approval secret")
    public static let mismatchError = HelperError(.actionRejected, "approval token does not match the action")

    /// The token the app must present for `action` (hex, lowercase).
    public static func expectedToken(secret: ApprovalSecret, action: [String: JSONValue]) -> String {
        let mac = HMAC<SHA256>.authenticationCode(for: Data(CanonicalJSON.encode(.object(action)).utf8), using: secret.key)
        return HexBytes.encode(Data(mac))
    }

    /// Constant-time verification via CryptoKit. Without a secret every action
    /// is refused: the helper was not started by the app.
    public static func verify(token: String, action: [String: JSONValue], secret: ApprovalSecret?) -> Result<Void, HelperError> {
        guard let secret else { return .failure(missingSecretError) }
        guard token.count == tokenLength, let presented = HexBytes.decode(token) else { return .failure(mismatchError) }
        let message = Data(CanonicalJSON.encode(.object(action)).utf8)
        guard HMAC<SHA256>.isValidAuthenticationCode(presented, authenticating: message, using: secret.key) else {
            return .failure(mismatchError)
        }
        return .success(())
    }
}

enum HexBytes {
    static func decode(_ hex: String) -> Data? {
        let scalars = Array(hex.utf8)
        guard scalars.count % 2 == 0 else { return nil }
        var bytes = Data(capacity: scalars.count / 2)
        var index = 0
        while index < scalars.count {
            guard let high = nibble(scalars[index]), let low = nibble(scalars[index + 1]) else { return nil }
            bytes.append(high << 4 | low)
            index += 2
        }
        return bytes
    }

    static func encode(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private static func nibble(_ char: UInt8) -> UInt8? {
        switch char {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return char - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return char - UInt8(ascii: "a") + 10
        default: return nil
        }
    }
}
