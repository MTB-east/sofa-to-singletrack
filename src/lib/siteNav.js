// The site header shared with the games hub lives in ../../games/site-nav.js (one file, so the games page can load it
// directly as a module script under the website's same-origin-only script policy, and the app bundles the same code).
// This re-export keeps the app's imports and tests under src/lib with the other pure modules. The fallback nav list in
// that file is a copy of src/lib/site-nav.ts (SITE_NAV) in the MTB East Website repo.
export * from "../../games/site-nav.js";
