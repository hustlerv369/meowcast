# Meowmate

A Windows desktop companion for local agent activity, Codex subscription chat, project tasks, file attachments, and image-prompt preparation. This is the public source export used alongside Meowcast.

## Build on Windows

Install Node.js 22 or newer, Rust with the MSVC toolchain, Visual Studio C++ Build Tools and the Windows SDK. Windows needs the WebView2 runtime. Run these commands in this directory:

```powershell
npm ci
npm run build
npm run tauri -- build --no-bundle -- --locked
```

The frontend build first compiles the local hook relay. The application is written to `target/release/coucou.exe`. keep `target/release/coucou-hook.exe` beside the portable executable. The executable name and application identifier are legacy compatibility details. The visible product is Meowmate.

To build an installer, use `npm run pack`. To regenerate the original cat icon files, use `npm run icons`.

## Development and checks

```powershell
npm run tauri -- dev
node --experimental-strip-types --test tests/*.test.mjs
cargo test --release --locked --lib --no-run
```

Browser fixtures in `tests/*.browser.html` can be served by Vite for mocked interaction checks. Native tests may require the Common Controls manifest in `tests/native-test.manifest` on Windows.

## Connections and limits

Codex must be installed and signed in separately. Chat models come from its available catalog. changing a model after messages requires a new chat. Project task models are chosen per run. Project agents can edit the selected project and run commands under the Windows account, subject to their existing agent approval behavior.

Claude Code tasks depend on its own installation, sign-in, subscription, and organization policy. An installed app, configured model, or valid sign-in does not prove a successful request. No provider credentials ship in this repository.

Images prepares a prompt locally and opens Gemini in your browser. Generation and download happen there using your account. No in-app image-generation connection is claimed.

This export ships without sounds. The cat, greeting and attachment presentation use original minimal replacement rendering. Read EXPORT-DIFFERENCES.md before comparing it with earlier private previews.

## License

Source code is MIT. upstream attribution is retained in LICENSE and NOTICE.txt. LICENSE-ASSETS.md describes excluded upstream branding and artwork. those restricted assets are not included. This project is not endorsed by the upstream author.
