import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// registerType: "autoUpdate" (vite.config.js) generates a service worker
// with skipWaiting/clientsClaim already on, but that alone only means a
// new deploy activates in the background -- an already-open tab doesn't
// pick it up until it reloads. registerSW's default onNeedRefresh handling
// with { immediate: true } checks for updates right away and reloads once
// the new worker takes control, so a deploy actually reaches open tabs
// instead of leaving them on stale cached content indefinitely.
if ("serviceWorker" in navigator) {
  registerSW({ immediate: true });
}
