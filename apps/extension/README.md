# Aether Vault — Chrome extension

One-click save the current page, a link, or selected text to your self-hosted Aether Vault.

## Prerequisites

1. Run the vault web app (default `http://127.0.0.1:4173`).
2. **Log in to the vault in Chrome** on that origin so session cookies exist.

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this folder: `apps/extension`.

## Usage

- **Toolbar popup** — set your vault origin, then **Save this page**.
- **Context menu** — right-click a page, link, or selection → **Save to Aether Vault**.

### How saving works

The extension tries two paths:

1. **Direct API** — `POST {origin}/api/capture/url` with `credentials: 'include'` and `X-CSRF-Token` from the `vault_csrf` cookie (requires `cookies` + matching `host_permissions`).
2. **Deep link fallback** — opens `{origin}/capture-ext?url=…&title=…&text=…` in a new tab; the web app opens the capture modal prefilled (same behavior as PWA share for URLs/text).

If your vault runs on a host other than `http://127.0.0.1:4173`, set the origin in the popup. For HTTPS vaults, `host_permissions` already includes `https://*/*`. For other HTTP dev URLs, add them under `host_permissions` in `manifest.json`.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest |
| `background.js` | Context menus |
| `popup.html` / `popup.js` | Settings + save current page |
| `lib/capture.js` | API + `/capture-ext` helpers |