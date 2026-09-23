## 📦 Installation Guide & macOS Gatekeeper Fix

Since this application is not distributed through the Mac App Store, macOS security (**Gatekeeper**) will display a warning upon first launch:

> ❌ *“"AppName" cannot be opened because it is from an unidentified developer”* or *“Apple cannot check it for malicious software”*.

Below are the three simple ways to bypass this warning and launch the app safely.

---

### Method 1: Right-Click / Control-Click (Recommended)

This is the standard, quickest way to authorize a non-notarized app on macOS.

1. Download and open the **`.dmg`** file.
2. Drag and drop the app icon into your **Applications** folder.
3. Open your **Applications** folder in Finder.
4. **Right-click** (or hold the `Control` key and click) on the app icon.
5. Select **Open** from the context menu.
6. In the pop-up warning box, click **Open**.

> **Note:** You only need to do this **once**. The app will launch normally via double-click in the future.

---

### Method 2: System Settings Override (macOS Sequoia & Later)

If the right-click menu doesn't show the open option:

1. Move the app to your **Applications** folder.
2. Double-click the app to launch it (the blocked prompt will appear). Click **OK**.
3. Open **System Settings** on your Mac.
4. Navigate to **Privacy & Security**.
5. Scroll down to the **Security** section.
6. You will see a notice that the app was blocked. Click **Open Anyway**.
7. Enter your Mac password or use Touch ID when prompted to confirm.

---

### Method 3: Terminal Command (Advanced Users)

Gatekeeper blocks downloaded binaries by assigning a quarantine attribute (`com.apple.quarantine`). You can instantly remove this attribute via the Terminal:

1. Open the **Terminal** app (`Cmd + Space` > *Terminal*).
2. Run the following command:

```bash
xattr -d com.apple.quarantine /Applications/YourAppName.app