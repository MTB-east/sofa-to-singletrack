# Sofa to Singletrack app

MTB east's beginner programme app (Vite; main component `sofa-to-singletrack.jsx`, mini games in `games/`). A build is also served inside the MTB east website at `/programme/` — the steps for refreshing that copy are in the website project's docs/archive/CHANGELOG-before-2026-10-03.md ("Sofa to Singletrack integration").

Coaching content: `docs/` holds the signed-off coaching plans (2026-10-15) and the coach notes for review (2026-10-16). Use the signed-off plans as the source of truth.

## Working with Michael

- **One session per job, one doc per feature.** Each feature or piece of work (e.g. a new shop, an audit) has one living doc in `docs/` (e.g. `docs/tshirt-shop.md`). Sessions come and go; that doc is what carries the work between them. When Michael says "carry on with X", find its doc in "Where things live" below and read it first. If he asks what we have, list the docs there.
- **One job per session.** If Michael asks for something unrelated to the feature this session is working on, say so in one line and suggest wrapping up and starting a new session for it, before doing it. Do it here only if he says to.
- **At the start of a session, find the doc.** Check "Where things live" for a doc this job belongs to. If one fits, read it and tell Michael in one line which doc you're using. If it's unclear whether the job is part of an existing feature or a new one, ask him. Same feature, same doc; a new feature gets a new doc.
- **Two sessions at once.** Michael may run another session in this folder at the same time. Before editing, run `git status` and look for uncommitted changes you didn't make: those belong to the other session, so leave those files alone. Never deploy while another session has unfinished changes. If both sessions need the same files, suggest a separate worktree. Whenever you suggest a new session, remind Michael in one line: keep the two on different parts of the site, deploy from one at a time, and wrap up each one separately.
- **Commit before every change.** Commit the current state before editing, then commit the finished change with a clear message, so anything can be rolled back. Push to `origin`.
- **Log completed changes in CHANGELOG.md**, newest first, not in this file. Only add to this file if it's a rule every future session must know. Keep this file short: it loads on every message.
- **"Wrap up"** — when Michael says this (usually at the end of a session or day):
  1. Update the feature's doc in `docs/` (create it if new, with a plain name like `docs/tshirt-shop.md`, and add it to the "Where things live" list in this file) under these headings: **Decisions** (what was decided and why), **Done**, **Next** (the to-do list for the next session), **Open questions** (waiting on Michael or the other directors).
     **Rewrite the doc to show the current state; don't append to it.** Keep only those four headings, plus a short reference section if the feature needs one. Never add dated sections, "round two" notes or a running log: that history belongs in CHANGELOG.md. Replace decisions that changed instead of adding new ones below them. Don't copy data that lives in the database or code (prices, stock); point to where it lives. Aim for under about 80 lines.
     Work done in the session that isn't part of this feature gets its own changelog entry, and its own doc if it will continue. It never goes in this feature's doc.
  2. Add an entry to the top of `CHANGELOG.md`: `## Title (YYYY-MM-DD)` plus a short summary.
  3. Commit and push, then tell Michael in two or three lines what was saved and what's next.

## Where things live

Feature docs (one per piece of work), newest at the bottom:

