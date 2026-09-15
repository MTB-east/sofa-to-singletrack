import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "brand/logo-full.png", "brand/header-mark.png", "brand/topo-bg.webp"],
      manifest: {
        name: "Sofa to Singletrack",
        short_name: "S2S",
        description: "An MTB East programme to get you off the sofa and onto singletrack.",
        start_url: "/",
        scope: "/",
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
        // /games/ is a separate static site copied into dist alongside the
        // app (see .github/workflows/deploy-pages.yml) -- without this, the
        // PWA's SPA navigation fallback serves the app's cached index.html
        // for any /games/* URL once someone has the app's service worker
        // installed, instead of the actual games page.
        navigateFallbackDenylist: [/^\/games\//],
      },
    }),
  ],
});
