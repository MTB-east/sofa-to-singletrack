import React, { useState, useEffect, useRef } from "react";
import COACH_SCENARIOS from "./data/coach-scenarios.json";
import { WEEKDAYS, sessionDate, weekNumberForDate, programmeStartFor, trimWeekOne, decideSync } from "./lib/plan.js";
import { FALLBACK_SITE_NAV, loadSiteNav, currentHref, renderSiteNav, updateSiteNavAccount, wireSiteNav } from "./lib/siteNav.js";
import "../games/site-nav.css";

/*
DESIGN PLAN — v5
Palette (from the MTB East mascot: black body, teal fur/claws, orange eyes/wordmark):
  --ink #14171A  --teal #1B8A82  --tealdk #0F5F59  --orange #E8792B  --paper #F4F3EF
Type: Fjalla One (display) / Inter (body)
Layout signature: contour/elevation profile line as the overall progress bar,
  active week marked with a simple enlarged orange dot (bike silhouette tried
  and dropped — read as amateurish at this scale, the plain dot reads cleaner).
Changed in this version: riders choose how many days a week they can ride (2 or
  3) and which specific days during setup, rather than a fixed Tue/Thu/Sat.
  A direct "Skip" button sits on every session card for a same-tap skip with no
  detour through the check-in screen. The rides/streak indicator is redefined
  as consecutive weeks with genuine engagement (skips don't feed it, but a
  single skip doesn't zero it either) rather than a raw counter.

PWA build: coach notes come from the static ./data/coach-scenarios.json lookup
  table (no live AI call), and progress is persisted to localStorage — this is
  the entire persistence layer, single device, no accounts, no data leaving
  the browser.
*/

// Used only when the website's live calendar can't be reached (offline, or the very first load). The live list comes from
// /api/rounds on the same site, so dates here can never drift from the League page: this copy is just a safety net.
const FALLBACK_RACES = [
  { id: 1, name: "Round 1", venue: "Potash Woods, Rochford", date: "2027-03-14" },
  { id: 2, name: "Round 2", venue: "Potash Woods, Rochford", date: "2027-04-04" },
  { id: 3, name: "Round 3", venue: "Gallows Green, Lindsell", date: "2027-04-18" },
  { id: 4, name: "Round 4", venue: "Potash Woods, Rochford", date: "2027-05-09" },
  { id: 5, name: "Round 5", venue: "Gallows Green, Lindsell", date: "2027-05-23" },
  { id: 6, name: "Round 6", venue: "Potash Woods, Rochford", date: "2027-06-06" },
  { id: 7, name: "Round 7", venue: "Potash Woods, Rochford", date: "2027-07-04" },
];

// Turns the website's /api/rounds answer into the shape the app uses. A round's number is its id, so a rider's saved
// choice ("Round 3") keeps meaning the same round.
function racesFromApi(json) {
  if (!json || !Array.isArray(json.rounds) || json.rounds.length === 0) return null;
  const rows = json.rounds
    .filter((r) => r && typeof r.date === "string" && Number.isInteger(r.round))
    .map((r) => ({ id: r.round, name: r.name || `Round ${r.round}`, venue: r.venue || "", date: r.date }));
  return rows.length ? rows : null;
}

// How the visitor has set up the main website (text size, reduced motion), read from the same cookie the site uses, so
// the app follows their choice without asking again.
function readDisplayPrefs() {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith("mtbe_display="));
    const p = new URLSearchParams(hit ? decodeURIComponent(hit.slice("mtbe_display=".length)) : "");
    return { text: p.get("text") || "standard", motion: p.get("motion") || "system" };
  } catch (e) {
    return { text: "standard", motion: "system" };
  }
}
// decideSync lives in src/lib/plan.js (tested): a copy with rides logged always beats one with none.
// ---- Voice cues during a ride ------------------------------------------------------------------
// Spoken by the phone's own built-in voice. Only works while the app is open and the screen is on: a web app is paused by the phone
// when the screen locks, so nothing can be said (or beep) until it's unlocked again.
const VOICE_KEY = "sofaToSingletrack:voice";
const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
function speak(text) {
  if (!speechSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.rate = 0.95;
    const voice = synth.getVoices().find((v) => v.lang === "en-GB" || v.lang === "en_GB");
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch (e) { /* speech unavailable: the visual timer still works */ }
}

// The spoken cues for a ride of a given length: halfway, five minutes, one minute, and the end.
function rideCues(targetMins, name) {
  const t = Number(targetMins) || 0;
  const cues = [];
  if (t >= 20) cues.push({ id: "half", atMs: t * 30000, text: `Halfway. About ${Math.ceil(t / 2)} minutes to go.` });
  if (t > 10) cues.push({ id: "five", atMs: (t - 5) * 60000, text: "Five minutes to go." });
  if (t >= 3) cues.push({ id: "one", atMs: (t - 1) * 60000, text: "One minute to go." });
  if (t > 0) cues.push({ id: "done", atMs: t * 60000, text: `That's your ${t} minutes${name ? ", " + name : ""}. Ease off, and finish when you're ready.` });
  return cues.sort((a, b) => a.atMs - b.atMs);
}

// Which cue to say now. A cue that is more than 45 seconds late (the screen was locked, say) is skipped rather than said out of date.
function nextCue(cues, elapsedMs, spoken) {
  const due = cues.filter((c) => c.atMs <= elapsedMs && !spoken.has(c.id));
  const fresh = due.filter((c) => elapsedMs - c.atMs <= 45000);
  return { cue: fresh.length ? fresh[fresh.length - 1] : null, mark: due.map((c) => c.id) };
}
const TEXT_SCALES = { standard: 1, large: 1.12, larger: 1.25, largest: 1.4 };
const TEXT_SIZE_KEY = "sofaToSingletrack:textSize";

// One canonical 3-month (12-week) plan. Shorter programmes (1 or 2 months)
// just use the first 4 or 8 weeks of this same plan rather than a separately
// scaled version — see buildProgramme below. Session detail text uses a
// {mins} placeholder so the duration can shift with a rider's ±5 min
// difficulty adjustment (see applyFeelingAdjustment) without rewriting copy.
// Sessions work equally well outdoors or on an indoor trainer/gym bike —
// there's no separate indoor variant, riders are told this once at signup.
// Add a `video: "<YouTube video ID>"` field to any session below to swap its
// "coming soon" placeholder for a real thumbnail linking out to YouTube —
// the ID is the part after ?v= in the video's URL. Leave it off for now.
const PHASES = [
  {
    title: "Off the sofa", focus: "Short flat rides, get comfortable on the bike",
    sessions: [
      { name: "Easy spin", mins: 20, effort: "low", detail: "{mins} min, flat path, stay seated, get used to the bike" },
      { name: "Easy spin", mins: 20, effort: "low", detail: "{mins} min, flat path, practice looking up rather than at the front wheel" },
      { name: "Steady ride", mins: 30, effort: "low", detail: "{mins} min, flat/gentle terrain, 2–3 stops to practice clipping in/out" },
    ],
  },
  {
    title: "Finding balance", focus: "Basic bike handling: braking, cornering, body position",
    sessions: [
      { name: "Handling drills", mins: 25, effort: "low", detail: "{mins} min: figure-of-8s in a car park or field, slow-speed balance" },
      { name: "Braking practice", mins: 25, effort: "med", detail: "{mins} min flat ride, 8x practice stops — front/rear brake balance" },
      { name: "Easy trail ride", mins: 35, effort: "low", detail: "{mins} min gentle wide singletrack, focus on body position on corners" },
    ],
  },
  {
    title: "First climbs", focus: "Gentle gradients, gear selection, pacing",
    sessions: [
      { name: "Gear practice", mins: 25, effort: "low", detail: "{mins} min flat, shift before (not during) short rises" },
      { name: "Easy spin", mins: 25, effort: "low", detail: "{mins} min recovery ride, low effort" },
      { name: "Hill intro", mins: 40, effort: "med", detail: "{mins} min incl. 3x short gentle climbs, walk anything too steep" },
    ],
  },
  {
    title: "Rolling terrain", focus: "Mixed surface rides, short technical sections",
    sessions: [
      { name: "Mixed terrain", mins: 35, effort: "med", detail: "{mins} min, alternate gravel and packed dirt" },
      { name: "Skills session", mins: 25, effort: "low", detail: "{mins} min, small roots/ruts at walking pace, practice weighting pedals" },
      { name: "Rolling ride", mins: 45, effort: "med", detail: "{mins} min rolling singletrack, no time pressure" },
    ],
  },
  {
    title: "Building endurance", focus: "Longer rides, fuelling practice on the bike",
    sessions: [
      { name: "Steady ride", mins: 40, effort: "med", detail: "{mins} min, conversational pace" },
      { name: "Fuelling practice", mins: 45, effort: "med", detail: "{mins} min, eat a snack and drink at the 20-min mark" },
      { name: "Longer ride", mins: 60, effort: "high", detail: "{mins} min mixed terrain, first ride over an hour" },
    ],
  },
  {
    title: "Race pace", focus: "Interval efforts, simulate race-length effort",
    sessions: [
      { name: "Intervals", mins: 35, effort: "high", detail: "{mins} min with 5x2 min hard-but-controlled, easy spin between" },
      { name: "Easy spin", mins: 25, effort: "low", detail: "{mins} min recovery, low effort" },
      { name: "Race simulation", mins: 50, effort: "high", detail: "{mins} min at the effort you'd expect to hold in a race" },
    ],
  },
  {
    title: "Course skills", focus: "Ride a real course, practice starts and lines",
    sessions: [
      { name: "Line choice", mins: 30, effort: "med", detail: "{mins} min varied terrain, pick the smoothest line, not the fastest" },
      { name: "Start practice", mins: 20, effort: "high", detail: "{mins} min, 6x practice starts from a standstill" },
      { name: "Course recon", mins: 40, effort: "low", detail: "Ride an actual race course (or similar terrain) at an easy pace" },
    ],
  },
  {
    title: "Taper", focus: "Short easy spins, rest, kit check",
    sessions: [
      { name: "Easy spin", mins: 20, effort: "low", detail: "{mins} min, very easy, legs should feel fresh afterwards" },
      { name: "Kit check", mins: 15, effort: "low", detail: "{mins} min ride to test bike, tyre pressure, and race-day kit" },
      { name: "Rest", mins: 15, effort: "low", detail: "Full rest or a gentle {mins} min spin only — save your legs for race day" },
    ],
  },
];

const SESSION_ICONS = {
  "Easy spin": "🌱", "Steady ride": "🚴", "Handling drills": "🎯", "Braking practice": "🛑",
  "Easy trail ride": "🌲", "Gear practice": "⚙️", "Hill intro": "⛰️", "Mixed terrain": "🪨",
  "Skills session": "🎯", "Rolling ride": "🌄", "Fuelling practice": "🍌", "Longer ride": "🕒",
  "Intervals": "⚡", "Race simulation": "🏁", "Line choice": "🧭", "Start practice": "🚦",
  "Course recon": "🗺️", "Kit check": "🎒", "Rest": "😴",
};

const EFFORT_META = {
  low: { label: "Easy effort", color: "#1B8A82", level: 1 },
  med: { label: "Moderate effort", color: "#E8792B", level: 2 },
  high: { label: "Hard effort", color: "#E24B4A", level: 3 },
};

function EffortDots({ effort }) {
  const meta = EFFORT_META[effort];
  if (!meta) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[1, 2, 3].map((n) => (
          <span key={n} style={{ width: 6, height: 6, borderRadius: "50%", background: n <= meta.level ? meta.color : "#3a3a3a" }} />
        ))}
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: meta.color }}>{meta.label}</span>
    </div>
  );
}

// How many weeks each phase above occupies in the 12-week plan — more time on
// the early habit-building phases, less on the later ones. Sums to 12.
const PHASE_WEEK_COUNTS = [2, 2, 1, 2, 2, 1, 1, 1];
const TEMPLATE = PHASES.flatMap((phase, i) => Array(PHASE_WEEK_COUNTS[i]).fill(phase));

// Applies a rider's current ±5 min adjustment to a session's duration and
// substitutes it into the detail text (never below 5 min).
function effectiveSession(session, adjustmentMins) {
  const mins = Math.max(5, session.mins + (adjustmentMins || 0));
  return {
    ...session,
    mins,
    detail: fillTemplate(session.detail, { mins }),
  };
}

// chosenDays.length is 2 or 3. For a 2-day week we use the first and last
// template session (the lightest and the main ride), skipping the middle one.
// totalWeeks is always a slice of the front of the 12-week TEMPLATE — a
// 1-month plan is literally weeks 1-4 of the 3-month plan, not a separately
// scaled-down version of it.
function buildProgramme(totalWeeks, chosenDays) {
  const days = chosenDays && chosenDays.length ? chosenDays : ["Tue", "Thu", "Sat"];
  const weeks = [];
  const n = Math.min(totalWeeks, TEMPLATE.length);
  for (let i = 0; i < n; i++) {
    const src = TEMPLATE[i];
    const base = days.length === 2 ? [src.sessions[0], src.sessions[2]] : src.sessions;
    const sessions = base.map((s, idx) => ({ ...s, day: days[idx] }));
    weeks.push({
      n: i + 1,
      title: src.title,
      focus: src.focus,
      sessions,
      elev: Math.round(8 + (i / Math.max(TEMPLATE.length - 1, 1)) * 84),
    });
  }
  return weeks;
}

const NUTRITION_TIPS = [
  "Eat a carb-rich meal 2–3 hours before a ride — porridge or toast with banana works well.",
  "Sip water throughout every ride, even short ones — don't wait until you're thirsty.",
  "For rides over 60 minutes, bring a snack: a banana, dates, or a cereal bar.",
  "After a ride, eat something with carbs and protein within an hour — a wrap or a yoghurt is enough.",
  "On hot days, add a pinch of salt to your water bottle or use an electrolyte tablet.",
];

const BIKE_CARE_TIPS = [
  "Check your tyre pressure before every ride — soft tyres are the most common cause of a sluggish, hard-feeling ride.",
  "Quick brake check before you set off: squeeze each lever and make sure the wheel doesn't spin freely with it held.",
  "Keep your chain lightly oiled — a dry, squeaky chain wears out faster and shifts badly.",
  "After a wet or muddy ride, a quick wipe-down keeps grit out of your moving parts and extends your bike's life.",
  "Learn the M-check — a two-minute top-to-bottom safety check worth doing before any ride on unfamiliar ground.",
];

const TRAIL_ETIQUETTE_TIPS = [
  "Give way to walkers and horse riders — slow down, say a friendly hello, and pass wide where you can.",
  "Horses can spook easily — slow right down well before you reach them and wait if the rider asks you to.",
  "Let other trail users know you're there — a simple \"hello\" or \"morning\" as you pass is great.",
  "Take your litter home with you — the trails only stay great if everyone does this.",
  "On narrow trails, riders heading uphill usually have priority — be ready to pull over if you're descending.",
];

const PRE_RIDE_CHECKLIST = [
  "Helmet — fitted properly and buckled",
  "Water bottle or hydration pack",
  "Weather-appropriate layers you can add or remove",
  "Phone, charged, in case you need it",
  "Tyres — check the side of the tyre for the correct pressure range",
  "Let someone know roughly where you're riding and when you'll be back",
];

const BIKE_SETUP_STEPS = [
  { title: "Saddle height", body: "Sit on the saddle and put your heel (with shoes on) on the pedal at its lowest point — your leg should be almost straight, with just a slight bend. If that doesn't feel comfortable straight away, start a little lower and raise it gradually over a few rides." },
  { title: "Tyre pressure", body: "Squeeze the tyre between finger and thumb — it shouldn't feel rock hard or squash flat. Check the pressure range printed on the tyre's sidewall (usually in PSI) and use a pump with a gauge if you have one." },
  { title: "Brakes", body: "Squeeze each lever in turn. The wheel shouldn't spin freely once the brake is held on, and the lever shouldn't pull all the way back to the bar." },
  { title: "Helmet fit", body: "It should sit level on your head, not tipped back. The strap should be snug enough that only one or two fingers fit underneath, and the helmet shouldn't rock forwards, backwards, or side to side." },
];

// Terms are matched as plain-text substrings (case-insensitive) inside session
// copy, longest first, so multi-word terms win over any shorter term nested
// inside them. Keep entries specific enough to avoid matching unrelated words.
const GLOSSARY = {
  "clipping in": "Locking your shoe into a clip-in (clipless) pedal. If you're using flat pedals, this doesn't apply to you — flat pedals are a totally fine way to start.",
  "figure-of-8s": "Riding a figure-of-eight pattern at slow speed — a simple way to build balance and low-speed bike control.",
  "singletrack": "A narrow off-road trail, usually wide enough for one rider at a time — the classic mountain-biking trail.",
  "cadence": "How fast you're pedalling (revolutions per minute). A smooth, comfortable spin is usually better than mashing hard on each stroke.",
  "zone 2": "A steady, conversational effort — you should be able to talk in short sentences without gasping for breath.",
  "conversational pace": "An effort easy enough that you could hold a conversation while riding — not a flat-out effort.",
  "recovery ride": "A short, deliberately easy ride, done to help your legs recover rather than to build fitness.",
  "corners": "Cornering well is about looking through the bend, leaning the bike (not just your body), and staying relaxed on the bars.",
  "time-trial": "Riding as hard and steady as you can hold, alone against the clock, rather than racing wheel-to-wheel with others.",
};

const GLOSSARY_TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);

function splitGlossaryText(text) {
  const lower = text.toLowerCase();
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const term = GLOSSARY_TERMS.find((t) => lower.startsWith(t, i));
    if (term) {
      parts.push({ term, text: text.slice(i, i + term.length) });
      i += term.length;
    } else {
      const last = parts[parts.length - 1];
      if (last && !last.term) last.text += text[i];
      else parts.push({ text: text[i] });
      i += 1;
    }
  }
  return parts;
}

function GlossaryText({ text }) {
  const [openTerm, setOpenTerm] = useState(null);
  const parts = splitGlossaryText(text);
  return (
    <>
      <p style={{ fontSize: 16, color: "#F4F3EF", lineHeight: 1.5, margin: "4px 0 12px" }}>
        {parts.map((part, i) =>
          part.term ? (
            <button key={i} onClick={() => setOpenTerm(openTerm === part.term ? null : part.term)}
              style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "inherit", textDecoration: "underline dotted", textDecorationColor: "#1B8A82", textUnderlineOffset: "3px", cursor: "pointer" }}>
              {part.text}
            </button>
          ) : (
            <React.Fragment key={i}>{part.text}</React.Fragment>
          )
        )}
      </p>
      {openTerm && (
        <p style={{ fontSize: 15, color: "#1B8A82", background: "#0d0d0d", borderRadius: 8, padding: "8px 10px", margin: "-6px 0 12px", lineHeight: 1.4 }}>
          💡 {GLOSSARY[openTerm]}
        </p>
      )}
    </>
  );
}

function PreRideChecklist() {
  const [expanded, setExpanded] = useState(false);
  const [checked, setChecked] = useState(() => PRE_RIDE_CHECKLIST.map(() => false));
  const doneCount = checked.filter(Boolean).length;
  const toggle = (i) => setChecked((c) => c.map((v, idx) => (idx === i ? !v : v)));
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <button onClick={() => setExpanded((e) => !e)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Before you head out</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#868A85" }}>{doneCount}/{PRE_RIDE_CHECKLIST.length}</span>
          <span style={{ color: "#E8792B", fontSize: 16 }}>{expanded ? "–" : "+"}</span>
        </span>
      </button>
      {expanded && (
        <div style={{ marginTop: 12 }}>
          {PRE_RIDE_CHECKLIST.map((item, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid #2b2b2b" : "none", cursor: "pointer" }}>
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} style={{ width: 16, height: 16, accentColor: "#1B8A82", flexShrink: 0 }} />
              <span style={{ fontSize: 15, color: checked[i] ? "#868A85" : "#F4F3EF", textDecoration: checked[i] ? "line-through" : "none" }}>{item}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function BikeSetupCheck({ bordered = true }) {
  const [open, setOpen] = useState(null);
  const content = (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Quick bike setup check</div>
      {BIKE_SETUP_STEPS.map((s, i) => (
        <div key={i} style={{ borderBottom: i < BIKE_SETUP_STEPS.length - 1 ? "1px solid #2b2b2b" : "none" }}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#F4F3EF", padding: "10px 0", fontSize: 15, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span>{s.title}</span>
            <span style={{ color: "#E8792B", fontSize: 16, flexShrink: 0 }}>{open === i ? "–" : "+"}</span>
          </button>
          {open === i && <p style={{ margin: "0 0 12px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>{s.body}</p>}
        </div>
      ))}
    </>
  );
  if (!bordered) return content;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      {content}
    </div>
  );
}

function toICSDate(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// sessionDate lives in src/lib/plan.js (tested): week 1 is the real calendar week the programme started in.

function downloadSessionICS(session, weekNum, weekTitle, programStart) {
  const start = sessionDate(programStart, weekNum, session.day);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sofa to Singletrack//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}-w${weekNum}-${session.day}@sofatosingletrack`,
    `DTSTAMP:${toICSDate(new Date())}`, `DTSTART:${toICSDate(start)}`, `DTEND:${toICSDate(end)}`,
    `SUMMARY:${session.name} — Week ${weekNum}: ${weekTitle}`,
    `DESCRIPTION:${session.detail.replace(/,/g, "\\,")}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sofa-to-singletrack-week${weekNum}-${session.day.toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function TopoBackground() {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: `url(${import.meta.env.BASE_URL}brand/topo-bg.webp)`, backgroundSize: "cover",
        backgroundPosition: "center", opacity: 0.85,
      }}
    />
  );
}

function daysUntil(dateStr) {
  const ms = new Date(dateStr + "T00:00:00").getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.max(0, Math.round(ms / 86400000));
}

// A small advert for the next MTB East race, shown once a rider is a couple of weeks into the programme.
function RaceAdvert({ race, funPrice, onDismiss }) {
  const days = daysUntil(race.date);
  const dateText = new Date(race.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div style={{ background: "#161616", borderRadius: 12, marginBottom: 16, border: "1px solid #E8792B", overflow: "hidden", position: "relative" }}>
      <div className="display" style={{ background: "#E8792B", color: "#111111", padding: "8px 16px", fontSize: 16, letterSpacing: "0.06em" }}>
        NEXT MTB EAST RACE · {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : days + " DAYS TO GO"}
      </div>
      {onDismiss && <button onClick={onDismiss} aria-label="Dismiss this" style={{ position: "absolute", top: 0, right: 0, width: 44, height: 44, background: "none", border: "none", color: "#111111", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>}
      <div style={{ padding: "14px 16px 16px" }}>
        <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>{race.name}, {race.venue}</div>
        <div style={{ fontSize: 15, color: "#B9BDB8", margin: "2px 0 10px" }}>{dateText}</div>
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: "0 0 14px" }}>
          You've got the base fitness now. The Fun category is a friendly, shorter race with no series standings{funPrice ? <>, from <strong>£{funPrice.early}</strong></> : null}. Under 16? You race in your age category. Or just come and watch first: spectators are very welcome.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <a href="/account/upcoming" style={{ background: "#E8792B", color: "#111111", fontWeight: 700, fontSize: 15, textDecoration: "none", padding: "12px 18px", borderRadius: 8, minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Enter this race</a>
          <a href="/league" style={{ border: "1px solid #E8792B", color: "#E8792B", fontWeight: 600, fontSize: 15, textDecoration: "none", padding: "12px 18px", borderRadius: 8, minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Race details</a>
        </div>
        <MarshalNote />
      </div>
    </div>
  );
}

// The route into racing that doesn't need a race entry: marshal for a while and earn one.
function MarshalNote({ card }) {
  const text = (
    <>
      Not ready to race yet? Marshal at a round and earn your way in: half a day earns <strong>50% off</strong> a race entry, a full day a <strong>free entry</strong>. Marshals stand at a point on the course and cheer riders on, and you can bring a friend.{" "}
      <a href="/volunteering" style={{ color: "#E8792B", fontWeight: 600 }}>See the Marshal Club</a>
    </>
  );
  if (!card) return <p style={{ fontSize: 15, lineHeight: 1.5, color: "#B9BDB8", margin: "14px 0 0" }}>{text}</p>;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #2b2b2b" }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Get a feel for race day first</div>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: "#F4F3EF", margin: 0 }}>{text}</p>
    </div>
  );
}

// The next round the signed-in account has entered: where, when, the forecast once there is one, and the day's timings.
function RaceWeekCard({ entry }) {
  const days = entry.daysAway;
  const coachNote = raceWeekNote(days);
  const week = days <= 10;
  const dateText = new Date(entry.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const later = entry.forecastLater ? new Date(entry.forecastLater + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null;
  const linkBtn = { border: "1px solid #1B8A82", color: "#F4F3EF", fontWeight: 600, fontSize: 15, textDecoration: "none", padding: "12px 16px", borderRadius: 8, minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" };
  return (
    <div style={{ background: "#161616", borderRadius: 12, marginBottom: 16, border: "1px solid #1B8A82", overflow: "hidden" }}>
      <div className="display" style={{ background: "#1B8A82", color: "#ffffff", padding: "8px 16px", fontSize: 14, letterSpacing: "0.06em" }}>
        {week ? "RACE WEEK" : "YOUR NEXT RACE"} · {days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : days + " DAYS TO GO"}
      </div>
      <div style={{ padding: "14px 16px 16px" }}>
        <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>{entry.name}, {entry.venue}</div>
        <div style={{ fontSize: 15, color: "#B9BDB8", margin: "2px 0 10px" }}>{dateText}</div>
        {entry.riders && entry.riders.length > 0 && <p style={{ fontSize: 15, margin: "0 0 10px" }}>Entered: <strong>{entry.riders.join(", ")}</strong></p>}
        {coachNote && (
          <p style={{ fontSize: 16, lineHeight: 1.55, margin: "0 0 12px", padding: "10px 12px", background: "#0d0d0d", borderLeft: "3px solid #1B8A82" }}>
            <strong>Coach note:</strong> {coachNote}
          </p>
        )}
        {entry.forecast ? (
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: "0 0 10px" }}><strong>Forecast for the day (8am to 3pm):</strong> {entry.forecast} Forecasts change, so check again the day before.</p>
        ) : later ? (
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#B9BDB8", margin: "0 0 10px" }}>The forecast appears from about {later}. Check back then.</p>
        ) : null}
        {entry.where && (
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: "0 0 10px" }}>
            <strong>Where:</strong> {entry.where.address}. <strong>Parking:</strong> {entry.where.parking}{" "}
            <a href={"https://what3words.com/" + entry.where.what3words} target="_blank" rel="noopener noreferrer" style={{ color: "#E8792B" }}>///{entry.where.what3words}</a>
          </p>
        )}
        {entry.timings && entry.timings.length > 0 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 600, minHeight: 44, display: "flex", alignItems: "center" }}>Race-day timings</summary>
            <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", fontSize: 14, lineHeight: 1.6, color: "#B9BDB8" }}>
              {entry.timings.map((t) => (<li key={t.time}><strong style={{ color: "#F4F3EF" }}>{t.time}</strong> {t.label}</li>))}
            </ul>
            <p style={{ fontSize: 13, color: "#868A85", margin: "6px 0 0" }}>A guide: announcements on the day take priority.</p>
          </details>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <a href={"/calendar.ics?event=" + entry.eventId} style={linkBtn}>Add to my calendar</a>
          {entry.where && <a href={entry.where.directionsUrl} target="_blank" rel="noopener noreferrer" style={linkBtn}>Get directions</a>}
          <a href="/league" style={linkBtn}>Race details</a>
        </div>
      </div>
    </div>
  );
}

// Who is riding: switch between the people using the app on this phone (and this account), or add someone.
function RiderSwitcher({ index, onSwitch }) {
  if (index.riders.length < 2) return null;
  return (
    <div role="group" aria-label="Who is riding" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 16px", borderBottom: "1px solid #1c1c1c" }}>
      {index.riders.map((r) => (
        <button key={r.id} onClick={() => onSwitch(r.id)} aria-pressed={r.id === index.active} style={{ flexShrink: 0, minHeight: 44, padding: "8px 16px", borderRadius: 22, fontSize: 15, fontWeight: 600, cursor: "pointer", background: r.id === index.active ? "#0F5F59" : "#161616", color: "#ffffff", border: "1px solid " + (r.id === index.active ? "#0F5F59" : "#2b2b2b") }}>
          {r.name || "Me"}
        </button>
      ))}
    </div>
  );
}

function FamilyPanel({ index, onSwitch, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = () => {
    const err = onAdd(name);
    if (err) setError(err);
    else { setName(""); setError(""); setOpen(false); }
  };
  const btn = { minHeight: 44, padding: "8px 14px", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8" };
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Riding with family?</div>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>
        Everyone gets their own plan and progress, all on this one phone and account. Add a child or a partner, then switch between riders at the top of the screen.
      </p>
      {index.riders.length > 1 && (
        <ul style={{ margin: "0 0 12px", padding: 0, listStyle: "none" }}>
          {index.riders.map((r) => (
            <li key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", fontSize: 15 }}>
              <span>{r.name || "Me"}{r.id === index.active ? " (riding now)" : ""}</span>
              <span style={{ display: "flex", gap: 8 }}>
                {r.id !== index.active && <button onClick={() => onSwitch(r.id)} style={btn}>Switch</button>}
                {r.id !== "main" && <button onClick={() => onRemove(r.id)} style={{ ...btn, color: "#E24B4A", borderColor: "#5a2a2a" }}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} style={btn}>＋ Add a rider</button>
      ) : (
        <div>
          <label htmlFor="family-name" style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Their first name</label>
          <input id="family-name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={40} style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "8px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #2b2b2b", background: "#0d0d0d", color: "#F4F3EF", marginBottom: 8 }} />
          {error && <p role="alert" style={{ color: "#E24B4A", fontSize: 15, margin: "0 0 8px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} style={{ ...btn, background: "#0F5F59", border: "1px solid #0F5F59", color: "#ffffff" }}>Add and set up their plan</button>
            <button onClick={() => { setOpen(false); setError(""); }} style={btn}>Cancel</button>
          </div>
          <p style={{ fontSize: 13, color: "#868A85", margin: "10px 0 0", lineHeight: 1.4 }}>For a child under 16, please set up and log their rides yourself, and ride with them where needed.</p>
        </div>
      )}
    </div>
  );
}

function CoachTips({ onContact }) {
  const [open, setOpen] = useState(null);
  const situations = COACH_SCENARIOS.situations || {};
  const keys = Object.keys(COACH_TIP_TITLES).filter((k) => situations[k]);
  if (keys.length === 0) return null;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Coach tips</div>
      <p style={{ margin: "0 0 8px", fontSize: 15, color: "#B9BDB8", lineHeight: 1.5 }}>What riders worry about most, answered. Tap the one that sounds like you.</p>
      {keys.map((k, i) => (
        <div key={k} style={{ borderBottom: i < keys.length - 1 ? "1px solid #2b2b2b" : "none" }}>
          <button onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#F4F3EF", padding: "12px 0", fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>{COACH_TIP_TITLES[k]}</span>
            <span style={{ color: "#E8792B", fontSize: 18, flexShrink: 0 }}>{open === k ? "–" : "+"}</span>
          </button>
          {open === k && <p style={{ margin: "0 0 14px", fontSize: 16, color: "#F4F3EF", lineHeight: 1.55 }}>{situations[k]}</p>}
        </div>
      ))}
      <button onClick={onContact} style={{ marginTop: 10, minHeight: 44, width: "100%", background: "none", border: "1px solid #E8792B", color: "#E8792B", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>Still stuck? Contact a coach</button>
    </div>
  );
}

// The coach's note for race week, when a rider is aiming at a race (the round they picked in setup) and it is close.
function RaceCoachNote({ race, note }) {
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #1B8A82" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Coach note · {race.name}, {race.venue}</div>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "#F4F3EF" }}>{note}</p>
    </div>
  );
}

// Asks visitors who aren't signed in to sign in with their MTB east account, so their progress follows them between devices.
function AccountCard({ account, onHide }) {
  if (!account) return null;
  if (account.signedIn) {
    return (
      <div style={{ fontSize: 16, color: "#B9BDB8", marginBottom: 14, lineHeight: 1.5 }}>
        ✓ Signed in{account.name ? " as " + account.name : ""}. Your progress is saved to your account, so it follows you to any device.
      </div>
    );
  }
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #2b2b2b", position: "relative" }}>
      <button onClick={onHide} aria-label="Hide this" style={{ position: "absolute", top: 0, right: 0, width: 44, height: 44, background: "none", border: "none", color: "#868A85", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, paddingRight: 36 }}>Keep your progress on every device</div>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: "#B9BDB8", margin: "0 0 12px" }}>
        Sign in with your MTB east account (the same one you use to enter races) and your progress is saved for you. It's free, and the app still works without it.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <a href="/account/login?next=/programme" style={{ background: "#0F5F59", color: "#ffffff", fontWeight: 700, fontSize: 15, textDecoration: "none", padding: "12px 18px", borderRadius: 8, minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Sign in</a>
        <a href="/account/signup" style={{ border: "1px solid #2b2b2b", color: "#F4F3EF", fontWeight: 600, fontSize: 15, textDecoration: "none", padding: "12px 18px", borderRadius: 8, minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Create an account</a>
      </div>
    </div>
  );
}

// The health note, shown before a rider starts. Plain and specific rather than a line of small print.
function GpNote() {
  return (
    <div role="note" style={{ background: "#161616", border: "2px solid #E8792B", borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Check with your GP first if</div>
      <ul style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 16, lineHeight: 1.6 }}>
        <li>you have a health condition, or you're pregnant or recovering from an injury or illness</li>
        <li>you take medication, or you've been told to be careful with exercise</li>
        <li>you haven't been active for a long time, or you're not sure</li>
      </ul>
      <p style={{ margin: "0 0 8px", fontSize: 16, lineHeight: 1.5 }}>
        Stop and get medical advice if you feel chest pain, dizziness, unusual breathlessness or pain that doesn't ease.
      </p>
      <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>
        Under 16? Ask a parent or guardian to read this and to ride with you where needed. Always wear a helmet.
      </p>
    </div>
  );
}

function TextSizeControl({ value, onChange }) {
  const options = [["standard", "Standard"], ["large", "Large"], ["larger", "Larger"]];
  return (
    <div role="group" aria-label="Text size" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
      <span style={{ fontSize: 15, color: "#B9BDB8", marginRight: 4 }}>Text size</span>
      {options.map(([key, label]) => (
        <button key={key} onClick={() => onChange(key)} aria-pressed={value === key} style={{ minHeight: 44, padding: "8px 14px", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", background: value === key ? "#0F5F59" : "#161616", color: "#ffffff", border: "1px solid " + (value === key ? "#0F5F59" : "#2b2b2b") }}>{label}</button>
      ))}
    </div>
  );
}

// What the ride timer can and can't do about the screen and the voice, said plainly.
function RideTimerStatus({ running, wakeState, voiceOn, onToggleVoice }) {
  const wakeSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const box = { borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 15, lineHeight: 1.5 };
  const warn = (running && (wakeState === "unsupported" || wakeState === "blocked")) || (!running && !wakeSupported);
  return (
    <div>
      {speechSupported() ? (
        <button onClick={onToggleVoice} aria-pressed={voiceOn} style={{ width: "100%", minHeight: 44, marginBottom: 10, borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", background: voiceOn ? "#0F5F59" : "#0d0d0d", color: "#ffffff", border: "1px solid " + (voiceOn ? "#0F5F59" : "#2b2b2b") }}>
          {voiceOn ? "🔊 Voice cues: on (halfway, 5 min, 1 min, done)" : "🔇 Voice cues: off"}
        </button>
      ) : (
        <p style={{ ...box, background: "#0d0d0d", color: "#B9BDB8", margin: "0 0 10px" }}>Voice cues aren't available on this phone or browser.</p>
      )}
      {warn ? (
        <div role="note" style={{ ...box, background: "#2a1a10", border: "1px solid #E8792B", color: "#F4F3EF" }}>
          <strong>Your screen may lock while you ride.</strong>{" "}
          {running ? "This phone or browser won't let the app keep the screen awake. " : "This phone or browser can't keep the screen awake for the app. "}
          The timer still keeps the right time, but the beep and voice cues can't play while the screen is locked. To avoid it, set your phone's Auto-Lock (iPhone) or Screen timeout (Android) to a longer time before you start, and keep the app open in front of you.
        </div>
      ) : running && wakeState === "on" ? (
        <p style={{ ...box, background: "#0d0d0d", color: "#B9BDB8", margin: "0 0 12px" }}>
          ✓ The app is asking your phone to keep the screen on. If your screen locks anyway (some phones ignore this), the timer stays right, but the beep and voice cues pause until you unlock it.
        </p>
      ) : !running ? (
        <p style={{ ...box, background: "#0d0d0d", color: "#B9BDB8", margin: "0 0 12px" }}>
          When you start, the app asks your phone to keep the screen on. Some phones ignore this; if the screen locks, the timer stays right, but the beep and voice cues pause until you unlock it. Turn your volume up.
        </p>
      ) : null}
    </div>
  );
}

function InstallPrompt({ deferredPrompt, onInstall, isIOS, isStandalone }) {
  if (isStandalone) return null;
  if (!deferredPrompt && !isIOS) return null;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #2b2b2b", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Install this app</div>
        <div style={{ fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>
          {isIOS ? <>Tap the Share icon, then "Add to Home Screen".</> : "Add it to your home screen for a full-screen, offline-friendly experience."}
        </div>
      </div>
      {deferredPrompt && (
        <button onClick={onInstall} style={{ background: "#0F5F59", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Install</button>
      )}
    </div>
  );
}

// Where "Sign in" brings the visitor back to afterwards (the website only allows /programme and /account addresses).
const SITE_NAV_RETURN_TO = "/programme";

// The real site header, persisting across the embed so riders can always get back to the rest of the MTB East site.
// The list of links comes from the website itself (GET /api/site-nav, built from its src/lib/site-nav.ts, the same
// list its own header uses), with FALLBACK_SITE_NAV in src/lib/siteNav.js (-> games/site-nav.js) when that can't be
// reached, so this bar can't drift from the real one. Markup, styles (games/site-nav.css) and behaviour are shared
// with the games hub: the module draws into this <header> itself, React only owns the element, like mounting a
// plain-JS widget. The logo is the site's own /brand/logo-on-black.png (root-absolute, not BASE_URL: it isn't one of
// this app's assets, and only resolves because the app is always embedded on the real domain). Shows "My Account"
// when /api/programme/me says the visitor is signed in, otherwise "Sign in".
function SiteNav({ account }) {
  const ref = useRef(null);
  const [nav, setNav] = useState(FALLBACK_SITE_NAV);

  useEffect(() => {
    let cancelled = false;
    loadSiteNav((url, options) => fetch(url, options)).then((loaded) => { if (!cancelled) setNav(loaded); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => wireSiteNav(ref.current), []);

  useEffect(() => {
    // Inside the app the address is /programme/index.html; "/programme" is the default for local dev at "/".
    const current = currentHref(nav, window.location.pathname, "/programme");
    renderSiteNav(ref.current, nav, { current, account, returnTo: SITE_NAV_RETURN_TO });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- account changes are patched in below, not redrawn
  }, [nav]);

  useEffect(() => {
    updateSiteNavAccount(ref.current, nav, account, SITE_NAV_RETURN_TO);
  }, [nav, account]);

  return <header id="mtbe-site-nav" ref={ref} />;
}

function AppHeader() {
  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 20px", borderBottom: "1px solid #1c1c1c" }}>
      <img src={`${import.meta.env.BASE_URL}brand/header-mark.png`} alt="" width={24} height={24} style={{ display: "block" }} />
      <span className="display" style={{ fontSize: 15, letterSpacing: "0.08em", color: "#F4F3EF" }}>SOFA TO SINGLETRACK</span>
      <span style={{ fontSize: 13, color: "#B9BDB8", fontWeight: 600 }}>· MTB EAST</span>
    </div>
  );
}

function SplashScreen() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <img src={`${import.meta.env.BASE_URL}brand/logo-full.png`} alt="MTB East" width={160} height={160} style={{ marginBottom: 20 }} />
      <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1, margin: 0, color: "#E8792B", textAlign: "center" }}>SOFA TO<br />SINGLETRACK</h1>
    </div>
  );
}

const FAQS = [
  { q: "Do I need to already own a mountain bike?", a: "No. You can start by using any safe, working bike you have access to. A mountain bike will make off-road riding more comfortable, but the early sessions can be done on paths, roads, and gentle trails." },
  { q: "I have not ridden a bike in years. Is this really for me?", a: "Absolutely. The programme is designed for people starting from zero, returning after a long break, or rebuilding confidence. You begin gently and progress in small, manageable steps." },
  { q: "Should I check with my doctor before I start?", a: "If you have a health condition, are pregnant, are recovering from an injury or illness, take medication, or have not been active for a long time, yes: speak to your GP first. Whoever you are, stop and get medical advice if you feel chest pain, dizziness, unusual breathlessness or pain that does not ease. If you are under 16, ask a parent or guardian to read this and to ride with you where needed." },
  { q: "What if I cannot ride very far yet?", a: "That is exactly where you are meant to start. Early rides may be short, with plenty of recovery and walking breaks if needed. There is no expectation to keep up with experienced riders." },
  { q: "Do I need to be fit before I begin?", a: "No. The goal is to help you become fitter over time. You only need to be comfortable starting at your own level and taking things gradually." },
  { q: "What does \"singletrack\" mean?", a: "Singletrack is a narrow off-road trail, usually wide enough for one rider at a time. It can be a smooth woodland path, dirt, gravel, roots, or gentle twists. You will build towards it rather than being sent straight onto technical trails." },
  { q: "Is mountain biking dangerous?", a: "Like any activity, it has risks, but you can reduce them a lot by learning gradually, wearing a helmet, checking your bike, choosing suitable trails, and knowing that it is always fine to slow down or walk a section." },
  { q: "What if I am nervous about falling off?", a: "That is very normal. The programme builds your confidence step by step: braking, balance, cornering, getting on and off the bike, and choosing a safe line. Walking a tricky bit is always a smart option, never a failure." },
  { q: "Do I have to ride down steep hills or over jumps?", a: "No. You choose your own challenge level. There are no jumps, drops, or steep descents required to complete the programme. Many riders enjoy mountain biking for fitness, fresh air, and social rides without wanting technical features." },
  { q: "What equipment do I need to get started?", a: "A safe bike, a properly fitted helmet, comfortable clothing, water, and something to repair a puncture are the basics. You do not need expensive shoes, clothing, suspension, or race equipment to begin." },
  { q: "What type of mountain bike should I buy?", a: "Do not rush into buying one. If you decide to, a comfortable hardtail mountain bike from a reputable shop is often a great first choice." },
  { q: "Can I do the programme on an e-bike?", a: "Yes, provided it is legal and suitable for the terrain where you ride. An e-bike can make hills and longer rides feel more approachable while still building skills, confidence, and fitness. Sessions can be based on time and effort, not only distance." },
  { q: "What if I need to stop, repeat a week, or miss a few sessions?", a: "That is completely fine. Life happens. You can repeat sessions, take extra rest, or resume when you are ready. Progress is not ruined by a missed week." },
  { q: "How much time will I need each week?", a: "The programme fits around real life: two or three short rides a week, on the days you choose. If a ride felt too hard, say so when you log it and your next sessions get a little shorter. If it felt easy, they get a little longer." },
  { q: "Where can I safely ride?", a: "You do not need mountains on your doorstep. Start with quiet cycle paths, parks, bridleways, forest roads, towpaths, and easy local trails where cycling is permitted. Look out for signs at the entrance, give way to walkers and horse riders, leave gates as you find them, and take your litter home." },
  { q: "What if I do not have anyone to ride with?", a: "You can complete the whole programme solo. It can also help you find beginner-friendly group rides, bike shops, clubs, or event communities when you feel ready. Riding with others is optional, not a requirement." },
  { q: "Do I have to race at the end?", a: "No. Racing is one possible destination, not the purpose of the programme. Your finish line might be feeling fitter, exploring local trails, riding with friends, commuting, or simply enjoying being outside." },
  { q: "What is an MTB \"fun race,\" and can a beginner enter one?", a: "A fun race is an informal event where the emphasis is on completing the course and enjoying the day. Riders of mixed experience. You can aim for one when it feels exciting, or come along to watch first." },
  { q: "Can I attend an event just to watch and see what it is like?", a: "Definitely. Watching is a brilliant, low-pressure way to learn what mountain biking events feel like, meet riders, ask questions, and decide whether you would enjoy taking part later. You do not need to earn your place in the community." },
  { q: "What if I decide I never want to race or ride difficult trails?", a: "You have still succeeded. Sofa to Singletrack is about opening up cycling, not pushing everyone into the same outcome. If you finish fitter, happier, more confident on a bike, and able to enjoy the rides you choose, the programme has done its job." },
];

function FAQSection({ bordered = true }) {
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? FAQS : FAQS.slice(0, 3);
  const content = (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Common questions</div>
      <div style={{ position: "relative" }}>
        {visible.map((f, i) => (
          <div key={i} style={{ borderBottom: i < visible.length - 1 ? "1px solid #2b2b2b" : "none" }}>
            <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#F4F3EF", padding: "12px 0", fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>{f.q}</span>
              <span style={{ color: "#E8792B", fontSize: 16, flexShrink: 0 }}>{open === i ? "–" : "+"}</span>
            </button>
            {open === i && <p style={{ margin: "0 0 12px", fontSize: 15, color: "#B9BDB8", lineHeight: 1.5 }}>{f.a}</p>}
          </div>
        ))}
        {!expanded && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 36, background: "linear-gradient(to bottom, rgba(22,22,22,0), #161616)", pointerEvents: "none" }} />
        )}
      </div>
      <button onClick={() => setExpanded((e) => !e)} style={{ width: "100%", textAlign: "center", background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 15, cursor: "pointer", padding: "10px 0 0" }}>
        {expanded ? "Show less ↑" : `Read more (${FAQS.length - 3} more) ↓`}
      </button>
    </>
  );
  if (!bordered) return content;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginTop: 16, border: "1px solid #2b2b2b", position: "relative", zIndex: 1 }}>
      {content}
    </div>
  );
}

function TipsAndAdvice() {
  const [expanded, setExpanded] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const [bikeTipIndex, setBikeTipIndex] = useState(0);
  const [trailTipIndex, setTrailTipIndex] = useState(0);
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <button onClick={() => setExpanded((e) => !e)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tips & advice</span>
        <span style={{ color: "#E8792B", fontSize: 16 }}>{expanded ? "–" : "+"}</span>
      </button>
      {!expanded && (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "#868A85", lineHeight: 1.4 }}>Fuelling, bike care, trail etiquette, bike setup, and common questions</p>
      )}
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fuelling tip</div>
          <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>{NUTRITION_TIPS[tipIndex]}</p>
          <button onClick={() => setTipIndex((i) => (i + 1) % NUTRITION_TIPS.length)} style={{ background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 15, cursor: "pointer", padding: 0 }}>Next tip →</button>

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Bike care tip</div>
          <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>{BIKE_CARE_TIPS[bikeTipIndex]}</p>
          <button onClick={() => setBikeTipIndex((i) => (i + 1) % BIKE_CARE_TIPS.length)} style={{ background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 15, cursor: "pointer", padding: 0 }}>Next tip →</button>

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Trail etiquette</div>
          <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>{TRAIL_ETIQUETTE_TIPS[trailTipIndex]}</p>
          <button onClick={() => setTrailTipIndex((i) => (i + 1) % TRAIL_ETIQUETTE_TIPS.length)} style={{ background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 15, cursor: "pointer", padding: 0 }}>Next tip →</button>

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <BikeSetupCheck bordered={false} />

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <FAQSection bordered={false} />
        </div>
      )}
    </div>
  );
}

function SettingsSection({ profile, setProfile, weeks, setWeeks, showToast, storageKey }) {
  const [expanded, setExpanded] = useState(false);
  const [editingDays, setEditingDays] = useState(false);
  const [draftDays, setDraftDays] = useState(profile.chosenDays);
  const [pendingImport, setPendingImport] = useState(null);
  const fileInputRef = useRef(null);

  const startEditDays = () => {
    setDraftDays(profile.chosenDays);
    setEditingDays(true);
  };

  const toggleDraftDay = (day) => {
    setDraftDays((prev) => {
      const has = prev.includes(day);
      let next;
      if (has) next = prev.filter((d) => d !== day);
      else if (prev.length < profile.sessionsPerWeek) next = [...prev, day];
      else next = prev;
      return next.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
    });
  };

  const saveDays = () => {
    if (draftDays.length !== profile.sessionsPerWeek) return;
    setProfile({ ...profile, chosenDays: draftDays });
    setWeeks(trimWeekOne(buildProgramme(weeks.length, draftDays), programStart));
    setEditingDays(false);
    showToast("Training days updated.");
  };

  const exportProgress = () => {
    const raw = localStorage.getItem(storageKey) || "{}";
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sofa-to-singletrack-backup-${dateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.");
  };

  const handleFileSelected = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.profile || !parsed.weeks) {
          showToast("That doesn't look like a Sofa to Singletrack backup file.");
          return;
        }
        setPendingImport({ text: reader.result, name: parsed.profile.name || "rider", ridesLogged: Object.keys(parsed.sessionLog || {}).length });
      } catch (err) {
        showToast("Couldn't read that file — is it a backup exported from this app?");
      }
    };
    reader.readAsText(file);
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    localStorage.setItem(storageKey, pendingImport.text);
    window.location.reload();
  };

  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <button onClick={() => setExpanded((e) => !e)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Settings</span>
        <span style={{ color: "#E8792B", fontSize: 16 }}>{expanded ? "–" : "+"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Training days</div>
          {!editingDays ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 15, color: "#F4F3EF" }}>{profile.chosenDays.join(", ")}</p>
              <button onClick={startEditDays} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Change days</button>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "#B9BDB8" }}>Pick exactly {profile.sessionsPerWeek} — tap to select or deselect.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {WEEKDAYS.map((day) => {
                  const selected = draftDays.includes(day);
                  const disabled = !selected && draftDays.length >= profile.sessionsPerWeek;
                  return (
                    <button key={day} onClick={() => toggleDraftDay(day)} disabled={disabled}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "1.5px solid " + (selected ? "#AE5B20" : "#2b2b2b"), background: selected ? "#AE5B20" : "#0d0d0d", color: selected ? "#fff" : disabled ? "#868A85" : "#F4F3EF", fontSize: 15, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>
                      {day}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveDays} disabled={draftDays.length !== profile.sessionsPerWeek} style={{ background: "#0F5F59", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: draftDays.length !== profile.sessionsPerWeek ? "default" : "pointer", opacity: draftDays.length !== profile.sessionsPerWeek ? 0.5 : 1 }}>Save</button>
                <button onClick={() => setEditingDays(false)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              </div>
            </>
          )}

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Back up your progress</div>
          <p style={{ margin: "0 0 10px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>
            Everything is stored on this device. If you're signed in it is also saved to your account. A backup file is still worth keeping before you clear your browser or change phone.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={exportProgress} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Download backup</button>
            <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Restore backup</button>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileSelected} style={{ display: "none" }} />
          </div>

          {pendingImport && (
            <div style={{ marginTop: 12, background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 8, padding: "12px 14px" }}>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "#F4F3EF", lineHeight: 1.4 }}>
                This backup is for <strong>{pendingImport.name}</strong>, with {pendingImport.ridesLogged} session{pendingImport.ridesLogged === 1 ? "" : "s"} logged. Restoring it will replace your current progress on this device — this can't be undone.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmImport} style={{ background: "#AE5B20", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Replace my progress</button>
                <button onClick={() => setPendingImport(null)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GENERIC_COACH_FALLBACK = "Nice work getting out there — keep it up and see you at the next session.";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatElapsed(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function playTimerAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (startTime, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    };
    const now = ctx.currentTime;
    beep(now, 880);
    beep(now + 0.35, 880);
    beep(now + 0.7, 1108.73);
  } catch (e) {
    // Web Audio unavailable — vibration/visual alert still fire
  }
}

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// The coach's race-week message for how far away the race is: the week before (taper), the day before, and race morning.
function raceWeekNote(daysAway) {
  const rw = COACH_SCENARIOS.raceWeek || {};
  if (daysAway === 0) return rw.raceMorning || null;
  if (daysAway === 1) return rw.dayBefore || null;
  if (daysAway >= 2 && daysAway <= 7) return rw.taper || null;
  return null;
}

// The coach's answers to the worries riders raise most, shown as tips they can open any time.
const COACH_TIP_TITLES = {
  descents: "Nervous on descents",
  joints: "Aches and niggles",
  climbs: "Struggling on climbs",
  motivation: "Missed sessions or lost motivation",
  equipment: "The bike feels wrong",
  weather: "Bad weather",
  comparison: "Comparing yourself with other riders",
};

function getCoachNote(target, feeling) {
  const phase = target.weekN <= 3 ? "early" : "later";
  const phaseScenarios = COACH_SCENARIOS.checkins && COACH_SCENARIOS.checkins[phase];
  if (!phaseScenarios) return GENERIC_COACH_FALLBACK;
  return phaseScenarios[feeling] || phaseScenarios["About right"] || GENERIC_COACH_FALLBACK;
}

const MICRO_EXPLAINERS = {
  "Handling drills": "Slow-speed figure-of-8s build the balance and control you'll rely on for cornering later — it looks basic but it's the foundation.",
  "Braking practice": "Learning to use front and rear brakes together (not just the back one) is what lets you stop quickly without skidding.",
  "Intervals": "Short hard bursts with rest in between — this builds the kind of fitness that copes with race-pace surges, not just steady riding.",
  "Race simulation": "A dress rehearsal at the effort you'd actually hold in a race, so race day doesn't feel like a totally new sensation.",
  "Course recon": "Riding the actual course slowly beforehand means race day is about racing, not figuring out where the course goes.",
  "Start practice": "Race starts are their own skill — practising from a standstill builds the power and confidence for the first few seconds.",
  "Fuelling practice": "Eating and drinking on the bike feels different to doing it standing still — better to get used to it now than find out mid-race.",
};

function ContourProgress({ weeks, currentWeek }) {
  const w = 640, h = 140, pad = 30;
  const points = weeks.map((wk, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(weeks.length - 1, 1);
    const y = h - pad - (wk.elev / 100) * (h - pad * 2);
    return { x, y, wk };
  });
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="Programme progress">
      <defs>
        <linearGradient id="climbFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8792B" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#E8792B" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${linePath} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`} fill="url(#climbFill)" />
      <path d={linePath} fill="none" stroke="#1B8A82" strokeWidth="2" />
      {points.map((p, i) => {
        const done = p.wk.n <= currentWeek;
        const active = p.wk.n === currentWeek;
        return <circle key={i} cx={p.x} cy={p.y} r={active ? 9 : 4.5} fill={done ? "#E8792B" : "#161616"} stroke={active ? "#E8792B" : "#B9BDB8"} strokeWidth={active ? 3 : 1.5} />;
      })}
    </svg>
  );
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function SpeedoGauge({ pct }) {
  const cx = 120, cy = 116, r = 90, trackWidth = 14;
  const clamped = Math.max(0, Math.min(100, pct));
  const start = polarToCartesian(cx, cy, r, 180);
  const end = polarToCartesian(cx, cy, r, 0);
  const arcLen = Math.PI * r;
  const needleAngle = 180 - (clamped / 100) * 180;
  const needleTip = polarToCartesian(cx, cy, r - trackWidth - 6, needleAngle);
  return (
    <svg viewBox="0 0 240 148" role="img" aria-label={`Programme ${clamped}% complete`} style={{ display: "block", width: "100%", height: "auto" }}>
      <path d={`M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`} fill="none" stroke="#2b2b2b" strokeWidth={trackWidth} strokeLinecap="round" />
      {clamped > 0 && (
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`}
          fill="none"
          stroke="#1B8A82"
          strokeWidth={trackWidth}
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * arcLen} ${arcLen}`}
        />
      )}
      <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y} stroke="#E8792B" strokeWidth={3} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={7} fill="#E8792B" />
      <text x={cx} y={cy - 18} textAnchor="middle" className="display" fontSize="34" fill="#F4F3EF">{clamped}%</text>
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="11" fill="#B9BDB8" fontWeight="600">PROGRAMME COMPLETE</text>
    </svg>
  );
}

const CONFETTI_COLORS = ["#E8792B", "#1B8A82", "#F4F3EF", "#FFD400"];

function Confetti() {
  const pieces = Array.from({ length: 36 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.3,
    duration: 1.6 + Math.random() * 0.9,
    rotate: Math.round(Math.random() * 360),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
  }));
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 15, overflow: "hidden" }} aria-hidden="true">
      {pieces.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute", top: -20, left: `${p.left}%`, width: p.size, height: p.size * 0.4,
            background: p.color, opacity: 0.9, borderRadius: 2,
            animation: `confettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

function weeksBetween(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return Math.max(4, Math.min(12, Math.round(days / 7)));
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

// weekNumberForDate lives in src/lib/plan.js (tested).

function MonthCalendar({ weeks, sessionLog, adHocLog, programStart, totalRidesLogged, totalSessions, sessionDurations, adjustmentMins }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [previewKey, setPreviewKey] = useState(null);

  const sessionsByDate = {};
  weeks.forEach((w) => {
    w.sessions.forEach((s, i) => {
      const key = `${w.n}-${i}`;
      const feeling = sessionLog[key];
      const status = feeling === undefined ? "upcoming" : feeling === "Didn't get to it" ? "skipped" : "done";
      const d = sessionDate(programStart, w.n, s.day);
      const eff = status === "upcoming" ? effectiveSession(s, adjustmentMins) : s;
      sessionsByDate[dateKey(d)] = { status, name: s.name, detail: eff.detail, mins: sessionDurations[key] ?? eff.mins };
    });
  });
  const adHocByDate = {};
  adHocLog.forEach((r) => {
    const k = dateKey(new Date(r.at));
    (adHocByDate[k] = adHocByDate[k] || []).push(r);
  });

  const viewDate = new Date(programStart.getFullYear(), programStart.getMonth() + monthOffset, 1);
  const monthLabel = viewDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const firstDow = (viewDate.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const todayKey = dateKey(new Date());

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  const dotColor = { done: "#1B8A82", skipped: "#5c5f5c", upcoming: "#E8792B" };
  const minOffset = -1;
  const maxOffset = Math.ceil(weeks.length / 4) + 1;

  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your calendar</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>{totalRidesLogged}/{totalSessions} sessions logged</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 8px" }}>
        <button onClick={() => setMonthOffset((m) => Math.max(minOffset, m - 1))} disabled={monthOffset <= minOffset} style={monthNavBtn}>‹</button>
        <div className="display" style={{ fontSize: 15, color: "#F4F3EF" }}>{monthLabel}</div>
        <button onClick={() => setMonthOffset((m) => Math.min(maxOffset, m + 1))} disabled={monthOffset >= maxOffset} style={monthNavBtn}>›</button>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 700, color: "#868A85" }}>{d}</div>
        ))}
        <div style={{ width: 34, textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "#868A85" }}>TIME</div>
      </div>

      {rows.map((row, ri) => {
        const rowMins = row.reduce((sum, d) => {
          if (!d) return sum;
          const k = dateKey(d);
          const info = sessionsByDate[k];
          const adHocMins = (adHocByDate[k] || []).reduce((s, r) => s + (r.mins || 0), 0);
          return sum + (info && info.status === "done" ? (info.mins || 0) : 0) + adHocMins;
        }, 0);
        return (
          <div key={ri} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
            {row.map((d, ci) => {
              if (!d) return <div key={ci} style={{ flex: 1 }} />;
              const k = dateKey(d);
              const info = sessionsByDate[k];
              const adHocForDay = adHocByDate[k] || [];
              const hasAdHoc = adHocForDay.length > 0;
              const hasPreviewContent = info || hasAdHoc;
              const isToday = k === todayKey;
              const isPreviewing = previewKey === k;
              return (
                <div key={ci} style={{ flex: 1, position: "relative" }}>
                  <div
                    onMouseEnter={() => hasPreviewContent && setPreviewKey(k)}
                    onMouseLeave={() => setPreviewKey((cur) => (cur === k ? null : cur))}
                    onClick={() => hasPreviewContent && setPreviewKey((cur) => (cur === k ? null : k))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "3px 0", borderRadius: 6, border: isToday ? "1px solid #E8792B" : "1px solid transparent", cursor: hasPreviewContent ? "pointer" : "default" }}
                  >
                    <span style={{ fontSize: 14, color: "#F4F3EF" }}>{d.getDate()}</span>
                    <div style={{ display: "flex", gap: 2 }}>
                      {info && (
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: info.status === "skipped" ? "transparent" : dotColor[info.status], border: info.status === "skipped" ? "1px solid #5c5f5c" : "none" }} />
                      )}
                      {hasAdHoc && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFD400" }} />}
                    </div>
                  </div>
                  {isPreviewing && hasPreviewContent && (
                    <div style={{ position: "absolute", zIndex: 20, bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6, width: 160, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 8, padding: "8px 10px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                      {info && (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#E8792B", marginBottom: 2 }}>{info.name}</div>
                          <div style={{ fontSize: 13, color: "#B9BDB8", lineHeight: 1.4 }}>{info.detail}</div>
                        </>
                      )}
                      {hasAdHoc && adHocForDay.map((r, i) => (
                        <div key={i} style={{ marginTop: info || i > 0 ? 6 : 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#FFD400" }}>Extra ride{r.mins ? ` — ${r.mins}m` : ""}</div>
                          {r.feeling && <div style={{ fontSize: 13, color: "#B9BDB8", lineHeight: 1.4 }}>{r.feeling}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ width: 34, textAlign: "center", fontSize: 13, fontWeight: 600, color: rowMins > 0 ? "#1B8A82" : "#3a3d3a" }}>
              {rowMins > 0 ? `${rowMins}m` : "–"}
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13, color: "#B9BDB8", marginTop: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B8A82", display: "inline-block" }} /> Done</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", border: "1px solid #868A85", display: "inline-block" }} /> Skipped</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E8792B", display: "inline-block" }} /> Upcoming</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFD400", display: "inline-block" }} /> Extra ride</span>
      </div>
      <p style={{ fontSize: 13, color: "#868A85", margin: "8px 0 0" }}>Tap or hover a session dot for a quick preview.</p>
    </div>
  );
}

const monthNavBtn = { background: "none", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, width: 28, height: 28, fontSize: 16, cursor: "pointer", lineHeight: 1 };

const FEELINGS = ["Easier than expected", "About right", "Tougher than expected", "Had to stop early"];

const QA_TOPICS = [
  "Bike handling skills",
  "Building fitness",
  "1 to 1 coaching",
  "Join an organised skills session",
  "Something else",
];

const STORAGE_KEY = "sofaToSingletrack:progress";

// Several riders can use the app on one device and one account (a parent and their children, say). Each has their own plan and
// progress. The first rider ("main") keeps the original storage key, so anyone already using the app loses nothing.
const RIDERS_KEY = "sofaToSingletrack:riders";
const MAX_RIDERS = 8;
const keyForRider = (id) => (id === "main" ? STORAGE_KEY : STORAGE_KEY + ":" + id);
function loadRiderIndex() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RIDERS_KEY) || "null");
    if (parsed && Array.isArray(parsed.riders) && parsed.riders.length > 0 && parsed.riders.some((r) => r.id === parsed.active)) return parsed;
  } catch (e) { /* fall through to the default */ }
  return { active: "main", riders: [{ id: "main", name: "" }] };
}
const newRiderId = () => Math.random().toString(36).slice(2, 8);

// A complete, empty snapshot for a new rider, so switching to them clears every trace of the previous rider.
function blankSaved(name) {
  const days = ["Tue", "Thu", "Sat"];
  return {
    profile: { name: name || "", experience: "none", planType: null, raceId: null, months: null, sessionsPerWeek: 3, chosenDays: days },
    weeks: buildProgramme(8, days),
    sessionLog: {}, badges: [], adHocLog: [], notifAsked: false, notifEnabled: false, reminderTime: "17:30", lastFeeling: null,
    programStart: new Date().toISOString(), sessionDurations: {}, activeTimer: null, adjustmentMins: 0, stage: "onboarding",
    lastActivityAt: null, comebackNudgeShown: false, raceOfferShown: false, savedAt: 0,
  };
}

export default function SofaToSingletrack() {
  const [stage, setStage] = useState("welcome");
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState({ name: "", experience: "none", planType: null, raceId: null, months: null, sessionsPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] });
  const [step, setStep] = useState(0);
  const [weeks, setWeeks] = useState(buildProgramme(8, ["Tue", "Thu", "Sat"]));
  const [coachNote, setCoachNote] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const [programStart, setProgramStart] = useState(new Date());
  const [bikeCheckDone, setBikeCheckDone] = useState(false);
  const [fitnessConfirmed, setFitnessConfirmed] = useState(false);
  const [badges, setBadges] = useState([]);
  const [sessionLog, setSessionLog] = useState({}); // "wN-i" -> feeling
  const [lastFeeling, setLastFeeling] = useState(null);
  const [adjustmentMins, setAdjustmentMins] = useState(0);
  const [adjustWarning, setAdjustWarning] = useState(null);
  const [checkinTarget, setCheckinTarget] = useState(null);
  const [adHocLog, setAdHocLog] = useState([]); // [{ week, at }]
  const [sessionDurations, setSessionDurations] = useState({}); // "wN-i" -> actual mins, from the ride timer
  const [activeTimer, setActiveTimer] = useState(null); // { key, startedAt, mode, targetMins } while a ride timer is running
  const [timerMode, setTimerMode] = useState("up"); // "up" | "down" — chosen before starting
  const [timerAlerted, setTimerAlerted] = useState(false); // has the countdown-complete alert fired yet
  const [nowTick, setNowTick] = useState(Date.now());
  const [notifAsked, setNotifAsked] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("17:30");
  const [lastActivityAt, setLastActivityAt] = useState(null); // ms epoch of the last logged/ad-hoc ride
  const [comebackNudgeShown, setComebackNudgeShown] = useState(false); // has the one-time "miss you" banner ever fired
  const [showComebackNudge, setShowComebackNudge] = useState(false);
  const [raceOfferShown, setRaceOfferShown] = useState(false); // has the one-time race-discount banner ever fired
  const [showRaceOffer, setShowRaceOffer] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [toastType, setToastType] = useState("info"); // "info" | "trophy"
  const [confettiKey, setConfettiKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [qaTopics, setQaTopics] = useState([]);
  const [qaNotes, setQaNotes] = useState("");
  const [adHocFormOpen, setAdHocFormOpen] = useState(false);
  const [adHocDate, setAdHocDate] = useState("");
  const [adHocMins, setAdHocMins] = useState("30");
  const [adHocFeeling, setAdHocFeeling] = useState("About right");
  const [voiceOn, setVoiceOn] = useState(() => {
    try { return localStorage.getItem(VOICE_KEY) !== "off"; } catch (e) { return true; }
  });
  const [wakeState, setWakeState] = useState("idle"); // idle | on | unsupported | blocked
  const wakeRef = useRef(null);
  const spokenRef = useRef({ tag: "", ids: new Set() });
  const [raceWeek, setRaceWeek] = useState(null); // the next round this account has entered, from the website
  const [races, setRaces] = useState(FALLBACK_RACES); // the live calendar once fetched, else the fallback
  const [funPrice, setFunPrice] = useState(null); // { early, onTheDay } for the Fun category, from the website
  const [account, setAccount] = useState(null); // null until we know; { signedIn, name } from the website
  const [syncReady, setSyncReady] = useState(false); // has this device been reconciled with the account's saved progress
  const [textSize, setTextSize] = useState(() => {
    try {
      const own = localStorage.getItem(TEXT_SIZE_KEY);
      if (own && TEXT_SCALES[own]) return own;
    } catch (e) { /* storage unavailable */ }
    const site = readDisplayPrefs().text;
    return TEXT_SCALES[site] ? site : "standard";
  });
  const [signInCardHidden, setSignInCardHidden] = useState(() => {
    try { return localStorage.getItem("sofaToSingletrack:hideSignInCard") === "1"; } catch (e) { return false; }
  });
  const reduceMotion = typeof window !== "undefined" && (readDisplayPrefs().motion === "reduce" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const nameRef = useRef(null);
  // When the rider last actually changed something (not merely opened the app). Used to decide which copy is newer when a
  // device and the account both have progress, so simply opening the app on a second phone never overwrites the first.
  const modifiedAtRef = useRef(0);
  const suppressBumpUntilRef = useRef(0); // applying a saved copy is not a change made by the rider
  const [riderIndex, setRiderIndex] = useState(loadRiderIndex);
  const persistIndex = (next) => {
    setRiderIndex(next);
    try { localStorage.setItem(RIDERS_KEY, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
  };
  const firstSaveRef = useRef(true);
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  // Puts a saved snapshot (from this device or from the account) into the app.
  const applySaved = (saved) => {
    modifiedAtRef.current = saved.savedAt || 0;
    suppressBumpUntilRef.current = Date.now() + 1000;
    setShowComebackNudge(false);
    setShowRaceOffer(false);
    setTimerAlerted(false);
    setCheckinTarget(null);
    setCoachNote("");
    setWelcomeNote("");
    if (saved.profile) setProfile(saved.profile);
    if (saved.weeks && saved.weeks.length) {
      // Rebuild from the canonical PHASES content rather than trusting the
      // persisted snapshot verbatim — this keeps the rider's exact programme
      // length and day assignments (fixed at signup) but always picks up
      // any session-copy/effort/video updates shipped since they started,
      // instead of freezing them on whatever content existed at signup time.
      const chosenDays = (saved.profile && saved.profile.chosenDays) || saved.weeks[0].sessions.map((s) => s.day);
      // Week 1 is cut to the days on or after the start, exactly as it was when the programme was built (keys depend on it).
      setWeeks(trimWeekOne(buildProgramme(saved.weeks.length, chosenDays), saved.programStart ? new Date(saved.programStart) : new Date()));
    } else if (saved.weeks) {
      setWeeks(saved.weeks);
    }
    if (saved.sessionLog) setSessionLog(saved.sessionLog);
    if (saved.badges) setBadges(saved.badges);
    if (Array.isArray(saved.adHocLog)) setAdHocLog(saved.adHocLog);
    if (typeof saved.notifAsked === "boolean") setNotifAsked(saved.notifAsked);
    if (typeof saved.notifEnabled === "boolean") setNotifEnabled(saved.notifEnabled);
    if (saved.reminderTime) setReminderTime(saved.reminderTime);
    if (typeof saved.lastFeeling !== "undefined") setLastFeeling(saved.lastFeeling);
    if (saved.programStart) setProgramStart(new Date(saved.programStart));
    if (saved.sessionDurations) setSessionDurations(saved.sessionDurations);
    setActiveTimer(saved.activeTimer || null);
    if (typeof saved.adjustmentMins === "number") setAdjustmentMins(saved.adjustmentMins);
    // A reload mid check-in lands back on the dashboard, never on the welcome screen: before this, leaving the stage
    // at its initial "welcome" meant the next save wrote that back, and the rider reopened the app to the intro page
    // as if their programme had gone.
    if (saved.stage) setStage(saved.stage === "checkin" ? "dashboard" : saved.stage);
    setLastActivityAt(typeof saved.lastActivityAt === "number" ? saved.lastActivityAt : null);

    // One-time "the bike misses you" nudge — never repeats once shown, so
    // it doesn't turn into a nag. Fires the first time someone reopens the
    // app 14+ days after their last logged ride (or since starting, if
    // they never got one logged at all).
    const alreadyShown = !!saved.comebackNudgeShown;
    const baseline = saved.lastActivityAt || (saved.programStart ? new Date(saved.programStart).getTime() : null);
    if (!alreadyShown && baseline && saved.stage === "dashboard" && Date.now() - baseline >= 14 * 24 * 60 * 60 * 1000) {
      setShowComebackNudge(true);
    }
    setComebackNudgeShown(alreadyShown || (!!baseline && saved.stage === "dashboard" && Date.now() - baseline >= 14 * 24 * 60 * 60 * 1000));

    // One-time "fancy a race?" nudge — fires once someone is 2+ weeks into
    // their programme, then never again regardless of how long they stick around.
    const raceAlreadyShown = !!saved.raceOfferShown;
    const startMs = saved.programStart ? new Date(saved.programStart).getTime() : null;
    const raceEligible = !!startMs && saved.stage === "dashboard" && Date.now() - startMs >= 14 * 24 * 60 * 60 * 1000;
    if (!raceAlreadyShown && raceEligible) setShowRaceOffer(true);
    setRaceOfferShown(raceAlreadyShown || raceEligible);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(keyForRider(riderIndex.active));
      if (raw) applySaved(JSON.parse(raw));
    } catch (e) {
      // no saved progress yet, or storage unavailable
    }
    setLoaded(true);
  }, []);

  const buildPayload = () => ({ profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart: programStart.toISOString(), savedAt: modifiedAtRef.current, sessionDurations, activeTimer, adjustmentMins, stage, lastActivityAt, comebackNudgeShown, raceOfferShown });

  useEffect(() => {
    if (!loaded) return;
    if (firstSaveRef.current) firstSaveRef.current = false;
    else if (Date.now() > suppressBumpUntilRef.current) modifiedAtRef.current = Date.now();
    try {
      localStorage.setItem(keyForRider(riderIndex.active), JSON.stringify(buildPayload()));
    } catch (e) {
      // storage unavailable (private browsing, quota) — progress just won't persist
    }
  }, [loaded, riderIndex.active, profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart, sessionDurations, activeTimer, adjustmentMins, stage, lastActivityAt, comebackNudgeShown, raceOfferShown]);

  // The rider's name on the switcher follows what they type in setup.
  useEffect(() => {
    if (!loaded || !profile.name) return;
    const cur = riderIndex.riders.find((r) => r.id === riderIndex.active);
    if (cur && cur.name !== profile.name) persistIndex({ ...riderIndex, riders: riderIndex.riders.map((r) => (r.id === riderIndex.active ? { ...r, name: profile.name } : r)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, profile.name, riderIndex.active]);

  // Ask the phone to keep the screen on while a ride timer is running. Not every phone or browser allows it, and it can be refused or
  // released (low battery, another app), so the app says plainly which it is rather than promising.
  useEffect(() => {
    const running = !!activeTimer;
    if (!running) {
      if (wakeRef.current) { wakeRef.current.release().catch(() => {}); wakeRef.current = null; }
      setWakeState("idle");
      return;
    }
    if (!("wakeLock" in navigator)) { setWakeState("unsupported"); return; }
    let cancelled = false;
    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) { lock.release().catch(() => {}); return; }
        wakeRef.current = lock;
        setWakeState("on");
        lock.addEventListener("release", () => {
          if (wakeRef.current === lock) {
            wakeRef.current = null;
            if (!cancelled && document.visibilityState === "visible") setWakeState("blocked");
          }
        });
      } catch (e) {
        if (!cancelled) setWakeState("blocked");
      }
    };
    acquire();
    // Coming back to the app after the screen was off: ask again.
    const onVisible = () => { if (document.visibilityState === "visible" && !wakeRef.current) acquire(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (wakeRef.current) { wakeRef.current.release().catch(() => {}); wakeRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTimer ? activeTimer.key : null]);

  // Spoken cues while the timer runs.
  useEffect(() => {
    if (!activeTimer || !voiceOn) return;
    const tag = activeTimer.key + ":" + activeTimer.startedAt;
    if (spokenRef.current.tag !== tag) spokenRef.current = { tag, ids: new Set() };
    const { cue, mark } = nextCue(rideCues(activeTimer.targetMins, profile.name), nowTick - activeTimer.startedAt, spokenRef.current.ids);
    mark.forEach((id) => spokenRef.current.ids.add(id));
    if (cue) speak(cue.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, activeTimer, voiceOn]);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    try { localStorage.setItem(VOICE_KEY, next ? "on" : "off"); } catch (e) { /* storage unavailable */ }
    if (next) speak("Voice cues on.");
    else if (speechSupported()) window.speechSynthesis.cancel();
  };

  // The live race calendar from the website (falls back to the built-in list if it can't be reached).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/rounds")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const live = racesFromApi(json);
        if (live) setRaces(live);
        if (json.funPrice && typeof json.funPrice.early === "number") setFunPrice(json.funPrice);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // One sign-in with the main website: is this visitor signed in to their MTB east account?
  useEffect(() => {
    let cancelled = false;
    fetch("/api/programme/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setAccount(json && json.signedIn ? { signedIn: true, name: json.name || "" } : { signedIn: false, name: "" }); })
      .catch(() => { if (!cancelled) setAccount({ signedIn: false, name: "" }); });
    return () => { cancelled = true; };
  }, []);

  // Signed in and entered in a race? Show where and when, the forecast, and the timings.
  useEffect(() => {
    if (!account || !account.signedIn) { setRaceWeek(null); return; }
    let cancelled = false;
    fetch("/api/programme/race-week", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setRaceWeek(json && json.entry ? json.entry : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [account]);

  const pushRider = (id, name, payload) =>
    fetch("/api/programme/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ riderId: id, name: name || "", data: payload }) }).catch(() => {});

  // On sign-in, reconcile this device with the account's saved progress, rider by rider: the newer copy wins, and an older
  // copy on the device is kept as a backup rather than thrown away. Riders the account has that this device doesn't are
  // added here; riders on this device the account doesn't have yet are saved to it.
  useEffect(() => {
    if (!loaded || !account || !account.signedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/programme/progress", { credentials: "same-origin" });
        if (!res.ok) return;
        const { riders: remote } = await res.json();
        if (cancelled) return;
        let index = loadRiderIndex();
        let appliedActive = false;
        let addedOthers = false;
        const remoteIds = new Set();
        for (const r of remote || []) {
          remoteIds.add(r.riderId);
          const key = keyForRider(r.riderId);
          const localRaw = localStorage.getItem(key);
          const local = localRaw ? JSON.parse(localRaw) : null;
          const decision = decideSync(local, r.data);
          if (decision.action === "useAccount") {
            if (decision.keepBackup) localStorage.setItem(key + ":backup", localRaw);
            if (r.riderId === index.active) { applySaved(r.data); appliedActive = true; }
            else { localStorage.setItem(key, JSON.stringify(r.data)); addedOthers = true; }
            if (!index.riders.some((x) => x.id === r.riderId)) index = { ...index, riders: [...index.riders, { id: r.riderId, name: r.name || (r.data && r.data.profile && r.data.profile.name) || "" }] };
          } else if (decision.action === "saveToAccount") {
            await pushRider(r.riderId, r.name || (local && local.profile && local.profile.name) || "", local);
          }
        }
        for (const rider of index.riders) {
          if (remoteIds.has(rider.id)) continue;
          const raw = localStorage.getItem(keyForRider(rider.id));
          if (!raw) continue;
          const local = JSON.parse(raw);
          if (decideSync(local, null).action === "saveToAccount") await pushRider(rider.id, rider.name || (local.profile && local.profile.name) || "", local);
        }
        persistIndex(index);
        if (appliedActive) showToast("Your saved progress has been loaded");
        else if (addedOthers) showToast("Your family's saved progress has been loaded");
      } catch (e) {
        // offline or not available: the app carries on with what's on the device
      } finally {
        if (!cancelled) setSyncReady(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, account]);

  // While signed in, keep the account copy of the current rider up to date (a couple of seconds after the last change).
  useEffect(() => {
    if (!loaded || !syncReady || !account || !account.signedIn) return;
    const t = setTimeout(() => pushRider(riderIndex.active, profile.name, buildPayload()), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, syncReady, account, riderIndex.active, profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart, sessionDurations, activeTimer, adjustmentMins, stage, lastActivityAt, comebackNudgeShown, raceOfferShown]);

  // A signed-in rider doesn't have to type their name again.
  useEffect(() => {
    if (account && account.signedIn && account.name && !profile.name && riderIndex.active === "main" && riderIndex.riders.length === 1 && (stage === "welcome" || stage === "onboarding")) {
      setProfile((p) => (p.name ? p : { ...p, name: account.name }));
    }
  }, [account, stage, profile.name]);

  useEffect(() => { if (stage === "onboarding" && nameRef.current) nameRef.current.focus(); }, [stage, step]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), toastType === "trophy" ? 4200 : 3000); return () => clearTimeout(t); }, [toast, toastType]);
  useEffect(() => { const t = setTimeout(() => setShowSplash(false), reduceMotion ? 0 : 1600); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!activeTimer) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeTimer]);

  useEffect(() => {
    if (!activeTimer || activeTimer.mode !== "down" || timerAlerted) return;
    const remaining = activeTimer.targetMins * 60000 - (nowTick - activeTimer.startedAt);
    if (remaining <= 0) {
      setTimerAlerted(true);
      playTimerAlertSound();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }, [nowTick, activeTimer, timerAlerted]);

  const allSessions = weeks.flatMap((w) =>
    w.sessions.map((s, i) => ({ key: `${w.n}-${i}`, weekN: w.n, idx: i, session: s, weekTitle: w.title }))
  );
  const unlogged = allSessions.filter((s) => !(s.key in sessionLog));
  const nextSession = unlogged[0] || null;
  const nextSessionEffective = nextSession ? effectiveSession(nextSession.session, adjustmentMins) : null;
  const upcoming = unlogged.slice(1, 3);
  const currentWeekN = nextSession ? nextSession.weekN : weeks[weeks.length - 1].n;
  const programmeComplete = unlogged.length === 0;
  const programEndDate = new Date(programStart.getTime() + weeks.length * 7 * 24 * 60 * 60 * 1000);
  const nextRelevantRace = races.find((r) => new Date(r.date) > programEndDate && new Date(r.date) > new Date());

  // A week counts as "engaged" if it has at least one real (non-skip) session log,
  // or an ad-hoc ride logged during it. Streak = consecutive engaged weeks counting
  // back from the current week — a single skip doesn't break it, but a week with
  // nothing logged at all does.
  const weekEngaged = (weekN) => {
    const hasStructured = weeks.find((w) => w.n === weekN)?.sessions.some((_, i) => sessionLog[`${weekN}-${i}`] && sessionLog[`${weekN}-${i}`] !== "Didn't get to it");
    const hasAdHoc = adHocLog.some((r) => r.week === weekN);
    return hasStructured || hasAdHoc;
  };
  let streakWeeks = 0;
  for (let w = currentWeekN; w >= 1; w--) {
    if (weekEngaged(w)) streakWeeks++;
    else break;
  }
  const totalRidesLogged = Object.values(sessionLog).filter((f) => f !== "Didn't get to it").length + adHocLog.length;

  const structuredDone = allSessions.filter((s) => sessionLog[s.key] && sessionLog[s.key] !== "Didn't get to it").length;
  const completionPct = allSessions.length ? Math.round((structuredDone / allSessions.length) * 100) : 0;
  const adHocMinutesRidden = adHocLog.reduce((sum, r) => sum + (r.mins || 0), 0);
  const totalMinutesRidden = allSessions.reduce((sum, s) => sum + (sessionLog[s.key] && sessionLog[s.key] !== "Didn't get to it" ? (sessionDurations[s.key] ?? s.session.mins) : 0), 0) + adHocMinutesRidden;

  // Recap of the week just gone, shown on the dashboard — only surfaced when
  // there's something to report, never to call out an empty week.
  const lastWeekN = currentWeekN - 1;
  const lastWeekStructured = allSessions.filter((s) => s.weekN === lastWeekN && sessionLog[s.key] && sessionLog[s.key] !== "Didn't get to it");
  const lastWeekAdHoc = adHocLog.filter((r) => r.week === lastWeekN);
  const lastWeekRideCount = lastWeekStructured.length + lastWeekAdHoc.length;
  const lastWeekMinutes = lastWeekStructured.reduce((sum, s) => sum + (sessionDurations[s.key] ?? s.session.mins), 0) + lastWeekAdHoc.reduce((sum, r) => sum + (r.mins || 0), 0);

  // Longest run of consecutive engaged weeks across the whole programme so far —
  // distinct from streakWeeks above, which only counts the current run.
  let longestStreakWeeks = 0;
  let runningStreak = 0;
  for (let w = 1; w <= weeks.length; w++) {
    if (weekEngaged(w)) {
      runningStreak++;
      longestStreakWeeks = Math.max(longestStreakWeeks, runningStreak);
    } else {
      runningStreak = 0;
    }
  }

  // Re-checks every trophy condition against a fresh sessionLog/adHocLog snapshot
  // (passed in directly rather than read from state, since state hasn't committed
  // yet at the point this is called) and returns any newly-earned trophy labels.
  // Compares against `badges` from closure (not a setState updater) so the result
  // is available synchronously to the caller — setState updaters aren't guaranteed
  // to run before the next line of code, only before the next render.
  const checkAllBadges = (log, adHoc) => {
    const candidates = [];
    weeks.forEach((w) => {
      const allLogged = w.sessions.every((_, i) => `${w.n}-${i}` in log);
      if (!allLogged) return;
      if (w.n === 1) candidates.push("First week done");
      if (w.n === 4) candidates.push("First month done");
      if (w.n === 8) candidates.push("Two months done");
      if (w.n === 12) candidates.push("Three months done");
    });

    const hasAnyRealRide = Object.values(log).some((f) => f !== "Didn't get to it") || adHoc.length > 0;
    if (hasAnyRealRide) candidates.push("First ride done");

    const totalMins = allSessions.reduce((sum, s) => sum + (log[s.key] && log[s.key] !== "Didn't get to it" ? (sessionDurations[s.key] ?? s.session.mins) : 0), 0);
    if (totalMins >= 300) candidates.push("5 hours ridden");

    const engagedInSnapshot = (weekN) => {
      const hasStructured = weeks.find((w) => w.n === weekN)?.sessions.some((_, i) => log[`${weekN}-${i}`] && log[`${weekN}-${i}`] !== "Didn't get to it");
      const hasAdHoc = adHoc.some((r) => r.week === weekN);
      return hasStructured || hasAdHoc;
    };
    for (let w = 2; w <= weeks.length; w++) {
      if (engagedInSnapshot(w) && !engagedInSnapshot(w - 1)) {
        candidates.push("Bounced back");
        break;
      }
    }

    const justAwarded = candidates.filter((label) => !badges.includes(label));
    if (justAwarded.length > 0) {
      setBadges((prev) => {
        const merged = [...prev];
        justAwarded.forEach((label) => { if (!merged.includes(label)) merged.push(label); });
        return merged;
      });
    }
    return justAwarded;
  };

  const chooseRace = (race) => {
    const totalWeeks = weeksBetween(race.date);
    const p = { ...profile, planType: "race", raceId: race.id };
    setProfile(p);
    setWeeks(buildProgramme(totalWeeks, p.chosenDays));
    setStep(step + 1);
  };

  const chooseMonths = (months) => {
    const p = { ...profile, planType: "months", months };
    setProfile(p);
    setWeeks(buildProgramme(months * 4, p.chosenDays));
    setStep(step + 1);
  };

  const startProgramme = () => {
    // The programme starts now (not when the app was first opened), and week 1 is this calendar week: the rides whose
    // day has already gone are dropped from it. If none are left this week, it starts next Monday instead.
    const start = programmeStartFor(new Date(), weeks[0]);
    const plan = trimWeekOne(weeks, start);
    setProgramStart(start);
    setWeeks(plan);
    setStage("dashboard");
    const first = plan[0].sessions[0];
    const welcomeTemplate = COACH_SCENARIOS.welcome || "Welcome aboard, {name} — your first session, {sessionName}, is a gentle one on purpose.";
    setWelcomeNote(fillTemplate(welcomeTemplate, { name: profile.name || "rider", sessionName: first.name }));
    // The only place "have you ridden off-road before?" actually feeds into the
    // plan — an already-regular rider starts one difficulty step up rather than
    // at the same baseline as someone brand new, using the same ±5 min lever
    // the feel-based check-ins use later. Deliberately not forking the plan
    // itself, which stays the one canonical schedule for everyone.
    if (profile.experience === "Ridden regularly, never raced") setAdjustmentMins(ADJUSTMENT_STEP);
  };

  const openCheckin = (target) => {
    setCheckinTarget(target);
    setAdjustWarning(null);
    setStage("checkin");
  };

  const showToast = (text, type = "info") => {
    setToastType(type);
    setToast(text);
  };

  const triggerConfetti = () => {
    setConfettiKey((k) => k + 1);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 2600);
  };

  const trophyToastText = (justAwarded) =>
    justAwarded.length === 1 ? `🏆 Trophy unlocked: ${justAwarded[0]}` : `🏆 ${justAwarded.length} new trophies unlocked!`;

  const celebrateTrophies = (justAwarded) => {
    showToast(trophyToastText(justAwarded), "trophy");
    triggerConfetti();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]); // Android only — iOS Safari has no Vibration API
  };

  // Difficulty adjustment: every "Tougher than expected" / "Had to stop early"
  // trims 5 minutes off every session still to come; every "Easier than
  // expected" adds 5. It keeps compounding report after report (clamped so a
  // session can never vanish or balloon) until a rider reports "About right",
  // which resets it back to zero.
  const ADJUSTMENT_STEP = 5;
  const ADJUSTMENT_MIN = -15;
  const ADJUSTMENT_MAX = 15;

  const applyFeelingAdjustment = (feeling) => {
    if (feeling === "About right") {
      setAdjustmentMins(0);
      return null;
    }
    if (feeling === "Didn't get to it") return null;
    const delta = feeling === "Easier than expected" ? ADJUSTMENT_STEP : -ADJUSTMENT_STEP;
    const next = Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, adjustmentMins + delta));
    setAdjustmentMins(next);
    return delta > 0 ? "up" : "down";
  };

  const logSession = (target, feeling, { navigate = true } = {}) => {
    const isFirstEver = Object.keys(sessionLog).length === 0;
    const newLog = { ...sessionLog, [target.key]: feeling };
    setSessionLog(newLog);
    // Logging the session that is being timed ends that timer: before this it kept running out of sight, holding the
    // screen awake and speaking the old ride's cues. Its minutes are kept as the real duration.
    let timedMins = null;
    if (activeTimer && activeTimer.key === target.key) {
      timedMins = Math.max(1, Math.round((Date.now() - activeTimer.startedAt) / 60000));
      if (feeling !== "Didn't get to it") setSessionDurations((prev) => ({ ...prev, [target.key]: timedMins }));
      setActiveTimer(null);
      setTimerAlerted(false);
    }
    setLastFeeling(feeling === "Didn't get to it" ? lastFeeling : feeling);

    // Record what they actually just did, in case they logged manually
    // without the timer — a real timer reading (the one just stopped above, or one
    // already in sessionDurations) takes priority over the planned figure.
    if (feeling !== "Didn't get to it" && timedMins == null && !(target.key in sessionDurations)) {
      const effectiveMins = Math.max(5, target.session.mins + adjustmentMins);
      setSessionDurations((prev) => ({ ...prev, [target.key]: effectiveMins }));
    }
    if (feeling !== "Didn't get to it") setLastActivityAt(Date.now());

    setAdjustWarning(applyFeelingAdjustment(feeling));

    const justAwarded = checkAllBadges(newLog, adHocLog);

    if (justAwarded.length > 0) {
      celebrateTrophies(justAwarded);
    } else if (!navigate) {
      showToast(feeling === "Didn't get to it" ? "No worries — logged as skipped." : "Session logged.");
    }

    if (!navigate) return;
    setCoachNote(getCoachNote(target, feeling));
  };

  const submitCheckin = (feeling) => checkinTarget && logSession(checkinTarget, feeling, { navigate: true });
  const quickSkip = (target) => {
    if (activeTimer && activeTimer.key === target.key) setActiveTimer(null);
    logSession(target, "Didn't get to it", { navigate: false });
  };

  const startRideTimer = (target, targetMins) => {
    if (voiceOn) speak(`Starting your ${targetMins} minute ride.`);
    setActiveTimer({ key: target.key, startedAt: Date.now(), mode: timerMode, targetMins });
    setTimerAlerted(false);
  };
  const cancelRideTimer = () => { setActiveTimer(null); setTimerAlerted(false); };
  const finishRideTimer = () => {
    if (!activeTimer) return;
    const elapsedMins = Math.max(1, Math.round((Date.now() - activeTimer.startedAt) / 60000));
    const key = activeTimer.key;
    const priorBest = Math.max(0, ...Object.values(sessionDurations));
    setSessionDurations((prev) => ({ ...prev, [key]: elapsedMins }));
    setActiveTimer(null);
    setTimerAlerted(false);
    if (priorBest > 0 && elapsedMins > priorBest) {
      showToast(`⭐ New personal best! Longest ride yet: ${formatMinutes(elapsedMins)}`, "trophy");
    }
    const target = allSessions.find((s) => s.key === key);
    if (target) openCheckin(target);
  };

  const backToDashboard = () => {
    setCheckinTarget(null);
    setCoachNote("");
    setAdjustWarning(null);
    setExplainerOpen(false);
    setStage("dashboard");
  };

  const toggleQaTopic = (topic) => {
    setQaTopics((prev) => (prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]));
  };

  const sendQaFeedback = () => {
    const lines = [
      `Rider: ${profile.name || "not given"}`,
      `Interested in: ${qaTopics.length ? qaTopics.join(", ") : "not specified"}`,
      qaNotes.trim() ? `Notes: ${qaNotes.trim()}` : null,
    ].filter(Boolean).join("\n");
    const mailto = `mailto:info@mtbeast.co.uk?subject=${encodeURIComponent("Sofa to Singletrack — what I'd like from MTB East")}&body=${encodeURIComponent(lines)}`;
    window.location.href = mailto;
    setQaTopics([]);
    setQaNotes("");
    setStage("dashboard");
    showToast("Thanks — opening your email to send this to the coaches.");
  };

  const handleShare = async () => {
    const shareData = {
      title: "Sofa to Singletrack",
      text: "I'm using Sofa to Singletrack, an MTB East programme to get riding regularly — thought you might like it too.",
      url: window.location.origin,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (e) { /* user cancelled the share sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      showToast("Link copied — paste it to share!");
    } catch (e) {
      showToast(`Share this link: ${shareData.url}`);
    }
  };

  const generateFinishCardBlob = async () => {
    try { await document.fonts.load("700 76px Oswald"); } catch (e) { /* fall back to default font */ }
    try { await document.fonts.load("600 28px 'Source Sans 3'"); } catch (e) { /* fall back to default font */ }

    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#14171A";
    ctx.fillRect(0, 0, 1080, 1080);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#E8792B";
    ctx.beginPath();
    ctx.arc(1080, 0, 520, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    try {
      const logo = await loadImage(`${import.meta.env.BASE_URL}brand/header-mark.png`);
      ctx.drawImage(logo, 490, 90, 100, 100);
    } catch (e) { /* logo optional, card still works without it */ }

    ctx.textAlign = "center";
    ctx.fillStyle = "#B9BDB8";
    ctx.font = "600 28px 'Source Sans 3', sans-serif";
    ctx.fillText("MTB EAST", 540, 240);

    ctx.fillStyle = "#E8792B";
    ctx.font = "700 76px Oswald, sans-serif";
    ctx.fillText("SOFA TO", 540, 350);
    ctx.fillText("SINGLETRACK", 540, 430);

    ctx.fillStyle = "#F4F3EF";
    ctx.font = "700 50px Oswald, sans-serif";
    const who = (profile.name || "").trim().toUpperCase();
    if (who) {
      ctx.fillStyle = "#F4F3EF";
      ctx.font = "600 38px Oswald, sans-serif";
      ctx.fillText(who, 540, 505);
      ctx.fillStyle = "#F4F3EF";
    }
    ctx.font = "700 50px Oswald, sans-serif";
    ctx.fillText("I'M A REGULAR RIDER NOW", 540, 560);

    const stats = [
      { label: "WEEKS", value: String(weeks.length) },
      { label: "RIDES", value: String(totalRidesLogged) },
      { label: "TIME RIDDEN", value: formatMinutes(totalMinutesRidden) },
    ];
    const startX = 540 - (stats.length - 1) * 150;
    stats.forEach((s, i) => {
      const x = startX + i * 300;
      ctx.fillStyle = "#1B8A82";
      ctx.font = "700 56px Oswald, sans-serif";
      ctx.fillText(s.value, x, 700);
      ctx.fillStyle = "#B9BDB8";
      ctx.font = "600 20px 'Source Sans 3', sans-serif";
      ctx.fillText(s.label, x, 735);
    });

    ctx.fillStyle = "#B9BDB8";
    ctx.font = "500 28px 'Source Sans 3', sans-serif";
    ctx.fillText("Finished " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), 540, 860);

    ctx.fillStyle = "#7A7E79";
    ctx.font = "500 22px 'Source Sans 3', sans-serif";
    ctx.fillText("An MTB East programme", 540, 980);

    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  };

  const handleShareFinishCard = async () => {
    const blob = await generateFinishCardBlob();
    if (!blob) {
      showToast("Couldn't create the image — try again.");
      return;
    }
    const file = new File([blob], "sofa-to-singletrack-complete.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Sofa to Singletrack", text: "I finished the Sofa to Singletrack programme with MTB East!" });
        return;
      } catch (e) {
        return; // user cancelled the share sheet
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sofa-to-singletrack-complete.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Image saved — share it from your photos!");
  };

  const openAdHocForm = () => {
    setAdHocDate(dateKey(new Date()));
    setAdHocMins("30");
    setAdHocFeeling("About right");
    setAdHocFormOpen(true);
  };

  const cancelAdHocForm = () => setAdHocFormOpen(false);

  const submitAdHocRide = () => {
    const mins = parseInt(adHocMins, 10);
    if (!mins || mins <= 0) {
      showToast("Add how many minutes you rode.");
      return;
    }
    const rideDate = adHocDate ? new Date(`${adHocDate}T12:00:00`) : new Date();
    const week = weekNumberForDate(programStart, rideDate);
    const newAdHocLog = [...adHocLog, { week, at: rideDate.getTime(), mins, feeling: adHocFeeling }];
    setAdHocLog(newAdHocLog);
    setAdHocFormOpen(false);
    setLastActivityAt(Date.now());
    const justAwarded = checkAllBadges(sessionLog, newAdHocLog);
    if (justAwarded.length > 0) {
      celebrateTrophies(justAwarded);
    } else {
      showToast("Nice one — ride logged.");
    }
  };


  const toggleDay = (day) => {
    setProfile((p) => {
      const has = p.chosenDays.includes(day);
      let next;
      if (has) next = p.chosenDays.filter((d) => d !== day);
      else if (p.chosenDays.length < p.sessionsPerWeek) next = [...p.chosenDays, day];
      else next = p.chosenDays;
      return { ...p, chosenDays: next.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b)) };
    });
  };

  const setSessionsPerWeek = (n) => {
    const defaults = n === 2 ? ["Sat", "Sun"] : ["Tue", "Thu", "Sat"];
    setProfile((p) => ({ ...p, sessionsPerWeek: n, chosenDays: defaults }));
  };

  // Family riders: each has their own plan and progress. Switching saves the current rider first, then loads the other.
  const flushCurrentRider = () => {
    try { localStorage.setItem(keyForRider(riderIndex.active), JSON.stringify(buildPayload())); } catch (e) { /* storage unavailable */ }
  };
  const loadRider = (id, fallbackName) => {
    let raw = null;
    try { raw = localStorage.getItem(keyForRider(id)); } catch (e) { /* storage unavailable */ }
    applySaved(raw ? JSON.parse(raw) : blankSaved(fallbackName || ""));
    setStep(0);
  };
  const switchRider = (id) => {
    if (id === riderIndex.active) return;
    flushCurrentRider();
    const target = riderIndex.riders.find((r) => r.id === id);
    loadRider(id, target ? target.name : "");
    persistIndex({ ...riderIndex, active: id });
  };
  const addRider = (name) => {
    const clean = (name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) return "Please give their first name.";
    if (riderIndex.riders.length >= MAX_RIDERS) return "That's the most riders one account can hold.";
    flushCurrentRider();
    const id = newRiderId();
    applySaved(blankSaved(clean));
    setStep(0);
    persistIndex({ active: id, riders: [...riderIndex.riders, { id, name: clean }] });
    return null;
  };
  const removeRider = (id) => {
    if (id === "main") return;
    const who = riderIndex.riders.find((r) => r.id === id);
    if (!window.confirm(`Remove ${who && who.name ? who.name : "this rider"} and their progress for good?`)) return;
    try { localStorage.removeItem(keyForRider(id)); localStorage.removeItem(keyForRider(id) + ":backup"); } catch (e) { /* storage unavailable */ }
    if (account && account.signedIn) fetch("/api/programme/progress", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ riderId: id }) }).catch(() => {});
    const remaining = riderIndex.riders.filter((r) => r.id !== id);
    if (id === riderIndex.active) {
      const first = remaining[0];
      loadRider(first.id, first.name);
      persistIndex({ active: first.id, riders: remaining });
    } else {
      persistIndex({ ...riderIndex, riders: remaining });
    }
  };

  const changeTextSize = (key) => {
    setTextSize(key);
    try { localStorage.setItem(TEXT_SIZE_KEY, key); } catch (e) { /* storage unavailable */ }
  };

  const selectedRace = races.find((r) => r.id === profile.raceId);

  const adjustTag = (feeling) => {
    if (feeling === "Tougher than expected" || feeling === "Had to stop early") return "Take it easier — adjusted after your last session";
    if (feeling === "Easier than expected") return "Pushed a little more — adjusted after your last session";
    return null;
  };

  return (
    <div style={{ fontFamily: "'Source Sans 3', sans-serif", background: "#000000", color: "#F4F3EF", minHeight: "100vh", position: "relative" }}>
      <style>{`
        .display { font-family: 'Oswald', sans-serif; letter-spacing: 0.02em; font-weight: 600; }
        button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 3px solid #E8792B; outline-offset: 2px; }
        button { min-height: 44px; }
        input[type="checkbox"] { width: 22px !important; height: 22px !important; }
        @keyframes toastPop { 0% { transform: translateX(-50%) scale(0.85); opacity: 0; } 60% { transform: translateX(-50%) scale(1.06); opacity: 1; } 100% { transform: translateX(-50%) scale(1); opacity: 1; } }
        .toast-pop { animation: toastPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes confettiFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(600deg); opacity: 0; } }
        @keyframes timerAlertPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.03); } }
        .timer-alert { animation: timerAlertPulse 0.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>
      {showSplash && <SplashScreen />}
      <TopoBackground />
      <SiteNav account={account} />
      <div style={{ position: "relative", zIndex: 1, zoom: TEXT_SCALES[textSize] || 1 }}>
        <AppHeader />
        <RiderSwitcher index={riderIndex} onSwitch={switchRider} />

        {showConfetti && !reduceMotion && <Confetti key={confettiKey} />}

        {toast && (
          <div
            className={toastType === "trophy" ? "toast-pop" : undefined}
            style={{
              position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
              background: toastType === "trophy" ? "#AE5B20" : "#0F5F59", color: "#fff",
              padding: toastType === "trophy" ? "10px 20px" : "8px 16px", borderRadius: 20,
              fontSize: toastType === "trophy" ? 14 : 13, fontWeight: 700, zIndex: 10,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)", maxWidth: "88vw", textAlign: "center",
            }}
          >
            {toast}
          </div>
        )}

      {stage === "welcome" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px 40px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>AN MTB EAST PROGRAMME</div>
          <h1 className="display" style={{ fontSize: 40, lineHeight: 1.05, margin: "0 0 16px", color: "#E8792B" }}>SOFA TO<br />SINGLETRACK</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, color: "#F4F3EF", marginBottom: 10 }}>
            A simple plan to get you riding regularly — 2 or 3 sessions a week, on days that work for you, time-based
            so you don't need a fancy bike computer. Racing is entirely optional, and never the point.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#B9BDB8", marginBottom: 28 }}>
            Built by MTB East, for off-road riding specifically — not a general cycling app. Real local trails, a real local club.
          </p>
          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 28, border: "1px solid #2b2b2b" }}>
            <ContourProgress weeks={buildProgramme(8, ["Tue", "Thu", "Sat"])} currentWeek={1} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#B9BDB8", marginTop: 4 }}>
              <span>Week 1</span><span>Riding regularly</span>
            </div>
          </div>
          <GpNote />
          <TextSizeControl value={textSize} onChange={changeTextSize} />
          <button onClick={() => setStage("onboarding")} style={navBtn}>Start your programme</button>
          <InstallPrompt deferredPrompt={deferredPrompt} onInstall={handleInstallClick} isIOS={isIOS} isStandalone={isStandalone} />
          <p style={{ fontSize: 15, color: "#868A85", lineHeight: 1.5, marginTop: 18 }}>
            Training and fuelling notes are general guidance from a fixed content library, not personalised medical, dietetic or coaching advice.
            Mountain biking carries a risk of injury, so ride within your ability.
            Everything you enter is stored on this device. If you sign in with your MTB east account, your progress is also saved to your account so it follows you between devices; only you can see it.
          </p>
          <a href="games/index.html" style={{ display: "block", textAlign: "center", fontFamily: "Oswald, sans-serif", fontSize: 15, letterSpacing: "0.04em", color: "#1B8A82", textDecoration: "none", marginBottom: 18 }}>
            Got younger riders at home? Try our free games →
          </a>
          <FAQSection />
        </div>
      )}

      {stage === "onboarding" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 20 }}>GET STARTED</div>

          {step === 0 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>What should we call you?</label>
              <input ref={nameRef} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="First name" style={inputStyle} />
              <button onClick={() => setStep(1)} style={navBtn} disabled={!profile.name.trim()}>Next</button>
            </div>
          )}

          {step === 1 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Have you ridden off-road before?</label>
              {["Never ridden a bike off-road", "Ridden trails casually", "Ridden regularly, never raced"].map((opt) => (
                <button key={opt} onClick={() => { setProfile({ ...profile, experience: opt }); setStep(2); }} style={{ ...choiceBtn, borderColor: profile.experience === opt ? "#E8792B" : "#2b2b2b" }}>{opt}</button>
              ))}
              <button onClick={() => setStep(0)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 2 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How many days a week can you ride?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either works — pick whatever actually fits your week.</p>
              <button onClick={() => { setSessionsPerWeek(3); setStep(3); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 3 ? "#E8792B" : "#2b2b2b" }}>3 days a week (recommended)</button>
              <button onClick={() => { setSessionsPerWeek(2); setStep(3); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 2 ? "#E8792B" : "#2b2b2b" }}>2 days a week — e.g. weekends only</button>
              <button onClick={() => setStep(1)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 3 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Which {profile.sessionsPerWeek} days work best?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Pick exactly {profile.sessionsPerWeek} — tap to select or deselect.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {WEEKDAYS.map((day) => {
                  const selected = profile.chosenDays.includes(day);
                  const disabled = !selected && profile.chosenDays.length >= profile.sessionsPerWeek;
                  return (
                    <button key={day} onClick={() => toggleDay(day)} disabled={disabled}
                      style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid " + (selected ? "#AE5B20" : "#2b2b2b"), background: selected ? "#AE5B20" : "#161616", color: selected ? "#fff" : disabled ? "#5c5f5c" : "#F4F3EF", fontSize: 16, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>
                      {day}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setStep(4)} style={navBtn} disabled={profile.chosenDays.length !== profile.sessionsPerWeek}>Next</button>
              <button onClick={() => setStep(2)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 4 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How do you want to plan it?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either way, the goal is the same — riding regularly. Racing is just an optional bonus if you fancy it.</p>
              <button onClick={() => setStep(5)} style={{ ...choiceBtn, borderColor: profile.planType === "race" ? "#E8792B" : "#2b2b2b" }}>I'd like the option of a race at the end</button>
              <button onClick={() => setStep(6)} style={{ ...choiceBtn, borderColor: profile.planType === "months" ? "#E8792B" : "#2b2b2b" }}>No pressure — just build a riding habit</button>
              <button onClick={() => setStep(3)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 5 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Choose your target round</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>The 2027 League calendar. Pick the round you'd like to aim for. Racing is entirely optional.</p>
              {races.map((race) => (
                <button key={race.id} onClick={() => chooseRace(race)} style={{ ...choiceBtn, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span><strong>{race.name}</strong> — {race.venue}</span>
                  <span style={{ color: "#B9BDB8", fontSize: 15 }}>{new Date(race.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </button>
              ))}
              <button onClick={() => setStep(4)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 6 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Choose a timescale</label>
              {[1, 2, 3].map((m) => (
                <button key={m} onClick={() => chooseMonths(m)} style={choiceBtn}>{m} month{m > 1 ? "s" : ""} ({m * 4} weeks)</button>
              ))}
              <button onClick={() => setStep(4)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 7 && (
            <div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Your programme</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                  {weeks.length} weeks, {profile.sessionsPerWeek} sessions a week ({profile.chosenDays.join("/")}){profile.planType === "race" && selectedRace ? <> — with the option to race at <strong>{selectedRace.name}</strong>, {selectedRace.venue}</> : <> — no race pressure, just building the habit</>}.
                </p>
                <p style={{ margin: "10px 0 0", fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>
                  Every session works just as well outdoors on the trail or indoors on a turbo trainer / gym bike — same time, same effort, whichever suits you that day.
                </p>
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 14, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Before your first ride</div>
                <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5, color: "#B9BDB8" }}>A two-minute check of brakes, tyres and quick releases before you head out. Tap each one to see what to look for.</p>
                <BikeSetupCheck bordered={false} />
                <button onClick={() => setBikeCheckDone(true)} style={{ width: "100%", padding: "10px 0", background: bikeCheckDone ? "#0F5F59" : "#0d0d0d", color: bikeCheckDone ? "#fff" : "#F4F3EF", border: "1px solid " + (bikeCheckDone ? "#0F5F59" : "#2b2b2b"), borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                  {bikeCheckDone ? "✓ Bike checked" : "I've checked my bike"}
                </button>
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Before you start</div>
                <GpNote />
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={fitnessConfirmed} onChange={(e) => setFitnessConfirmed(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>
                    I've read the health note. I'm well enough to take part in this kind of activity, and if I'm unsure I'll check with my GP before starting.
                  </span>
                </label>
              </div>

              <button onClick={startProgramme} style={navBtn} disabled={!bikeCheckDone || !fitnessConfirmed}>Build my programme</button>
              <button onClick={() => setStep(profile.planType === "race" ? 5 : 6)} style={backBtn}>Back</button>
            </div>
          )}
        </div>
      )}

      {stage === "dashboard" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 20px 48px" }}>

          {showComebackNudge && !programmeComplete && (
            <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #E8792B", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">🚲</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Your bike misses you</div>
                <div style={{ fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>It's been a couple of weeks — no pressure, jump back in whenever you're ready.</div>
              </div>
              <button onClick={() => setShowComebackNudge(false)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "#868A85", fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>
          )}

          {!(account && !account.signedIn && signInCardHidden) && <AccountCard account={account} onHide={() => { setSignInCardHidden(true); try { localStorage.setItem("sofaToSingletrack:hideSignInCard", "1"); } catch (e) { /* storage unavailable */ } }} />}
          {raceWeek && <RaceWeekCard entry={raceWeek} />}
          {!raceWeek && selectedRace && raceWeekNote(daysUntil(selectedRace.date)) && new Date(selectedRace.date + "T00:00:00") >= new Date(new Date().setHours(0, 0, 0, 0)) && (
            <RaceCoachNote race={selectedRace} note={raceWeekNote(daysUntil(selectedRace.date))} />
          )}
          {showRaceOffer && nextRelevantRace && !raceWeek && !programmeComplete && (
            <RaceAdvert race={nextRelevantRace} funPrice={funPrice} onDismiss={() => setShowRaceOffer(false)} />
          )}

          {!programmeComplete && nextSession && (
            <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 16, border: "2px solid #E8792B", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -112, right: -112, width: 254, height: 254, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,121,43,0.35) 0%, rgba(232,121,43,0) 70%)", pointerEvents: "none" }} />
              <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 10, padding: "5px 10px", textAlign: "center", minWidth: 44, flexShrink: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.04em" }}>{nextSession.session.day}</div>
                  <div className="display" style={{ fontSize: 20, color: "#F4F3EF", lineHeight: 1.1 }}>{sessionDate(programStart, nextSession.weekN, nextSession.session.day).getDate()}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Next up</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">{SESSION_ICONS[nextSession.session.name] || "🚵"}</span>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{nextSession.session.name}</div>
                    {MICRO_EXPLAINERS[nextSession.session.name] && (
                      <button onClick={() => setExplainerOpen((v) => !v)} aria-label="Why this session?" style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: "1px solid #B9BDB8", color: "#B9BDB8", fontSize: 14, fontWeight: 700, cursor: "pointer", lineHeight: "18px", padding: 0, flexShrink: 0 }}>?</button>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <EffortDots effort={nextSession.session.effort} />
              </div>
              {explainerOpen && MICRO_EXPLAINERS[nextSession.session.name] && (
                <p style={{ fontSize: 14, color: "#B9BDB8", background: "#0d0d0d", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px", lineHeight: 1.4 }}>
                  {MICRO_EXPLAINERS[nextSession.session.name]}
                </p>
              )}
              {adjustTag(lastFeeling) && (
                <div style={{ display: "inline-block", background: "#0d0d0d", color: "#1B8A82", fontSize: 13, fontWeight: 600, borderRadius: 6, padding: "3px 8px", marginBottom: 8 }}>
                  {adjustTag(lastFeeling)}
                </div>
              )}
              <GlossaryText key={nextSession.key} text={nextSessionEffective.detail} />
              {nextSessionEffective.video ? (
                <a href={`https://www.youtube.com/watch?v=${nextSessionEffective.video}`} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 10, background: "#0d0d0d", borderRadius: 8, padding: "10px 12px", marginBottom: 14, border: "1px solid #2b2b2b", textDecoration: "none" }}>
                  <img src={`https://img.youtube.com/vi/${nextSessionEffective.video}/hqdefault.jpg`} alt="" width={64} height={36} style={{ borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>▶ Watch the demo</div>
                    <div style={{ fontSize: 13, color: "#868A85" }}>Opens on YouTube</div>
                  </div>
                </a>
              ) : null}
              {(() => {
                const running = activeTimer && activeTimer.key === nextSession.key;
                const isDown = running ? activeTimer.mode === "down" : timerMode === "down";
                const elapsedMs = running ? nowTick - activeTimer.startedAt : 0;
                const remainingMs = running ? activeTimer.targetMins * 60000 - elapsedMs : 0;
                const overtime = running && isDown && remainingMs <= 0;
                return (
                  <>
                    {!running && (
                      <div style={{ display: "flex", gap: 6, marginBottom: 10, justifyContent: "center" }}>
                        {["up", "down"].map((m) => {
                          const active = timerMode === m;
                          return (
                            <button key={m} onClick={() => setTimerMode(m)}
                              style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 5, border: "1px solid " + (active ? "rgb(102,255,0)" : "#2b2b2b"), background: active ? "rgba(102,255,0,0.12)" : "#0d0d0d", color: active ? "rgb(102,255,0)" : "#B9BDB8", cursor: "pointer" }}>
                              {m === "up" ? "⏱ Count up" : "⏳ Count down"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div
                      className={overtime ? "timer-alert" : undefined}
                      style={{ background: "#0d0d0d", borderRadius: 10, padding: "14px", marginBottom: 12, textAlign: "center", border: "1px solid " + (overtime ? "#E24B4A" : "rgb(102, 255, 0)") }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: overtime ? "#E24B4A" : "#868A85", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                        {overtime ? "Time's up!" : isDown ? "Time left" : "Elapsed"}
                      </div>
                      <div className="display" style={{ fontSize: 32, color: overtime ? "#E24B4A" : "#F4F3EF" }}>
                        {!running
                          ? isDown ? formatElapsed(nextSessionEffective.mins * 60000) : "0:00"
                          : overtime ? `+${formatElapsed(Math.abs(remainingMs))}` : formatElapsed(isDown ? remainingMs : elapsedMs)}
                      </div>
                    </div>
                    <RideTimerStatus running={running} wakeState={wakeState} voiceOn={voiceOn} onToggleVoice={toggleVoice} />
                    {running ? (
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <button onClick={finishRideTimer} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Finish ride</button>
                        <button onClick={cancelRideTimer} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => startRideTimer(nextSession, nextSessionEffective.mins)} style={{ ...navBtn, background: "rgb(102, 255, 0)", color: "#14171A" }}>▶ Start ride timer</button>
                    )}
                  </>
                );
              })()}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openCheckin(nextSession)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Log this session</button>
                <button onClick={() => downloadSessionICS(nextSessionEffective, nextSession.weekN, nextSession.weekTitle, programStart)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>+ Cal</button>
                <button onClick={() => quickSkip(nextSession)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>Skip</button>
              </div>
              </div>
            </div>
          )}

          <PreRideChecklist />

          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Week {currentWeekN} of {weeks.length}
            </div>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#F4F3EF" }}>
              {welcomeNote || `Nice and steady, ${profile.name || "rider"} — every session counts.`}
            </p>
            {lastWeekRideCount > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 14, color: "#1B8A82", fontWeight: 600 }}>
                Last week: {lastWeekRideCount} ride{lastWeekRideCount === 1 ? "" : "s"} · {formatMinutes(lastWeekMinutes)} ridden
              </p>
            )}

            <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0" }} />

            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Your progress</div>
            <div style={{ maxWidth: 260, margin: "0 auto" }}>
              <SpeedoGauge pct={completionPct} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div className="display" style={{ fontSize: 20, color: "#E8792B" }}>{formatMinutes(totalMinutesRidden)}</div>
                <div style={{ fontSize: 13, color: "#B9BDB8", marginTop: 2 }}>Time ridden</div>
              </div>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div className="display" style={{ fontSize: 20, color: "#E8792B" }}>{longestStreakWeeks}</div>
                <div style={{ fontSize: 13, color: "#B9BDB8", marginTop: 2 }}>Best streak (weeks)</div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Trophy case</div>
            {badges.length === 0 ? (
              <p style={{ margin: 0, fontSize: 15, color: "#868A85", lineHeight: 1.5 }}>Keep going — your first trophy unlocks after your first week done.</p>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {badges.map((b) => (
                  <div key={b} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ fontSize: 16 }}>🏆</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {programmeComplete ? (
            <div>
              <div style={{ background: "#AE5B20", borderRadius: 12, padding: "20px", textAlign: "center", color: "#fff", marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 18, marginBottom: 6 }}>YOU'VE GRADUATED{profile.name ? ", " + profile.name.toUpperCase() : ""}</div>
                <p style={{ margin: 0, fontSize: 16 }}>You're a regular rider now. That's the real win, and racing from here is entirely optional.</p>
                <button onClick={handleShareFinishCard} style={{ marginTop: 14, background: "#14171A", border: "none", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📸 Share your achievement</button>
              </div>
              {raceWeek ? null : nextRelevantRace ? (
                <RaceAdvert race={nextRelevantRace} funPrice={funPrice} />
              ) : (
                <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #2b2b2b" }}>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Fancy trying a race?</div>
                  <p style={{ fontSize: 15, color: "#B9BDB8", margin: "0 0 10px", lineHeight: 1.4 }}>There's a full MTB East fixture list you could dip into whenever you're ready. You don't need to compete to come along: plenty of riders spectate at a race first.</p>
                  <a href="/league" style={{ ...navBtn, marginBottom: 0, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>See the race calendar</a>
                </div>
              )}
              <MarshalNote card />
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => setStage("coachQA")} style={{ background: "none", border: "1px solid #E8792B", color: "#E8792B", borderRadius: 10, width: "100%", padding: "12px 0", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>Talk to a coach about racing</button>
              </div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", border: "1px solid #2b2b2b" }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Just want to keep riding?</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 15, color: "#F4F3EF", lineHeight: 1.7 }}>
                  <li>Keep logging rides whenever you get out — no plan required</li>
                  <li>Ask at your local bike shop or trail centre about routes and rides near you</li>
                  <li>Come and watch an MTB East race: spectators are welcome, and dogs on a lead too</li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              {upcoming.length > 0 && (
                <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Coming up</div>
                  {upcoming.map((s, i) => {
                    const eff = effectiveSession(s.session, adjustmentMins);
                    return (
                      <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < upcoming.length - 1 ? 10 : 0 }}>
                        <div className="display" style={{ fontSize: 14, color: "#E8792B", minWidth: 30 }}>{s.session.day}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{s.session.name}</div>
                          <div style={{ fontSize: 14, color: "#B9BDB8" }}>{eff.detail}</div>
                        </div>
                        <button onClick={() => quickSkip(s)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#868A85", borderRadius: 6, padding: "3px 8px", fontSize: 13, cursor: "pointer", height: "fit-content" }}>Skip</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <MonthCalendar
            weeks={weeks}
            sessionLog={sessionLog}
            adHocLog={adHocLog}
            programStart={programStart}
            totalRidesLogged={Object.keys(sessionLog).filter((k) => sessionLog[k] !== "Didn't get to it").length}
            totalSessions={allSessions.length}
            sessionDurations={sessionDurations}
            adjustmentMins={adjustmentMins}
          />

          <div style={{ background: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, padding: adHocFormOpen ? "14px" : "10px 12px", marginBottom: 16 }}>
            {!adHocFormOpen ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>Been out on your bike off-plan?</div>
                  <div style={{ fontSize: 14, color: "#B9BDB8" }}>Any ride counts — not just the scheduled ones</div>
                </div>
                <button onClick={openAdHocForm} style={{ background: "#0F5F59", border: "none", color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Log a ride</button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF", marginBottom: 10 }}>Log an extra ride</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 13, color: "#B9BDB8", marginBottom: 4 }}>Date</label>
                    <input type="date" value={adHocDate} max={dateKey(new Date())} onChange={(e) => setAdHocDate(e.target.value)}
                      style={{ width: "100%", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, padding: "8px", fontSize: 15, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 13, color: "#B9BDB8", marginBottom: 4 }}>Minutes</label>
                    <input type="number" inputMode="numeric" min="1" value={adHocMins} onChange={(e) => setAdHocMins(e.target.value)} placeholder="30"
                      style={{ width: "100%", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, padding: "8px", fontSize: 15, boxSizing: "border-box" }} />
                  </div>
                </div>
                <label style={{ display: "block", fontSize: 13, color: "#B9BDB8", marginBottom: 6 }}>How did it feel?</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {FEELINGS.map((f) => (
                    <button key={f} onClick={() => setAdHocFeeling(f)}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid " + (adHocFeeling === f ? "#0F5F59" : "#2b2b2b"), background: adHocFeeling === f ? "#0F5F59" : "#0d0d0d", color: adHocFeeling === f ? "#fff" : "#B9BDB8", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {f}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={submitAdHocRide} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Save ride</button>
                  <button onClick={cancelAdHocForm} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 14px", fontSize: 15, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {streakWeeks > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#AE5B20", borderRadius: 20, padding: "6px 12px" }}>
                <span style={{ fontSize: 15 }}>🔥</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{streakWeeks} week streak</span>
              </div>
            </div>
          )}

          <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 16, border: "2px solid #E8792B" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Get in touch</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => setStage("coachQA")} style={actionGridBtn}>💬 Contact a coach</button>
              <a href="/league" style={actionGridBtn}>📅 Race calendar</a>
              <button onClick={handleShare} style={actionGridBtn}>📤 Share this app</button>
              <a href="mailto:info@mtbeast.co.uk?subject=Sofa%20to%20Singletrack%20feedback" style={actionGridBtn}>💡 Feedback / bug</a>
            </div>

            <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Support MTB East</div>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>This app is free to use. If it's helped you, a donation helps us keep it that way.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <a href="https://buy.stripe.com/4gMbJ2cXM6jFd1c2uR43S00" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>£5</a>
              <a href="https://buy.stripe.com/bJeeVe3nc6jFbX81qN43S01" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>£10</a>
              <a href="https://buy.stripe.com/bJe9AUbTI6jFbX8b1n43S02" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>Choose amount</a>
            </div>
          </div>

          <CoachTips onContact={() => setStage("coachQA")} />
          <TipsAndAdvice />

          <FamilyPanel index={riderIndex} onSwitch={switchRider} onAdd={addRider} onRemove={removeRider} />
          <TextSizeControl value={textSize} onChange={changeTextSize} />
          <SettingsSection storageKey={keyForRider(riderIndex.active)} profile={profile} setProfile={setProfile} weeks={weeks} setWeeks={setWeeks} showToast={showToast} />
        </div>
      )}

      {stage === "checkin" && checkinTarget && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>HOW DID IT GO?</div>
          <h2 className="display" style={{ fontSize: 24, margin: "0 0 20px", color: "#E8792B" }}>{checkinTarget.session.name.toUpperCase()}</h2>
          {!(checkinTarget.key in sessionLog) && (
            <div>
              {FEELINGS.map((opt) => (
                <button key={opt} onClick={() => submitCheckin(opt)} style={choiceBtn}>{opt}</button>
              ))}
              <div style={{ height: 8 }} />
              <button onClick={() => submitCheckin("Didn't get to it")} style={{ ...choiceBtn, borderStyle: "dashed", color: "#B9BDB8" }}>
                Didn't get to it this week — that's okay
              </button>
            </div>
          )}
          {checkinTarget.key in sessionLog && (
            <div>
              <div style={{ background: "#14171A", borderRadius: 12, padding: "18px 20px", marginBottom: 20, color: "#F4F3EF" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Coach note</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, minHeight: 20 }}>{coachNote}</p>
              </div>

              {adjustWarning && (
                <div style={{ background: "#161616", border: "1px solid #E8792B", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
                  <p style={{ margin: 0, fontSize: 15, color: "#F4F3EF", lineHeight: 1.5 }}>
                    ⚠️ {adjustWarning === "down"
                      ? "We've trimmed 5 minutes off your sessions from here based on how that felt."
                      : "We've added 5 minutes to your sessions from here since that felt easier than expected."}
                    {" "}If you're finding you need this a lot, it's worth a quick chat with a coach rather than adjusting on your own.
                  </p>
                </div>
              )}

              <button onClick={backToDashboard} style={navBtn}>Back to home</button>
            </div>
          )}
        </div>
      )}

      {stage === "coachQA" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>CONTACT A COACH</div>
          <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px", color: "#E8792B" }}>WHAT WOULD HELP YOU MOST?</h2>
          <p style={{ fontSize: 15, color: "#B9BDB8", lineHeight: 1.5, marginBottom: 14 }}>
            This isn't live chat — it opens an email from your own address to the coaches, so they can reply directly and we can find out what riders actually want from us.
          </p>
          <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
            <p style={{ margin: 0, fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>
              This form is free to use. All coaching — 1-to-1 or an organised skills session — is a chargeable service. Tell us what you're after below and we'll get back to you with details.
            </p>
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: 10 }}>What would you like more support with?</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {QA_TOPICS.map((topic) => {
              const selected = qaTopics.includes(topic);
              return (
                <button key={topic} onClick={() => toggleQaTopic(topic)}
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid " + (selected ? "#E8792B" : "#2b2b2b"), background: selected ? "#E8792B" : "#161616", color: selected ? "#14171A" : "#F4F3EF", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                  {topic}
                </button>
              );
            })}
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Anything else you'd like to tell us? (optional)</label>
          <textarea value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} rows={4} placeholder="What's stopping you riding more, or what would make this easier?"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />

          <button onClick={sendQaFeedback} style={navBtn}>Send to the coaches</button>
          <button onClick={() => setStage("dashboard")} style={backBtn}>Back</button>
        </div>
      )}
      </div>
    </div>
  );
}

const navBtn = { width: "100%", padding: "14px 0", background: "#0F5F59", color: "#FFFFFF", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer", marginBottom: 10 };
const backBtn = { width: "100%", padding: "12px 0", background: "none", color: "#B9BDB8", border: "none", fontSize: 16, cursor: "pointer" };
const choiceBtn = { display: "block", width: "100%", textAlign: "left", padding: "14px 16px", marginBottom: 10, background: "#161616", border: "1.5px solid #2b2b2b", color: "#F4F3EF", borderRadius: 10, fontSize: 15, cursor: "pointer" };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #2b2b2b", background: "#161616", color: "#F4F3EF", fontSize: 16, marginBottom: 20, boxSizing: "border-box" };
const actionGridBtn = { display: "block", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" };
