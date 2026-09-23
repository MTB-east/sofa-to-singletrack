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

// Anonymous usage ping (see supabase/migrations/030_programme_usage_pings.sql in the website repo): most people
// use this app without ever signing in, so this is the only way to see roughly how many are using it and whether
// they keep coming back. anonId is random and lives only in this browser's own storage -- never a name, email or
// account -- and this fires at most once per calendar day per device.
try {
  const PING_KEY = "sofaToSingletrack:usagePing";
  const ID_KEY = "sofaToSingletrack:anonId";
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(PING_KEY) !== today) {
    let anonId = localStorage.getItem(ID_KEY);
    if (!anonId) {
      anonId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
      localStorage.setItem(ID_KEY, anonId);
    }
    fetch("/api/programme/usage-ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonId }),
    })
      .then(() => localStorage.setItem(PING_KEY, today))
      .catch(() => {
        /* offline or API unreachable -- try again next load */
      });
  }
} catch (e) {
  /* storage unavailable (private browsing etc.) -- skip counting this session */
}
