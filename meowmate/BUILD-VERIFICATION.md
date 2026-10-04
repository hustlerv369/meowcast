# Public-source build verification

2026-10-04: TypeScript, Vite production build and 46 Node tests passed. Native Windows release compiled from this public source using locked Cargo dependencies in 2 minutes 38 seconds. No application was launched by this worker.

The staged companion executable is built from this export, including the original minimal cat rendering, inline Codex model selection and latest Images prompt helper. There are no upstream WAVs in the frontend payload or companion bundle. The generated build/dependency directories are ignored and absent from the source manifest.

Executable SHA256: aff3e4277ecf77e8b4fa0cc00259ab9886a01d09331c7d3e1fe85ee6c734a2cb
Bytes: 5257216

A successful build is not installed native acceptance or successful provider inference. Those checks remain separate.
