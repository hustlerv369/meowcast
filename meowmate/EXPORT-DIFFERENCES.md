# Public export differences

This export includes the Windows application, its observer and hook crates, and the frontend. Build configuration and lockfiles are included, along with original Meowmate cat artwork and self-contained tests.

Excluded: upstream macOS application/artwork, sound files, media/design folders, screenshots, private QA reports, profiles, credentials, git history, dependency directories and compiled binaries. The private live-test include from work.rs was removed because it referenced an external QA file. Ordinary unit tests remain.

Export-only replacements:

- Character engine: original cat renderer with a restrained opacity change while frames run. Upstream state choreography, particles, emotes, waving, springs and character motion sequences are absent. Existing callers retain a compatible API. Decorative gesture methods do not animate.
- Greeting: short original cat fade, without the upstream multi-step sequence.
- Attachment presentation: plain state/progress and HTML controls with the original cat, without the upstream character/file choreography.
- Sounds: silent compatible implementation. Vite no longer reads or copies upstream sound directories.
- Installer output uses Meowmate filenames. Internal crate names, binary names, and application identity stay compatible with existing local data.

Verification of this export: TypeScript and Vite production frontend builds passed. 46 Node unit tests passed. The final Images source and inline model selectors are included. The public export passed a locked native release build (2 minutes 38 seconds). Installed native acceptance is still a separate check.

No original working repository files were changed by these export replacements. The public source intentionally differs cosmetically from older private preview binaries.
