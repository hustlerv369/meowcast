# Meowcast website

English product website for Meowcast on Windows, with an interactive launcher illustration. The illustration does not run desktop commands or save notes.

## Static hosting

Serve these files together: `index.html`, `style.css`, `app.js`, `assets/cat-black.png`, and `assets/cat-white.png`.

The [Windows installer](https://github.com/hustlerv369/meowcast/releases/tag/v9.30.0-preview.16) is linked in the HTML after verifying its public upload and HTTP 200 response. Downloading works without JavaScript and during GitHub API outages or rate limits. Optional metadata checks cannot replace that known URL with an unknown asset. Update the pinned version only after the replacement installer has been uploaded and verified. A restrictive Content Security Policy may allow connections to `https://api.github.com` for optional metadata checks; the download itself does not depend on them.

No application accounts, tracking, external fonts, forms, or AI provider calls are used by the website. Mac support and provider compatibility remain subject to the limits described on the page.

## Local installer delivery

Run `node server.cjs` from this directory and open `http://127.0.0.1:4317`. The server binds to this computer only. When `download-state.json` contains `ready: true` and the verified installer exists, `/download/windows` serves `app/release/Meowcast Setup 9.30.0-preview.16.exe` with attachment headers. The page prefers that local route over GitHub. Missing or unready installers return HTTP 503. No parent directories or application profiles are served.

Static deployments do not contact localhost. Publication of this source does not by itself confirm deployment to a domain.
