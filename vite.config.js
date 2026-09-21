import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves this as a project page at /sofa-to-singletrack/, and
// the MTB East Website embeds it at /programme/ -- neither is domain root,
// so base must be set per build target. VITE_BASE_PATH picks the target;
// only applied to production builds so local dev/preview (served at root)
// are unaffected.
export default defineConfig(({ command }) => {
  const base = command === "build" ? (process.env.VITE_BASE_PATH || "/sofa-to-singletrack/") : "/";

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        // Registered explicitly from src/main.jsx via virtual:pwa-register
        // instead (registerSW({ immediate: true })) -- the default
        // auto-injected script only calls navigator.serviceWorker.register
        // with no update-handling logic, so a new deploy's service worker
        // can finish installing in the background (skipWaiting +
        // clientsClaim are both on) without the already-open page ever
        // reloading to pick it up. virtual:pwa-register's registerSW
        // reloads automatically once the new worker takes control, which
        // is what actually fixes "still see the old version after a
        // deploy" rather than needing a manual cache clear.
        injectRegister: false,
        includeAssets: ["favicon.png", "brand/logo-full.png", "brand/header-mark.png", "brand/topo-bg.webp"],
        manifest: {
          name: "Sofa to Singletrack",
          short_name: "S2S",
          description: "An MTB East programme to get you off the sofa and onto singletrack.",
          start_url: base,
          scope: base,
          display: "standalone",
          orientation: "portrait",
          theme_color: "#14171A",
          background_color: "#14171A",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,ico}"],
          // /games is a separate static site copied into dist alongside the
          // app (see .github/workflows/deploy-pages.yml) -- without this, the
          // PWA's SPA navigation fallback serves the app's cached index.html
          // for any /games or /games/* URL once someone has the app's
          // service worker installed, instead of the actual games page. The
          // "(/|$)" also covers the bare "/games" URL (no trailing slash) --
          // the new top-level "Apps" nav link uses exactly that, redirected
          // by src/app/programme/games/page.tsx in the website repo.
          navigateFallbackDenylist: [new RegExp(`^${base}games(/|$)`)],
        },
      }),
    ],
  };
});
