# Sofa to Singletrack app

MTB east's beginner programme app (Vite; main component `sofa-to-singletrack.jsx`, mini games in `games/`). A build is also served inside the MTB east website at `/programme/` — the steps for refreshing that copy are in the website project's CHANGELOG.md ("Sofa to Singletrack integration").

Coaching content: `docs/` holds the signed-off coaching plans (2026-10-15) and the coach notes for review (2026-10-16). Use the signed-off plans as the source of truth.

## Working with Michael

- **One session per job, one doc per feature.** Each feature or piece of work (e.g. a new shop, an audit) has one living doc in `docs/` (e.g. `docs/tshirt-shop.md`). Sessions come and go; that doc is what carries the work between them. When Michael says "carry on with X", read its doc first.
- **Commit before every change.** Commit the current state before editing, then commit the finished change with a clear message, so anything can be rolled back. Push to `origin`.
- **Log completed changes in CHANGELOG.md**, newest first, not in this file. Only add to this file if it's a rule every future session must know. Keep this file short: it loads on every message.
- **"Wrap up"** — when Michael says this (usually at the end of a session or day):
  1. Update the feature's doc in `docs/` (create it if new) under these headings: **Decisions** (what was decided and why), **Done**, **Next** (the to-do list for the next session), **Open questions** (waiting on Michael or the other directors).
  2. Add an entry to the top of `CHANGELOG.md`: `## Title (YYYY-MM-DD)` plus a short summary.
  3. Commit and push, then tell Michael in two or three lines what was saved and what's next.
