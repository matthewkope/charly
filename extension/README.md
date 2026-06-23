# 📎 Clip to Charly — browser extension

Save the page you're reading — or any link — straight into a folder of your
[Charly](../README.md) library, without leaving the browser.

- **PDFs** are downloaded as real files into the chosen folder (and open in
  Charly's built-in reader immediately).
- **Web pages & videos** are saved as small portable `.charlylink` JSON files
  (title, URL, site, description, thumbnail URL) next to your documents.

## How it works

The Charly desktop app runs a tiny HTTP server on `http://127.0.0.1:8765`
(localhost only). The extension asks it for your library's folder list and POSTs
clips to it. Nothing leaves your machine — there's no account and no cloud.

```
browser extension  ──POST /clip──▶  Charly app (127.0.0.1:8765)  ──▶  your library folder
```

## Install (Chrome / Edge / Brave / any Chromium browser)

1. Open the **Charly desktop app** at least once and pick a library folder.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Pin **Clip to Charly** to your toolbar.

> Firefox: load `manifest.json` via `about:debugging` → *This Firefox* →
> *Load Temporary Add-on*. (MV3 service workers work in current Firefox.)

## Use

- **Toolbar button** → opens a popup showing the current page, lets you pick a
  destination folder, and clips it. Your last-used folder is remembered.
- **Right-click a page or a link** → *Clip … to Charly* sends it straight to
  your last-used folder (a ✓ badge confirms it).

If the popup says it can't reach Charly, make sure the desktop app is open.

## Note on security

The clip server listens only on `127.0.0.1` and replies with a permissive CORS
header so the extension can reach it. Any local program (or web page) could in
principle POST a link to it — the only effect is a link/PDF being saved into
your library, so the risk is low, but the server is intentionally local-only.
The port (`8765`) is fixed and mirrored in `manifest.json` and `src-tauri/src/lib.rs`.
