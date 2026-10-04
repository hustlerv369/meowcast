# Public-source build verification

Preview15,2026-10-04: the stable preview14 source plus three reviewed fixes (compact Home, cat canvas pixel density, native pointer acceptance) passed TypeScript/Vite,46 Node tests and the final locked native release build. The extracted production pointer-acceptance function passed the stationary cursor/geometry/button/popup regression test.

Companion executable SHA256:915452291dbbd212c91f35bd94fcc93364bf7ce4c69c364b55ba94d54f516c78
Bytes:5257216

The isolated build excludes the uncommitted experimental Gemini browser adapter. Images retains manual browser handoff in this release. A successful build is not native desktop or full multi-monitor acceptance. Installation and provider checks are separate.

Preview14 historical build:46 Node tests, TypeScript/Vite and locked native release passed. Executable SHA256:aff3e4277ecf77e8b4fa0cc00259ab9886a01d09331c7d3e1fe85ee6c734a2cb.