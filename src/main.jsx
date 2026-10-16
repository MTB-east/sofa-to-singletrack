import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";

// A new deploy is never forced on an open page (someone may be mid-ride with the timer running). registerType is
// "prompt" in vite.config.js, so the new service worker waits; onNeedRefresh shows a small banner and the Reload
// button lets it take over and reloads. The check runs at start-up and then once an hour.
let swRegistered = false; // StrictMode runs effects twice in dev; the worker is registered once
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const updateRef = useRef(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || swRegistered) return;
    swRegistered = true;
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh() { setReady(true); },
      onRegisteredSW(_url, registration) {
        if (registration) setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      },
    });
  }, []);
  if (!ready) return null;
  return (
    <div role="status" style={{ position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 20, background: "#161616", border: "1px solid #E8792B", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, color: "#F4F3EF", fontFamily: "'Source Sans 3', sans-serif", fontSize: 15, lineHeight: 1.4, boxShadow: "0 4px 16px rgba(0,0,0,0.5)" }}>
      <span style={{ flex: 1 }}>A new version is ready. Reload when you're not mid-ride.</span>
      <button onClick={() => updateRef.current && updateRef.current(true)} style={{ minHeight: 44, background: "#0F5F59", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Reload</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <UpdateBanner />
  </React.StrictMode>
);

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
