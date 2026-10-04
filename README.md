<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="website/assets/cat-white.png">
    <img src="website/assets/cat-black.png" width="112" alt="Meowcast cat logo">
  </picture>
</p>

<h1 align="center">Meowcast</h1>

<p align="center">Your keyboard launcher. Your AI connections. A cat for company.</p>

<p align="center">
  <a href="https://github.com/hustlerv369/meowcast/releases">Download</a> ·
  <a href="https://vojtacode.online">Website</a> ·
  <a href="#build-on-windows">Build from source</a> ·
  <a href="docs/CONTRIBUTING.md">Contribute</a>
</p>

A free, open-source desktop launcher with a cat companion. Meowcast is a Windows-focused alternative to Raycast: find your apps, keep reusable text close, and connect your own AI tools.

**Windows preview.** Download available builds from [GitHub Releases](https://github.com/hustlerv369/meowcast/releases) and read the notes for that version. Windows packages are unsigned unless the release notes explicitly say otherwise. AI providers set their own subscription limits and API prices. An AI subscription is not included.

## Free to use. Open to change.

The application source is **MIT licensed**. You can inspect it, modify it, redistribute it and use it commercially under the license, including its copyright and permission notice requirements. Change the shortcuts, edit the prompts, or fork the project for your own workflow.

The code license does not grant rights to third-party names, logos or restricted upstream artwork. See [License and attribution](#license-and-attribution) before redistributing a fork.

## What's here

- **Launcher:** keyboard search, favorite items, usage ordering and customizable settings. Default shortcut: Alt + Space.
- **Everyday tools:** notes, text snippets, clipboard history and an offline whiteboard.
- **Text studio:** editable AI actions, offline Prompt Master, supported subscription clients and API connections.
- **Meowmate:** a cat dock with Codex chat, model selection and project tasks. Project tasks can modify the selected folder and run commands.
- **Images:** offline prompt preparation, reference selection and a Gemini browser workflow. Availability depends on your Google account and the browser integration.
- **Appearance:** customizable light and dark themes, with an option to follow the system setting.

Connections depend on the installed client, account permissions and provider behavior. A configured provider does not mean its connection has been tested. There is no silent fallback from a subscription to a paid API.

## Your data and connections

Settings, notes and whiteboards live on your computer. Clipboard history is optional. Meowmate keeps its own settings and task history.

Online features send data to the services you choose. AI prompts and attached content go to the selected provider or official client; project agents may read and modify the selected folder under their configured permissions. Search, translation, weather and favicon extensions can also make network requests. Local storage does not mean every feature is offline.

Use the supported credential settings or an official client's login. Keep tokens and private project contents out of issue reports. Read the [privacy statement](app/PRIVACY_STATEMENT) for details.

## Build on Windows

Requirements: Node.js 22 or newer, npm, Rust stable with the Windows MSVC target, Visual Studio C++ Build Tools, and WebView2 Runtime. Use the official Codex client and its normal login if you want subscription chat. Keep credentials in the app's supported secure settings or official client. Never put them in this repository.

```powershell
git clone https://github.com/hustlerv369/meowcast.git
cd meowcast
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

This builds Meowmate, stages it into the launcher and produces the Windows installer and portable ZIP under `app/release`. The build is unsigned unless you configure your own signing certificate. No signing keys or personal profiles are included.

To work on just the launcher:

```powershell
cd app
npm ci
npm run dev
```

For the companion source and its build details, see [meowmate](meowmate/README.md).

## Make it yours

The launcher uses Electron, React and TypeScript. Meowmate has a TypeScript interface with a Tauri/Rust native layer. They are separate applications packaged together on Windows.

| Change | Source |
| --- | --- |
| Launcher layout and settings | `app/src/renderer` |
| Search, actions and integrations | `app/src/main` |
| Shared types and defaults | `app/src/common` |
| Companion interface and cat | `meowmate/src` |
| Companion native commands | `meowmate/src-tauri` |
| Product website | `website` |

Run `npm run check` and `npm run build` in `app` before packaging. The companion has TypeScript and Rust checks plus Node tests. Tests that mock a browser or provider do not establish native desktop or live AI behavior.

## Contribute

Bug reports, documentation fixes and small pull requests are welcome. Include your app version, operating system and steps to reproduce. For a larger change, open an issue to discuss the scope first.

Read the [contribution guide](docs/CONTRIBUTING.md) for checks and review expectations.

## Current limits

Windows is the development platform. macOS launcher build configuration is included, but a native Mac release and Mac companion integration have not been accepted. Cloud sync and multi-app window layouts are not implemented. Voice dictation is outside this preview. Provider and browser integrations can change independently of Meowcast; verify the flow with your account before relying on it.

The apps preserve their original internal identifiers for existing local data. Meowcast's internal package name is `hustlecmd`. The companion's internal executable is `coucou.exe`. These identifiers are not the product names.

## License and attribution

Application code is MIT licensed. Meowcast builds on [Ueli](https://github.com/oliverschwendener/ueli), by Oliver Schwendener. Meowmate's infrastructure builds on [Coucou](https://github.com/Louis-CFM/coucou), by Louis Raillé. Original license notices are retained.

The public companion uses original cat artwork and its own small animation implementation. Upstream Coucou/Mochi characters, sounds, promotional media and icons are excluded. Third-party names and logos identify their respective tools. This project is not affiliated with Raycast, OpenAI, Google, Anthropic or Cursor.

See [LICENSE](LICENSE), [app/LICENSE](app/LICENSE), [meowmate/LICENSE](meowmate/LICENSE), the retained [upstream asset restrictions](meowmate/LICENSE-ASSETS.md) and the [companion notice](meowmate/NOTICE.txt). Please do not include credentials, personal conversations or project contents in issues.
