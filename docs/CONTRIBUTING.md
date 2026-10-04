# Contributing to Meowcast

Start with a small change you can explain and test. For a new feature or a change spanning the launcher and companion, open an issue first so we can agree on the behavior.

## Report a bug

Include the release version, operating system, steps to reproduce and what you expected to happen. A screenshot or a short recording helps with interface problems. Remove tokens, conversations and private file paths from anything you attach.

For AI or browser issues, name the client or provider and the stage that failed. Never attach credentials or a browser profile. An installed client, a successful login and a completed request are different results; say which one you observed.

## Work on the source

Follow the [build instructions](../README.md#build-on-windows). Keep a pull request focused on one behavior, and avoid unrelated formatting changes. Preserve existing license notices and internal identifiers used to locate user data.

Run the launcher checks from `app` when you change its source:

```powershell
npm run check
npm run build
```

For companion changes, follow its [development instructions](../meowmate/README.md). Run the relevant TypeScript and Rust checks, plus tests for the feature you changed. State the exact commands and results in the pull request. Documentation-only changes need a review of links and factual claims. Check any commands against the build scripts; a full application build is not required.

## Show what you checked

Describe the problem, the resulting behavior and how you verified it. Include before-and-after screenshots for visible changes. Identify the operating system used for native checks.

If a test uses mocked provider responses or a simulated browser, label it that way. Don't describe a new connection as verified until a real request has completed. Note anything you could not test.

## Keep forks redistributable

The MIT license permits source changes and redistribution subject to its notice requirements. Upstream Coucou/Mochi branding and artwork have separate restrictions. Read the [license and attribution](../README.md#license-and-attribution), and don't add those restricted assets back into a public fork.

Keep secrets, user profiles and generated build output out of commits. If a change alters data storage or sends content to an external service, explain that behavior in the pull request and update the relevant privacy documentation.
