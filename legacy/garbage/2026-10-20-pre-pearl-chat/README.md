# Preserved pre-Pearl implementation

The local, Git-ignored `working-tree.tar.gz` preserves the original checkout state, including tracked changes and untracked work, before the fresh Room path began. It contains unpublished research documents and is not distributed with the repository. `manifest.json` records that snapshot. The `retired-tests` directory preserves 89 test files moved out of the active default suite after the app switched to the Pearl-only Electron entry.

The retired tests retain their original filenames and content. They are kept as history and can be restored with their matching source from the tar archive for investigation. The active `tests` directory covers the Pearl Room, provider protocol, project safety, persistence, session settings, rendering, telemetry, and command gate. Desktop and package checks exercise the active app.

`AGENTS.md` remains local and ignored by Git. It is not in this archive.
