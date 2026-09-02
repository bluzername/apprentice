# Apprentice Browser Companion

Manifest V3 extension for Chrome, Arc, Brave, Edge, and other Chromium browsers. It sends a
small, value-free stream of browsing events for domains you allowlisted to the Apprentice
desktop app on this computer. It talks only to `127.0.0.1` and never to any other host.

## What is captured (only on allowlisted domains you granted access to)

| Event | Data sent |
| --- | --- |
| `navigation` | Registrable domain and URL path. Query string, fragment, and credentials are stripped. |
| `page_title` | Page title truncated to 160 characters. Encrypted at rest by the desktop app. |
| `click` | Semantic descriptor of the clicked control: role, tag, aria-label, accessible name, short visible text (max 80 chars), an id/name/data-testid identifier, and an 8-character structural fingerprint. |
| `form_submit` | That a form was submitted and a purpose guess (search, login, message, create, update, checkout, upload, unknown) derived from the action path, button text, and field names. |
| `field_input` | The field label (from its label, aria-label, or placeholder) and the length of the value. |
| `copy`, `paste` | That a copy or paste happened. |
| `download` | That a download started, plus the file extension and file name length. |
| `sensitive_pause`, `sensitive_resume` | That capture paused or resumed on a sensitive page. |

## What is never captured

- Field values, keystrokes, or password characters. The extension reads only value lengths.
- Clipboard contents.
- File names or download URLs. Only the extension and name length leave the browser.
- Query strings, URL fragments, or credentials embedded in URLs.
- Anything on domains outside the allowlist, or on allowlisted domains you have not granted access to.
- Anything in incognito or guest windows. The manifest declares `"incognito": "not_allowed"`.
- Anything after a sensitive trigger until you navigate to a different path. Triggers: focusing a
  password field, a field with `autocomplete="cc-*"` or `one-time-code`, a page whose title or
  path matches login, sign-in, password, checkout, payment, billing, 2fa, or verify, or a page
  with `<meta name="apprentice-sensitive">`.
- Anything while the desktop app reports capture disabled, paused, private, or stopped, or while
  you paused capture from the popup.

## Pairing

1. Install the extension (see below) and open the Apprentice desktop app.
2. In the app, open Settings, Browser extension, and read the 6-digit pairing code.
3. Click the extension icon, type the code, and press Pair. The extension probes
   `127.0.0.1:47815` through `47825` for the app, sends the code, and stores the returned token in
   `chrome.storage.local`. The app binds the token to this extension's id and origin.
4. The popup now lists the domains you allowlisted in the app. Click "Grant access for N domains"
   and accept the browser prompt. Access is requested per domain (`https://*.example.com/*` and
   `http://*.example.com/*`); no blanket host permission is ever requested.
5. Reload any tab that was already open on an allowlisted domain. Content scripts are registered
   dynamically and only attach to pages loaded after registration.

Unpairing from the popup deletes the token, unregisters every content script, and stops all
capture. Unpairing in the desktop app has the same effect at the next sync (every 30 seconds) or
at the next event, because the app answers with 401 and the extension clears its pairing.

## Install unpacked (Chrome, Arc, Brave, Edge)

1. Unzip `apprentice-extension.zip` into a folder you will keep (the browser loads it from there).
2. Open the extensions page:
   - Chrome and Arc: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Turn on Developer mode (top right in Chrome, Brave, and Arc; left sidebar in Edge).
4. Click "Load unpacked" and select the unzipped folder (the one containing `manifest.json`).
5. Pin the extension from the toolbar puzzle menu so the popup is easy to reach.

Arc note: Arc opens `chrome://extensions` in a normal tab; the steps are otherwise identical.

## Granting and revoking site access

- The popup's "Grant access" button requests host permission only for allowlisted domains.
- To revoke a single site, open the extension's Details page in the extensions list, then
  "Site access", and remove the site. The next sync unregisters the content script.
- Removing a domain from the allowlist in the desktop app also unregisters its content script and
  sends a stop message to open tabs on that domain.

## Uninstall

Open the extensions page, find Apprentice Browser Companion, and click Remove. This deletes the
stored token and all extension storage. The desktop app keeps its own copy of the pairing until
you remove the browser there as well.

## Troubleshooting

- "Apprentice was not found on 127.0.0.1": the desktop app is not running, or its loopback server
  is on a port outside 47815-47825. Open the app and check Settings, Browser extension, for the
  port it is using.
- Firewall: the connection is local (127.0.0.1) and never leaves the machine. Firewalls that block
  loopback connections for browsers (rare) must allow the browser to reach `127.0.0.1` on the port
  range above.
- "Not paired" after it was working: the app rejected the token (it was unpaired in the app, or the
  app was reinstalled). Pair again with a new code.
- No events for a domain: check that the domain is in the app's allowlist, that "access granted"
  is shown next to it in the popup, that the learning state is "Learning", that capture is not
  paused in the popup, and that the tab was reloaded after access was granted.
- Debugging: in the extensions page, click "service worker" under the extension to open its
  console. Sync failures are logged with the `[apprentice]` prefix.

## Privacy summary

- Local-only: every request goes to `http://127.0.0.1:<port>`; there is no remote endpoint.
- Paired-only: unpaired extensions cannot send anything; a 401 clears the pairing immediately.
- Allowlist-first: content scripts exist only for domains that are both allowlisted in the app and
  granted by you in the browser. There are no static `host_permissions` and no static
  `content_scripts` in the manifest.
- Value-free: input values, keystrokes, clipboard text, file names, and URL parameters never leave
  the page.
- Sensitive-aware: password fields, payment fields, one-time codes, and login, checkout, or billing
  pages pause capture until you move to another path.
- Inspectable: the bundle is not minified, so anyone can read exactly what ships.

## Development

```bash
pnpm --filter @apprentice/chromium-extension typecheck
pnpm --filter @apprentice/chromium-extension test
pnpm --filter @apprentice/chromium-extension build   # dist/ plus dist/apprentice-extension.zip
```

`vite build` emits `background.js` and `popup.js` as ES modules, then builds `content.js` as a
self-contained IIFE (content scripts cannot import modules), then writes `manifest.json`, the popup
HTML/CSS, and the icon set. `scripts/package-zip.ts` zips `dist/` with validated entry names and
prints the path, size, and sha256.
