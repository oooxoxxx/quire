# Changelog

## 0.1.0 — 2026-11-16

First usable release of Quire.

- Local-first journal in IndexedDB, with optional PIN lock and AES-256-GCM at rest.
- Timeline, calendar, search, memories, rich text, mood, tags, place, and photo, video, and audio attachments.
- Google Drive sync into the user's own app-data folder, plus an optional visible backup folder. No client secret is stored in the app.
- Conflict detection with keep-local, keep-remote, and keep-both.
- Import and export: JSON, Markdown, HTML, print/PDF, encrypted or plain ZIP.
- Apple Journal importer for the publicly observed `Entries` + `Resources` HTML export, with preview, duplicate skip, and a best-effort compatible export. Not an Apple product and not guaranteed to re-import into Apple Journal.
