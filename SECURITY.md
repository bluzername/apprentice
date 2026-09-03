# Security policy

Apprentice is an alpha. It records what you allow it to record, encrypts it on your Mac, and
never lets a model act without deterministic validation and your approval. If you find a way to
break any of that, please tell us privately first.

## Reporting a vulnerability

Open a [private security advisory](../../security/advisories/new) on GitHub. Include the build
you tested (`Settings > About` or `git rev-parse HEAD`), the steps to reproduce, and what data or
action was exposed. You will get an acknowledgement within a few days.

Please do not file public issues for anything that could expose captured data, bypass the
allowlist, or make the helper perform an unapproved action.

## What counts

- Capture of an app, domain, field, keystroke or clipboard that the allowlist or the privacy
  invariants say is never captured.
- Any path from model output to an OS action that skips schema validation, the risk engine, the
  policy, or the approval token check in the helper.
- Reading the encrypted screenshot store or the master key without the macOS keychain.
- The loopback pairing protocol accepting a browser extension without a valid token.
- Feedback uploads containing titles, URLs, OCR text, screenshots, or free text the user was not
  warned about.

The full threat model, trust boundaries and mitigations are in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md); the data-handling rules are in
[docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md).

## Supported versions

Only the latest commit on `main` and the latest alpha bundle receive fixes.
