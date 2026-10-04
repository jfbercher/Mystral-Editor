---
title: Desktop Application (Tauri)
---

Mystral Editor is packaged as a native cross-platform desktop application using [Tauri](https://tauri.app/), with pre-built releases for **macOS** (Apple Silicon and Intel), **Linux** (x64 and ARM64), and **Windows**. The app is registered as the default handler for `.myst`, `.md`, `.markdown`, and `.txt` files.

Key Tauri-specific features:

- **Native file dialogs** for open, save and directory selection
- **Single-instance enforcement**: opening a second file re-uses the running window
- **File-association launch**: dragging a file onto the app or double-clicking it in the OS opens it directly in a new tab
- **Auto-updater**: the app checks for new releases at startup and can install updates in place (via a GitHub Releases endpoint)
- **External link handling**: links in the preview open in the system browser rather than the webview
- **Webview zoom**: Cmd/Ctrl +/-/0 scales the entire UI
- **Logging** via the Tauri logging plugin

The desktop application also carries an **export menu**, which the web build cannot have since it shells out to [mystmd](https://mystmd.org): PDF, LaTeX and Word through `myst build`, an HTML export that writes out the rendered preview with the editor's stylesheets inlined, and the project-level `myst build` and `myst start` commands. When the folder has no `myst.yml`, or the document declares no export entry for the format, the editor says which is missing and offers to set both up and export in one go. See [export](export.md).

:::{figure} figures/exports.gif
:name: exports
:width: 95%

Demo of export possibilities. In Tauri apps, mystmd is called to build the output
:::

A GitHub Actions workflow (`release.yaml`) builds and signs all platform variants on every `v*` tag push, producing installer artifacts published to GitHub Releases. A `Makefile` `release` target automates version bumping, tagging and pushing.

For users who prefer a browser-based setup, a minimal Node.js server (`server.mjs`) serves the built `dist/` folder as a single-page application with `/api/file` endpoints for local file read/write, replicating the file-access layer without Tauri.