# Installation

> Download the build for your platform from GitHub Releases, install it, and open a Markdown or XML file.

leaftext ships prebuilt binaries for macOS and Windows. There is no account, no plugin setup, and no extra runtime to configure first.

## Platforms

| Platform | Package | Notes |
| --- | --- | --- |
| macOS | `.dmg` | Universal (Apple Silicon + Intel) |
| Windows | `.msi` | Windows 10+ 64-bit |

Each release also carries a `.blake3` checksum beside every download, and a `.app.zip` of the macOS bundle. Those are what the [in-app updater](#updates) fetches and verifies; installing by hand needs only the `.dmg` or `.msi`.

Download the latest build from [GitHub Releases](https://github.com/ryanallen/leaftext/releases).

## Install

### macOS

1. Download the latest `.dmg`.
2. Open it.
3. Drag `leaftext.app` into `Applications`.
4. Eject the DMG.

If macOS blocks the first launch because the app is from an unidentified developer:

```sh
xattr -cr /Applications/leaftext.app
```

> [!TIP]
> You only need to run that command once per installed app bundle.

### Windows

1. Download the latest `.msi`.
2. Run the installer. It shows one screen: the install folder, with **Change...** to pick another. Click **Install**. There is no elevation prompt and no confirmation screen — leaftext installs for the current user, and the window closes once the install finishes.
3. Launch **Leaf Text** from the Start Menu, or press the Windows key and type its name.

Default installed path, though **Change...** puts it wherever you like and later updates keep it there:

```text
%LOCALAPPDATA%\Programs\leaftext\bin\leaftext.exe
```

WebView2 data lives here:

```text
%LOCALAPPDATA%\ryanallen\leaftext\data\webview2
```

leaftext never needs administrator rights — not to install, not to update.

> [!NOTE]
> The installer adds one Start Menu entry and no desktop shortcut. Drag it to the desktop or taskbar if you want it there too.

> [!IMPORTANT]
> **Upgrading from v0.1.364 or earlier: uninstall the old version first.** Those installed into `C:\Program Files` for the whole machine, and a per-user package has no authority to remove one. Install the new version without doing so and you will have two copies. Uninstall from **Settings → Apps**, then install.

## Launch

```mermaid
flowchart LR
    A[Install leaftext] --> B[Launch app]
    B --> C[Open .md or .xml file]
    C --> D[Read]
```

Use `Ctrl+O` on Windows or `Cmd+O` on macOS to open your first file.

## Updates

leaftext checks GitHub Releases for a newer version, at most once every six hours, and again on that interval while the window stays open. When one is available, a green dot appears over the Settings button and a button appears at the top of the [Settings](01-features/05-settings.md#updates) menu.

With **Download updates** on (the default), the new installer downloads in the background and is checked against the `.blake3` digest published with the release; a download that does not match is discarded. While it runs, the button shows a spinner and its percentage and the dot becomes a spinning ring. The button then reads **Restart to update**, and clicking it closes leaftext, installs, and reopens it.

Nothing installs on its own. The download is automatic; the install is always a button you press. Turning **Download updates** off keeps the check but nothing is fetched — the button just opens the release page, and you install by hand.

To ask right now rather than wait out the six hours, use **Check for updates** at the foot of the Settings panel. The line beside it always reports the outcome — up to date, when it last checked, or what went wrong — including an install that failed after a restart, which is otherwise invisible because the installer runs after leaftext exits. Startup is never blocked by any of this, and being offline only changes what that line says.

## FAQ

### Admin rights

No, never. leaftext installs into your user profile and runs from there, so neither installing nor updating needs administrator rights. App data lives alongside it: `%APPDATA%\ryanallen\leaftext\config` for settings and recent files, `%LOCALAPPDATA%\ryanallen\leaftext\data` for the WebView2 cache and the library index.

### Data paths

See [Settings](01-features/05-settings.md#paths).

### Next

Go to [Quickstart](03-quickstart.md).
