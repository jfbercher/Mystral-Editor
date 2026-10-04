---
title: Getting Started
---

Pre-built binaries for macOS (Apple Silicon and Intel), Linux (x64 and ARM64), and Windows are available on the [Releases page](https://github.com/jfbercher/Mystral-Editor/releases). Download the package for your platform.

Each release carries the following packages, where `x.x.x` is the version
number of the release:

:::{table} Plateforms and packages
:label: Table_of_Distributions

| System | Processor | Package |
| --- | --- | --- |
| macOS | Apple Silicon | `Mystral Editor_x.x.x_aarch64.dmg` |
| macOS | Intel | `Mystral Editor_x.x.x_x64.dmg` |
| Windows | x86-64 | `Mystral Editor_x.x.x_x64-setup.exe` (installer) or `Mystral Editor_x.x.x_x64_en-US.msi` |
| Linux | x86-64 | `Mystral Editor_x.x.x_amd64.deb`, `Mystral Editor-x.x.x-1.x86_64.rpm` or `Mystral Editor_x.x.x_amd64.AppImage` |
| Linux | ARM64 | `Mystral Editor_x.x.x_arm64.deb`, `Mystral Editor-x.x.x-1.aarch64.rpm` or `Mystral Editor_x.x.x_aarch64.AppImage` |
:::

For the website, the files must be compiled manually using the `npm run build` command, then the files generated in `/dist` directory copied to the target website.

The remaining files of a release are not meant to be downloaded by hand: the
`.app.tar.gz` archives and the `.sig` signatures belong to the automatic
updater described below, and `latest.json` is the manifest it reads.

### macOS

After downloading the `.dmg`, drag **Mystral Editor** into your Applications folder. Because the app is not notarized, macOS Gatekeeper will warn that it is from an "unidentified developer."

To open it the first time, right-click (or Control-click) the app icon and choose **Open**. When the dialog appears saying the developer cannot be verified, click **Open** to proceed. Alternatively, open **System Settings --> Privacy & Security** and click **Open Anyway** next to the blocked entry. This one-time approval is all that is needed; subsequent launches proceed normally.

### Windows

When running the installer, Windows SmartScreen may display an "Unknown publisher" warning. Click **More info** in the dialog, then click **Run anyway** to continue with the installation.

### Linux

Install the `.deb` (Debian, Ubuntu and derivatives) or the `.rpm` (Fedora, openSUSE, RHEL) with the distribution's package manager. The `.AppImage` needs no installation at all: make it executable (`chmod +x`) and run it.

### First Launch and File Associations

On first launch the app registers itself as the default handler for `.myst`, `.md`, `.markdown`, and `.txt` files. You can open documents from the OS file manager, by dragging them onto the app window, or from **File -> Open** inside the app.

### Automatic Updates

Mystral Editor checks for updates automatically on each startup. When a new release is published on GitHub, the app downloads it in the background and prompts you to restart and apply the update. No manual download is required for subsequent releases.