import React, { useState, useEffect, useRef } from "react";
import COACH_SCENARIOS from "./data/coach-scenarios.json";
import {
  WEEKDAYS, sessionDate, weekNumberForDate, programmeStartFor, trimWeekOne, decideSync, mondayOf,
  PLAN_VERSION, EFFORT_WORDS, RACE_READY_TEXT, JUNIOR_INTRO, JUNIOR_BADGES,
  buildAdultPlan, buildContinuationPlan, buildRaceReadyPlan, buildJuniorPlan,
  planForRace, weeksUntil, weeksFromSaved, reassignDays, roleLabel, isJuniorSession,
  normaliseSaved, needsBlankFallback, newRiderId, normaliseRiderIndex, freshRiderIndex, shouldSplitMain, renameRider,
  isRemovedRider, markRemoved, confirmRemoved, dropRiders, withLastSaved, retryDelay, mergeLogs, syncStatusLine,
  changingLabel, sessionWords, recentlyLogged, DAY_NAMES, missedWeeks, shiftProgrammeStart, riderChoices, profileFromAccountRider,
} from "./lib/plan.js";
import { programmeIcs } from "./lib/ics.js";
import { printRows, planLabel } from "./lib/print.js";
import { FALLBACK_SITE_NAV, loadSiteNav, currentHref, renderSiteNav, updateSiteNavAccount, wireSiteNav } from "./lib/siteNav.js";
import "../games/site-nav.css";

/*
DESIGN PLAN, v5
Palette (from the MTB East mascot: black body, teal fur/claws, orange eyes/wordmark):
  --ink #14171A  --teal #1B8A82  --tealdk #0F5F59  --orange #E8792B  --paper #F4F3EF
Type: Fjalla One (display) / Inter (body)
Layout signature: contour/elevation profile line as the overall progress bar,
  active week marked with a simple enlarged orange dot (bike silhouette tried
  and dropped: it read as amateurish at this scale, the plain dot reads cleaner).
Changed in this version: riders choose how many days a week they can ride (2 or
  3) and which specific days during setup, rather than a fixed Tue/Thu/Sat.
  A direct "Skip" button sits on every session card for a same-tap skip with no
  detour through the check-in screen. The rides/streak indicator is redefined
  as consecutive weeks with genuine engagement (skips don't feed it, but a
  single skip doesn't zero it either) rather than a raw counter.

PWA build: coach notes come from the static ./data/coach-scenarios.json lookup
  table (no live AI call), and progress is persisted to localStorage: this is
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
const TIMER_SETTINGS_KEY = "sofaToSingletrack:timerSettings"; // "open" when the Timer settings fold was left open

// The plans themselves (the 12-week plan, the 8-week and 4-week Taster cuts of it, the two-day version, the Race ready
// block and Sofa to Singletrack Juniors) live in src/lib/plan.js, transcribed from the signed-off coaching plans
// document so the words riders read are the document's words. A programme saved before planVersion 2 keeps its saved
// weeks verbatim on load (its old session copy used a {mins} placeholder, which effectiveSession still fills).
// Add a `video: "<YouTube video ID>"` field to any session to show a thumbnail linking out to YouTube.

// The plan the welcome screen draws and a brand-new rider holds before setup: the 8-week plan on Tue/Thu/Sat.
const defaultPlan = () => buildAdultPlan({ lengthWeeks: 8, daysPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"], planType: "months" });

const SESSION_ICONS = {
  // The signed-off plans
  "Skills": "🎯", "Steady": "🚴", "The long one": "🌄", "Intervals": "⚡", "Race simulation": "🏁", "Course recon": "🗺️",
  "Easy spin": "🌱", "Kit check ride": "🎒", "Graduation ride": "🎓", "Skill then ride": "🎯",
  // Juniors
  "Badger stands up": "🦡", "Look where the squirrel went": "🌳", "Whistle stops": "📣", "Puddle Pilot": "💦",
  "Squirrel sprints": "🐿️", "Gear for the hill": "⚙️", "Bottle slalom": "🧴", "Follow the leader": "🚸",
  "Stick jumps": "🪵", "Badger's bumpy trail": "🌲", "Slope slider": "⛰️", "The snack stop": "🍌",
  "Lap the park": "🔁", "Start line": "🚦", "M-check with a grown-up": "🔧", "Graduation lap": "🎓",
  // Programmes saved before planVersion 2
  "Steady ride": "🚴", "Handling drills": "🎯", "Braking practice": "🛑", "Easy trail ride": "🌲", "Gear practice": "⚙️",
  "Hill intro": "⛰️", "Mixed terrain": "🪨", "Skills session": "🎯", "Rolling ride": "🌄", "Fuelling practice": "🍌",
  "Longer ride": "🕒", "Line choice": "🧭", "Start practice": "🚦", "Kit check": "🎒", "Rest": "😴",
};
const iconFor = (name) => SESSION_ICONS[name] || (name && name.startsWith("Skill then ride") ? SESSION_ICONS["Skill then ride"] : "🚵");

// The talk test. Keys and colours are unchanged from the old Easy / Moderate / Hard, so saved programmes map straight on.
const EFFORT_META = {
  low: { label: EFFORT_WORDS.low.word, color: "#1B8A82", level: 1 },
  med: { label: EFFORT_WORDS.med.word, color: "#E8792B", level: 2 },
  high: { label: EFFORT_WORDS.high.word, color: "#E24B4A", level: 3 },
};

function EffortDots({ effort, note }) {
  const meta = EFFORT_META[effort];
  if (!meta) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 3 }}>
        {[1, 2, 3].map((n) => (
          <span key={n} style={{ width: 6, height: 6, borderRadius: "50%", background: n <= meta.level ? meta.color : "#3a3a3a" }} />
        ))}
      </div>
      <span style={{ fontSize: 14, fontWeight: 600, color: meta.color }}>{meta.label}</span>
      {note && note !== meta.label && <span style={{ fontSize: 14, color: "#B9BDB8" }}>· {note}</span>}
    </div>
  );
}

// The talk test, as the rider reads it in Tips & advice.
function TalkTest() {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Effort: the talk test</div>
      <p style={{ margin: "0 0 8px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>Every session uses the same three words.</p>
      {Object.keys(EFFORT_WORDS).map((k) => (
        <div key={k} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
          <div style={{ minWidth: 92 }}><EffortDots effort={k} /></div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>{EFFORT_WORDS[k].feels}</div>
        </div>
      ))}
    </div>
  );
}

// Whether an effort note says the same as the session's detail, ignoring case and a trailing full stop: week 6's
// "Breathing in the middle 10 minutes" is also its whole detail, and it should not be shown twice.
const sameNote = (note, detail) => {
  const norm = (t) => String(t || "").trim().replace(/[.!]+$/, "").toLowerCase();
  return !!note && norm(note) === norm(detail);
};

// A session as the rider sees it. The minutes are the plan's minutes, always: the signed-off plan says the app never
// adds or takes away time (a rider who finds a week easy adds five minutes themselves). Old session copy used a
// {mins} placeholder, which is still filled here.
function effectiveSession(session) {
  const mins = session.mins;
  return {
    ...session,
    mins,
    detail: fillTemplate(session.detail || "", { mins }),
  };
}

// The "Done when:" lines of a session (a two-day "Skill then ride" session carries both of its rides' lines).
const doneWhenLines = (session) => (session && session.doneWhen ? String(session.doneWhen).split("\n").filter(Boolean) : []);

function DoneWhen({ session, compact }) {
  const lines = doneWhenLines(session);
  if (lines.length === 0) return null;
  return (
    <div style={{ background: "#0d0d0d", borderLeft: "3px solid #1B8A82", borderRadius: 6, padding: compact ? "8px 10px" : "10px 12px", margin: compact ? "0 0 10px" : "0 0 14px" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em" }}>Done when:</span>
      {lines.length === 1 ? (
        <span style={{ fontSize: 15, color: "#F4F3EF", lineHeight: 1.5 }}> {lines[0]}</span>
      ) : (
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 15, color: "#F4F3EF", lineHeight: 1.5 }}>
          {lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

// A Juniors game: where to play it, what the child does, what the grown-up does, and the badge.
function JuniorGame({ session }) {
  const row = (label, text) => (text ? (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 16, color: "#F4F3EF", lineHeight: 1.5 }}>{text}</div>
    </div>
  ) : null);
  return (
    <div style={{ marginBottom: 6 }}>
      {row("Where", session.where)}
      {row("What the child does", session.child)}
      {row("What the grown-up does", session.grownUp)}
      {session.badge && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 10, padding: "6px 10px", marginBottom: 10 }}>
          <span aria-hidden="true">🏅</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Badge: {session.badge}</span>
        </div>
      )}
    </div>
  );
}

const NUTRITION_TIPS = [
  "Eat a carb-rich meal two to three hours before a ride: porridge or toast with banana works well.",
  "Sip water throughout every ride, even short ones. Don't wait until you're thirsty.",
  "For rides over 60 minutes, bring a snack: a banana, dates, or a cereal bar.",
  "After a ride, eat something with carbs and protein within an hour: a wrap or a yoghurt is enough.",
  "On hot days, add a pinch of salt to your water bottle or use an electrolyte tablet.",
];

const BIKE_CARE_TIPS = [
  "Check your tyre pressure before every ride: soft tyres are the most common cause of a sluggish, hard-feeling ride.",
  "Quick brake check before you set off: squeeze each lever and make sure the wheel doesn't spin freely with it held.",
  "Keep your chain lightly oiled: a dry, squeaky chain wears out faster and shifts badly.",
  "After a wet or muddy ride, a quick wipe-down keeps grit out of your moving parts and extends your bike's life.",
  "Learn the M-check: a two-minute top-to-bottom safety check worth doing before any ride on unfamiliar ground.",
];

const TRAIL_ETIQUETTE_TIPS = [
  "Give way to walkers and horse riders: slow down, say a friendly hello, and pass wide where you can.",
  "Horses can spook easily, so slow right down well before you reach them and wait if the rider asks you to.",
  "Let other trail users know you're there: a simple \"hello\" or \"morning\" as you pass is great.",
  "Take your litter home with you. The trails only stay great if everyone does this.",
  "On narrow trails, riders heading uphill usually have priority, so be ready to pull over if you're descending.",
];

const PRE_RIDE_CHECKLIST = [
  "Helmet, fitted properly and buckled",
  "Water bottle or hydration pack",
  "Weather-appropriate layers you can add or remove",
  "Phone, charged, in case you need it",
  "Tyres: check the side of the tyre for the correct pressure range",
  "Let someone know roughly where you're riding and when you'll be back",
];

const BIKE_SETUP_STEPS = [
  { title: "Saddle height", body: "Sit on the saddle and put your heel (with shoes on) on the pedal at its lowest point: your leg should be almost straight, with just a slight bend. If that doesn't feel comfortable straight away, start a little lower and raise it gradually over a few rides." },
  { title: "Tyre pressure", body: "Squeeze the tyre between finger and thumb: it shouldn't feel rock hard or squash flat. Check the pressure range printed on the tyre's sidewall (usually in PSI) and use a pump with a gauge if you have one." },
  { title: "Brakes", body: "Squeeze each lever in turn. The wheel shouldn't spin freely once the brake is held on, and the lever shouldn't pull all the way back to the bar." },
  { title: "Helmet fit", body: "It should sit level on your head, not tipped back. The strap should be snug enough that only one or two fingers fit underneath, and the helmet shouldn't rock forwards, backwards, or side to side." },
];

// Terms are matched as plain-text substrings (case-insensitive) inside session
// copy, longest first, so multi-word terms win over any shorter term nested
// inside them. Keep entries specific enough to avoid matching unrelated words.
const GLOSSARY = {
  "chatting": EFFORT_WORDS.low.feels,
  "breathing": EFFORT_WORDS.med.feels,
  "can't talk": EFFORT_WORDS.high.feels,
  "ready position": "Standing on the pedals, level cranks, elbows bent, eyes up: the position the bike wants you in for anything bumpy.",
  "m-check": "A top-to-bottom safety check that traces an M over the bike: front wheel, bars and brakes, cranks and chain, saddle, back wheel. The Quick bike setup check in Tips & advice covers the main points.",
  "heavy feet light hands": "Weight through the pedals, a relaxed grip on the bars, so the bike can move under you.",
  "bridleway": "A path where walkers, horses and bikes are all allowed. Give way to walkers and horse riders.",
  "green or blue grade": "Trail centre grades: green is the easiest, blue the next step up. Both are fine for a first trail.",
  "clipping in": "Locking your shoe into a clip-in (clipless) pedal. If you're using flat pedals, this doesn't apply to you. Flat pedals are a fine way to start.",
  "figure-of-eights": "Riding a figure-of-eight pattern at slow speed: a simple way to build balance and low-speed bike control.",
  "figure-of-8s": "Riding a figure-of-eight pattern at slow speed: a simple way to build balance and low-speed bike control.",
  "singletrack": "A narrow off-road trail, usually wide enough for one rider at a time: the classic mountain-biking trail.",
  "cadence": "How fast you're pedalling (revolutions per minute). A smooth, comfortable spin is usually better than mashing hard on each stroke.",
  "zone 2": "A steady, conversational effort: you should be able to talk in short sentences without gasping for breath.",
  "conversational pace": "An effort easy enough that you could hold a conversation while riding, well short of flat out.",
  "recovery ride": "A short, deliberately easy ride, done to help your legs recover rather than to build fitness.",
  "corners": "Cornering well is about looking through the bend, leaning the bike as well as your body, and staying relaxed on the bars.",
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

// Hands the browser a file to save (a backup, a calendar file): a Blob behind a one-off link.
function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// sessionDate lives in src/lib/plan.js (tested): week 1 is the real calendar week the programme started in.

function downloadSessionICS(session, weekNum, weekTitle, programStart) {
  const start = sessionDate(programStart, weekNum, session.day);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sofa to Singletrack//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}-w${weekNum}-${session.day}@sofatosingletrack`,
    `DTSTAMP:${toICSDate(new Date())}`, `DTSTART:${toICSDate(start)}`, `DTEND:${toICSDate(end)}`,
    `SUMMARY:${session.name}, Week ${weekNum}: ${weekTitle}`,
    `DESCRIPTION:${(session.detail || session.child || "").replace(/,/g, "\\,")}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  downloadTextFile(ics, `sofa-to-singletrack-week${weekNum}-${session.day.toLowerCase()}.ics`, "text/calendar;charset=utf-8");
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
function RaceWeekCard({ entry, junior }) {
  const days = entry.daysAway;
  const coachNote = raceWeekNote(days, junior);
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

// The riders on the MTB east account (from /api/programme/me), one button each: "Set up Ollie". One already set up on
// this device (isTaken) is greyed out. `children` goes under the list: the "Someone else" button.
function AccountRiderPicker({ choices, isTaken, onPick, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Riders on your MTB east account</div>
      {choices.map((r) => {
        const taken = isTaken(r);
        return (
          <button key={r.id} onClick={() => onPick(r)} disabled={taken} style={{ ...choiceBtn, ...(taken ? { color: "#868A85", cursor: "default" } : {}) }}>
            {taken ? `${r.firstName}: already set up` : `Set up ${r.firstName}`}
          </button>
        );
      })}
      {children}
    </div>
  );
}

function FamilyPanel({ index, onSwitch, onAdd, onRemove, accountChoices = [], onAddFromAccount, bordered = true }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [someoneElse, setSomeoneElse] = useState(false);
  const showNameBox = accountChoices.length === 0 || someoneElse;
  const submit = () => {
    const err = onAdd(name);
    if (err) setError(err);
    else { setName(""); setError(""); setOpen(false); setSomeoneElse(false); }
  };
  const addFromAccount = (r) => {
    const err = onAddFromAccount(r);
    if (err) setError(err);
    else { setName(""); setError(""); setOpen(false); setSomeoneElse(false); }
  };
  const btn = { minHeight: 44, padding: "8px 14px", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8" };
  return (
    <div style={bordered ? { background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" } : undefined}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Riding with family?</div>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>
        Everyone gets their own plan and progress, all on this one phone and account. Add a child or a partner, then switch between riders at the top of the screen.
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5, color: "#B9BDB8" }}>
        On a second phone, sign in and your riders appear. To add someone new there, use Add a rider.
      </p>
      {index.riders.length > 1 && (
        <ul style={{ margin: "0 0 12px", padding: 0, listStyle: "none" }}>
          {index.riders.map((r) => (
            <li key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", fontSize: 15 }}>
              <span>{r.name || "Me"}{r.id === index.active ? " (riding now)" : ""}</span>
              <span style={{ display: "flex", gap: 8 }}>
                {r.id !== index.active && <button onClick={() => onSwitch(r.id)} style={btn}>Switch</button>}
                {r.id !== index.riders[0].id && <button onClick={() => onRemove(r.id)} style={{ ...btn, color: "#E24B4A", borderColor: "#5a2a2a" }}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} style={btn}>＋ Add a rider</button>
      ) : (
        <div>
          {accountChoices.length > 0 && (
            <AccountRiderPicker choices={accountChoices} isTaken={(r) => !!r.linkedTo} onPick={addFromAccount}>
              {!someoneElse && <button onClick={() => setSomeoneElse(true)} style={{ ...choiceBtn, borderStyle: "dashed", color: "#B9BDB8" }}>Someone else</button>}
            </AccountRiderPicker>
          )}
          {showNameBox && (
            <>
              <label htmlFor="family-name" style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Their first name</label>
              <input id="family-name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={40} style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "8px 12px", fontSize: 16, borderRadius: 8, border: "1px solid #2b2b2b", background: "#0d0d0d", color: "#F4F3EF", marginBottom: 8 }} />
            </>
          )}
          {error && <p role="alert" style={{ color: "#E24B4A", fontSize: 15, margin: "0 0 8px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            {showNameBox && <button onClick={submit} style={{ ...btn, background: "#0F5F59", border: "1px solid #0F5F59", color: "#ffffff" }}>Add and set up their plan</button>}
            <button onClick={() => { setOpen(false); setError(""); setSomeoneElse(false); }} style={btn}>Cancel</button>
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
// Signed in, it says what the account actually holds: saved just now, waiting for a connection, or signed out.
function AccountCard({ account, onHide, syncState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  if (!account) return null;
  const line = syncStatusLine(syncState, now);
  const signInLink = <a href="/account/login?next=/programme" style={{ color: "#E8792B", fontWeight: 700 }}>Sign in</a>;
  if (syncState && syncState.status === "signedOut") {
    return (
      <div role="status" style={{ fontSize: 16, color: "#E8792B", marginBottom: 14, lineHeight: 1.5 }}>
        {line.text} {signInLink}
      </div>
    );
  }
  if (account.signedIn) {
    const color = line.tone === "warn" ? "#E8792B" : "#B9BDB8";
    return (
      <div style={{ fontSize: 16, color: "#B9BDB8", marginBottom: 14, lineHeight: 1.5 }}>
        ✓ Signed in{account.name ? " as " + account.name : ""}. <span role="status" style={{ color }}>{line.text}</span>
      </div>
    );
  }
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #2b2b2b", position: "relative" }}>
      <button onClick={onHide} aria-label="Hide this" style={{ position: "absolute", top: 0, right: 0, width: 44, height: 44, background: "none", border: "none", color: "#868A85", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4, paddingRight: 36 }}>Keep your progress if you change phone</div>
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

// The health note, shown before a rider starts. Plain and specific rather than a line of small print. For a Junior it
// is addressed to the grown-up riding with them.
function GpNote({ forGrownUp }) {
  if (forGrownUp) {
    return (
      <div role="note" style={{ background: "#161616", border: "2px solid #E8792B", borderRadius: 12, padding: "16px 18px", marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 700, color: "#E8792B" }}>Read this as the grown-up riding with them.</p>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Check with the child's GP first if</div>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 16, lineHeight: 1.6 }}>
          <li>they have a health condition, or they're recovering from an injury or illness</li>
          <li>they take medication, or they've been told to be careful with exercise</li>
          <li>they haven't been active for a long time</li>
        </ul>
        <p style={{ margin: "0 0 8px", fontSize: 16, lineHeight: 1.5 }}>
          Stop and get medical advice if they feel chest pain, dizziness, unusual breathlessness or pain that doesn't ease.
        </p>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>
          Ride with them within sight the whole time, and the helmet goes on before the bike moves.
        </p>
      </div>
    );
  }
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
// beep: false on a Junior session, which has voice cues but no countdown beep.
function RideTimerStatus({ running, wakeState, voiceOn, onToggleVoice, beep = true }) {
  const wakeSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  const box = { borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 15, lineHeight: 1.5 };
  const warn = (running && (wakeState === "unsupported" || wakeState === "blocked")) || (!running && !wakeSupported);
  const alerts = beep ? "the beep and voice cues" : "the voice cues";
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
          The timer still keeps the right time, but {alerts} can't play while the screen is locked. To avoid it, set your phone's Auto-Lock (iPhone) or Screen timeout (Android) to a longer time before you start, and keep the app open in front of you.
        </div>
      ) : running && wakeState === "on" ? (
        <p style={{ ...box, background: "#0d0d0d", color: "#B9BDB8", margin: "0 0 12px" }}>
          ✓ The app is asking your phone to keep the screen on. If your screen locks anyway (some phones ignore this), the timer stays right, but {alerts} pause until you unlock it.
        </p>
      ) : !running ? (
        <p style={{ ...box, background: "#0d0d0d", color: "#B9BDB8", margin: "0 0 12px" }}>
          When you start, the app asks your phone to keep the screen on. Some phones ignore this; if the screen locks, the timer stays right, but {alerts} pause until you unlock it. Turn your volume up.{beep ? "" : " No beep at the end on a Junior session: the voice says when the time is up."}
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
  { q: "I have not ridden a bike in years. Is this really for me?", a: "Yes. The programme is designed for people starting from zero, returning after a long break, or rebuilding confidence. You begin gently and progress in small, manageable steps." },
  { q: "Should I check with my doctor before I start?", a: "If you have a health condition, are pregnant, are recovering from an injury or illness, take medication, or have not been active for a long time, yes: speak to your GP first. Whoever you are, stop and get medical advice if you feel chest pain, dizziness, unusual breathlessness or pain that does not ease. If you are under 16, ask a parent or guardian to read this and to ride with you where needed." },
  { q: "What if I cannot ride very far yet?", a: "That is exactly where you are meant to start. Early rides may be short, with plenty of recovery and walking breaks if needed. There is no expectation to keep up with experienced riders." },
  { q: "Do I need to be fit before I begin?", a: "No. The goal is to help you become fitter over time. You only need to be comfortable starting at your own level and taking things gradually." },
  { q: "What does \"singletrack\" mean?", a: "Singletrack is a narrow off-road trail, usually wide enough for one rider at a time. It can be a smooth woodland path, dirt, gravel, roots, or gentle twists. You will build towards it rather than being sent straight onto technical trails." },
  { q: "Is mountain biking dangerous?", a: "Like any activity, it has risks, but you can reduce them a lot by learning gradually, wearing a helmet, checking your bike, choosing suitable trails, and knowing that it is always fine to slow down or walk a section." },
  { q: "What if I am nervous about falling off?", a: "That is very normal. The programme builds your confidence step by step: braking, balance, cornering, getting on and off the bike, and choosing a safe line. Walking a tricky bit is always a smart option, never a failure." },
  { q: "Do I have to ride down steep hills or over jumps?", a: "No. You choose your own challenge level. There are no jumps, drops, or steep descents required to complete the programme. Many riders enjoy mountain biking for fitness, fresh air, and social rides without wanting technical features." },
  { q: "What equipment do I need to get started?", a: "A safe bike, a properly fitted helmet, comfortable clothing, water, and something to repair a puncture are the basics. You do not need expensive shoes, clothing, suspension, or race equipment to begin." },
  { q: "What type of mountain bike should I buy?", a: "Do not rush into buying one. If you decide to, a comfortable hardtail mountain bike from a reputable shop is often a great first choice." },
  { q: "Can I do the programme on an e-bike?", a: "Yes, provided it is legal and suitable for the terrain where you ride. An e-bike can make hills and longer rides feel more approachable while still building skills, confidence, and fitness. Sessions are based on time and effort, so an e-bike fits the plan as it is." },
  { q: "What if I need to stop, repeat a week, or miss a few sessions?", a: "That is completely fine. Life happens. You can repeat sessions, take extra rest, or resume when you are ready. Progress is not ruined by a missed week." },
  { q: "How much time will I need each week?", a: "The programme fits around real life: two or three short rides a week, on the days you choose. The early rides are 20 to 30 minutes, and the longest ride of the whole plan is an hour." },
  { q: "Where can I safely ride?", a: "You do not need mountains on your doorstep. Start with quiet cycle paths, parks, bridleways, forest roads, towpaths, and easy local trails where cycling is permitted. Look out for signs at the entrance, give way to walkers and horse riders, leave gates as you find them, and take your litter home." },
  { q: "What if I do not have anyone to ride with?", a: "You can do the whole programme on your own. Riding with others is optional. When you feel ready, an MTB East race day is a friendly place to meet other riders, and you can come and watch first." },
  { q: "Do I have to race at the end?", a: "No. Racing is one possible destination, not the purpose of the programme. Your finish line might be feeling fitter, exploring local trails, riding with friends, commuting, or simply enjoying being outside." },
  { q: "What is an MTB \"fun race,\" and can a beginner enter one?", a: "A fun race is an informal event where the emphasis is on completing the course and enjoying the day. Riders of mixed experience. You can aim for one when it feels exciting, or come along to watch first." },
  { q: "Can I attend an event just to watch and see what it is like?", a: "Yes. Watching is a brilliant, low-pressure way to learn what mountain biking events feel like, meet riders, ask questions, and decide whether you would enjoy taking part later. You do not need to earn your place in the community." },
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
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "#868A85", lineHeight: 1.4 }}>Fuelling, bike care, trail etiquette, the talk test, bike setup, and common questions</p>
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

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Found a week easy?</div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>Add five minutes to each ride yourself. The app never adds it for you.</p>

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <TalkTest />

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <BikeSetupCheck bordered={false} />

          <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

          <FAQSection bordered={false} />
        </div>
      )}
    </div>
  );
}

// The whole programme on paper: name, plan and start date, then one table per week. Black on white, A4 portrait; the
// @media print rules in the app's <style> hide the site header and the two buttons. printRows (src/lib/print.js) decides
// what goes in each row; on a narrow screen each row stacks into a card so nothing scrolls sideways.
function PrintView({ profile, weeks, programStart, junior, onBack }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const tables = printRows(weeks, programStart, junior);
  const started = programStart.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const cols = junior
    ? [["day", "Day"], ["dateText", "Date"], ["name", "Game"], ["mins", "Minutes"], ["where", "Where"], ["child", "What the child does"], ["grownUp", "What the grown-up does"], ["badge", "Badge"]]
    : [["day", "Day"], ["dateText", "Date"], ["name", "Session"], ["mins", "Minutes"], ["effort", "Effort"], ["doneWhen", "Done when"]];
  const cell = (row, key) => {
    if (key === "effort") return row.effortNote && row.effortNote !== row.effort ? `${row.effort} (${row.effortNote})` : row.effort;
    if (key === "doneWhen") return row.doneWhen.length > 1 ? <ul style={{ margin: 0, paddingLeft: 16 }}>{row.doneWhen.map((d, i) => <li key={i}>{d}</li>)}</ul> : row.doneWhen[0] || "";
    return row[key];
  };
  const btn = { minHeight: 44, padding: "8px 18px", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: "pointer", border: "1px solid #14171A", background: "#14171A", color: "#ffffff" };
  return (
    <div className="print-view" style={{ background: "#ffffff", color: "#000000", minHeight: "100vh", padding: "24px 16px 48px", fontFamily: "'Source Sans 3', sans-serif" }}>
      <style>{`
        .print-view table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 0 0 18px; }
        .print-view th, .print-view td { border: 1px solid #000; padding: 4px 6px; text-align: left; vertical-align: top; }
        .print-view th { background: #eee; font-weight: 700; }
        .print-view h2 { font-family: 'Oswald', sans-serif; font-size: 18px; margin: 18px 0 2px; page-break-after: avoid; }
        .print-view tr { page-break-inside: avoid; }
        @media screen and (max-width: 600px) {
          .print-view thead { display: none; }
          .print-view table, .print-view tbody, .print-view tr, .print-view td { display: block; width: 100%; box-sizing: border-box; }
          .print-view tr { border: 1px solid #000; margin-bottom: 8px; }
          .print-view td { border: none; border-bottom: 1px solid #ddd; padding: 6px 8px; }
          .print-view td:last-child { border-bottom: none; }
          .print-view td::before { content: attr(data-label); display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #444; }
        }
      `}</style>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => window.print()} style={btn}>Print</button>
          <button onClick={onBack} style={{ ...btn, background: "#ffffff", color: "#14171A" }}>Back</button>
        </div>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: "0.08em", color: "#444" }}>AN MTB EAST PROGRAMME</div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, margin: "0 0 6px" }}>Sofa to Singletrack{profile.name ? `: ${profile.name}` : ""}</h1>
        <p style={{ margin: "0 0 4px", fontSize: 14 }}><strong>{planLabel(profile, weeks)}</strong>, {profile.sessionsPerWeek} sessions a week on {profile.chosenDays.join(", ")}.</p>
        <p style={{ margin: "0 0 8px", fontSize: 14 }}>Started {started}.</p>
        <p style={{ margin: "0 0 6px", fontSize: 12, color: "#444" }}>
          {junior ? "Every session is a game, with a grown-up alongside the whole time. Helmet on before the bike moves." : `Effort is the talk test. ${EFFORT_WORDS.low.word}: ${EFFORT_WORDS.low.feels} ${EFFORT_WORDS.med.word}: ${EFFORT_WORDS.med.feels} ${EFFORT_WORDS.high.word}: ${EFFORT_WORDS.high.feels}`}
        </p>
        {tables.map((t) => (
          <div key={t.n}>
            <h2>Week {t.n} of {tables.length}{t.title ? `: ${t.title}` : ""}</h2>
            {t.focus && <p style={{ margin: "0 0 6px", fontSize: 12, color: "#444" }}>{t.focus}</p>}
            <table>
              <thead><tr>{cols.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
              <tbody>
                {t.rows.map((row) => (
                  <tr key={row.key}>{cols.map(([k, label]) => <td key={k} data-label={label}>{cell(row, k)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p style={{ fontSize: 11, color: "#444", margin: "12px 0 0" }}>Printed {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. General guidance from the MTB east crew, not medical advice: check with your GP if unsure.</p>
      </div>
    </div>
  );
}

// One fold for everything a rider sets up once: text size, training days, the plan on paper or in a calendar, the family riders, and backups.
function SettingsSection({ profile, setProfile, weeks, setWeeks, showToast, storageKey, onRestoreBackup, textSize, onTextSize, family, onCalendarFile, onPrint, programmeComplete }) {
  const [expanded, setExpanded] = useState(false);
  const [editingDays, setEditingDays] = useState(false);
  const [draftDays, setDraftDays] = useState(profile.chosenDays);
  const [pendingImport, setPendingImport] = useState(null);
  const fileInputRef = useRef(null);
  // The copy set aside when the account's copy replaced this device's (storageKey + ":backup"), if there is one.
  const [backup, setBackup] = useState(null);
  const readBackup = () => {
    try {
      const raw = localStorage.getItem(storageKey + ":backup");
      const safe = raw ? normaliseSaved(raw, blankSaved("")) : null;
      setBackup(safe ? { raw, sessions: Object.keys(safe.sessionLog).length + safe.adHocLog.length, savedAt: safe.savedAt } : null);
    } catch (e) { setBackup(null); }
  };
  useEffect(readBackup, [storageKey, expanded]);

  const downloadJson = (text) => {
    downloadTextFile(text, `sofa-to-singletrack-backup-${dateKey(new Date())}.json`, "application/json");
    showToast("Backup downloaded.");
  };

  const restoreBackup = () => {
    if (!backup) return;
    const safe = normaliseSaved(backup.raw, blankSaved(""));
    if (!safe || !safe.weeks) { showToast("That earlier copy has no programme in it, so it can't be restored."); return; }
    if (!window.confirm("Replace your current progress with the earlier copy from this device?")) return;
    onRestoreBackup({ ...safe, savedAt: Date.now() });
  };

  const discardBackup = () => {
    if (!window.confirm("Throw away the earlier copy? This can't be undone.")) return;
    try { localStorage.removeItem(storageKey + ":backup"); } catch (e) { /* storage unavailable */ }
    setBackup(null);
  };

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
    // The programme itself is kept (and so is its log): only the days move.
    setWeeks(reassignDays(weeks, draftDays));
    setEditingDays(false);
    showToast("Training days updated.");
  };

  // The file holds the live copy, plus the earlier copy under `backup` if one is kept (ignored when restoring).
  const exportProgress = () => {
    let text = "{}";
    try {
      const raw = localStorage.getItem(storageKey);
      const live = raw ? JSON.parse(raw) : {};
      const backupRaw = localStorage.getItem(storageKey + ":backup");
      let parsedBackup = null;
      if (backupRaw) { try { parsedBackup = JSON.parse(backupRaw); } catch (e) { parsedBackup = null; } }
      text = JSON.stringify(parsedBackup ? { ...live, backup: parsedBackup } : live);
    } catch (e) { /* storage unavailable or unreadable: download what we have */ }
    downloadJson(text);
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
        showToast("Couldn't read that file. Is it a backup exported from this app?");
      }
    };
    reader.readAsText(file);
  };

  // A restored file is written in its tidied shape with savedAt = now, so a deliberate restore wins the next sync.
  // The file's own `backup` field (an earlier copy) is dropped by normaliseSaved.
  const confirmImport = () => {
    if (!pendingImport) return;
    const safe = normaliseSaved(pendingImport.text, blankSaved(""));
    if (!safe || !safe.weeks) { showToast("That backup has no programme in it, so it wasn't restored."); setPendingImport(null); return; }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ ...safe, savedAt: Date.now() }));
    } catch (e) {
      showToast("This browser wouldn't save the backup. Try again, or sign in so it saves to your account.");
      return;
    }
    window.location.reload();
  };

  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Settings</span>
        <span style={{ color: "#E8792B", fontSize: 16 }} aria-hidden="true">{expanded ? "–" : "+"}</span>
      </button>
      {!expanded && (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "#868A85", lineHeight: 1.4 }}>Text size, training days, calendar and print, family riders and backups</p>
      )}
      {expanded && (
        <div style={{ marginTop: 14 }}>
          {onTextSize && <TextSizeControl value={textSize} onChange={onTextSize} />}
          {onTextSize && <div style={{ borderTop: "1px solid #2b2b2b", margin: "4px 0 14px" }} />}

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Training days</div>
          {!editingDays ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 15, color: "#F4F3EF" }}>{profile.chosenDays.join(", ")}</p>
              <button onClick={startEditDays} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Change days</button>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "#B9BDB8" }}>Pick exactly {profile.sessionsPerWeek}. Tap to select or deselect.</p>
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

          <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Your plan</div>
          <p style={{ margin: "0 0 10px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>
            {programmeComplete ? "Every session is logged, so there is nothing left to put in your calendar. You can still print the plan." : "Put every session still to do in your phone's calendar as an all-day event, or print the whole plan to stick on the fridge."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!programmeComplete && <button onClick={onCalendarFile} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Add all my sessions to my calendar (.ics)</button>}
            <button onClick={onPrint} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Print my plan</button>
          </div>

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

          {backup && (
            <div style={{ marginTop: 12, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 8, padding: "12px 14px" }}>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "#F4F3EF", lineHeight: 1.4 }}>
                An earlier copy from this device is kept: {backup.sessions} session{backup.sessions === 1 ? "" : "s"} logged, saved {backup.savedAt ? new Date(backup.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "on an unknown date"}.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={restoreBackup} style={{ background: "#AE5B20", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Restore</button>
                <button onClick={() => downloadJson(backup.raw)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Download</button>
                <button onClick={discardBackup} style={{ background: "none", border: "1px solid #5a2a2a", color: "#E24B4A", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Discard</button>
              </div>
            </div>
          )}

          {pendingImport && (
            <div style={{ marginTop: 12, background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 8, padding: "12px 14px" }}>
              <p style={{ margin: "0 0 10px", fontSize: 14, color: "#F4F3EF", lineHeight: 1.4 }}>
                This backup is for <strong>{pendingImport.name}</strong>, with {pendingImport.ridesLogged} session{pendingImport.ridesLogged === 1 ? "" : "s"} logged. Restoring it will replace your current progress on this device. This can't be undone.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={confirmImport} style={{ background: "#AE5B20", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Replace my progress</button>
                <button onClick={() => setPendingImport(null)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {family && (
            <>
              <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />
              {family}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const GENERIC_COACH_FALLBACK = "Nice work getting out there. Keep it up and see you at the next session.";

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

// The beep needs an AudioContext that was created or resumed inside a tap: iPhones keep one made any other way silent.
// startRideTimer makes it in the Start tap and hands it here; a context made here as a fallback may be silent on iOS.
function getAudioContext(existing) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = existing && existing.state !== "closed" ? existing : new Ctx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch (e) {
    return null;
  }
}

function playTimerAlertSound(existingCtx) {
  try {
    const ctx = getAudioContext(existingCtx);
    if (!ctx) return;
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
    // Web Audio unavailable: vibration/visual alert still fire
  }
}

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// The coach's race-week message for how far away the race is: the week before (taper), the day before, and race morning.
// For a Junior rider the message is written to the grown-up.
function raceWeekNote(daysAway, junior) {
  const rw = (junior ? COACH_SCENARIOS.junior && COACH_SCENARIOS.junior.raceWeek : COACH_SCENARIOS.raceWeek) || {};
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

function getCoachNote(target, feeling, junior) {
  if (junior) {
    const j = (COACH_SCENARIOS.junior && COACH_SCENARIOS.junior.checkins) || {};
    const key = feeling === SKIPPED ? JUNIOR_SKIPPED_LABEL : feeling;
    return j[key] || j["Fine"] || GENERIC_COACH_FALLBACK;
  }
  const phase = target.weekN <= 3 ? "early" : "later";
  const phaseScenarios = COACH_SCENARIOS.checkins && COACH_SCENARIOS.checkins[phase];
  if (!phaseScenarios) return GENERIC_COACH_FALLBACK;
  return phaseScenarios[feeling] || phaseScenarios["About right"] || GENERIC_COACH_FALLBACK;
}

// What each kind of adult session is for, one line, keyed by the session names in src/lib/plan.js. A two-day week's
// "Skill then ride: ..." session matches by its prefix. Juniors sessions explain themselves on the card.
const MICRO_EXPLAINERS = {
  "Skills": "One thing to practise, somewhere easy, so the trail stops surprising you. It looks basic. It is the foundation.",
  "Steady": "An easy ride at Chatting pace. This is where most of the fitness comes from, so there is no need to push it.",
  "The long one": "The longest ride of the week, a little longer each time. Time on the bike, not speed.",
  "Intervals": "Short hard bursts with easy riding between them. They build the fitness that copes with a surge, and they are over quickly.",
  "Race simulation": "A dress rehearsal at the effort you would hold in a race, so race day is a feeling you already know.",
  "Course recon": "Riding the course slowly first means race day is about riding it, not working out where it goes.",
  "Easy spin": "Legs turning, nothing more. Rest is part of the plan.",
  "Kit check ride": "A short ride to find anything that rubs, squeaks or leaks before it matters.",
  "Graduation ride": "The ride the whole plan was for. Your pace, your terms.",
  "Skill then ride": "The week's skill for ten minutes, then the long ride, so nothing is dropped on two days a week.",
};
const explainerFor = (session) => {
  if (!session || isJuniorSession(session)) return null;
  const name = session.name || "";
  return MICRO_EXPLAINERS[name] || (name.startsWith("Skill then ride") ? MICRO_EXPLAINERS["Skill then ride"] : null);
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
    <svg viewBox="0 0 240 148" role="img" aria-label={`${clamped}% of the programme done`} style={{ display: "block", width: "100%", height: "auto" }}>
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
      <text x={cx} y={cy + 20} textAnchor="middle" fontSize="11" fill="#B9BDB8" fontWeight="600">of the programme done</text>
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

// weeksUntil and planForRace live in src/lib/plan.js (tested): under four weeks away is Race ready, otherwise the
// longest of the 12-, 8- and 4-week plans that fits.

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

// weekNumberForDate lives in src/lib/plan.js (tested).

// "Tue 20 Oct" for a date, as read out for a calendar day and shown on the Next up card.
const shortDate = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function MonthCalendar({ weeks, sessionLog, adHocLog, programStart, totalRidesLogged, totalSessions, sessionDurations }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [previewKey, setPreviewKey] = useState(null);

  const sessionsByDate = {};
  weeks.forEach((w) => {
    w.sessions.forEach((s, i) => {
      const key = `${w.n}-${i}`;
      const feeling = sessionLog[key];
      const status = feeling === undefined ? "upcoming" : feeling === "Didn't get to it" ? "skipped" : "done";
      const d = sessionDate(programStart, w.n, s.day);
      const eff = status === "upcoming" ? effectiveSession(s) : s;
      sessionsByDate[dateKey(d)] = { status, name: s.name, role: roleLabel(s) || s.name, detail: eff.detail || s.child || "", mins: sessionDurations[key] ?? eff.mins };
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

  const dotColor = { done: "#1B8A82", skipped: "#868A85", upcoming: "#E8792B" };
  const minOffset = -1;
  const maxOffset = Math.ceil(weeks.length / 4) + 1;

  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your calendar</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>{totalRidesLogged}/{totalSessions} sessions logged</div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 8px" }}>
        <button type="button" onClick={() => setMonthOffset((m) => Math.max(minOffset, m - 1))} disabled={monthOffset <= minOffset} aria-label="Previous month" style={monthNavBtn}>‹</button>
        <div className="display" style={{ fontSize: 15, color: "#F4F3EF" }} aria-live="polite">{monthLabel}</div>
        <button type="button" onClick={() => setMonthOffset((m) => Math.min(maxOffset, m + 1))} disabled={monthOffset >= maxOffset} aria-label="Next month" style={monthNavBtn}>›</button>
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
              // "Tue 20 Oct, Ride A, done" (or upcoming / skipped), plus "extra ride" for an off-plan ride that day.
              const labelParts = [shortDate(d)];
              if (info) labelParts.push(info.role, info.status);
              if (hasAdHoc) labelParts.push(adHocForDay.length === 1 ? "extra ride" : `${adHocForDay.length} extra rides`);
              if (isToday) labelParts.push("today");
              return (
                <div key={ci} style={{ flex: 1, position: "relative" }}>
                  <button
                    type="button"
                    aria-label={labelParts.join(", ")}
                    aria-expanded={hasPreviewContent ? isPreviewing : undefined}
                    disabled={!hasPreviewContent}
                    onMouseEnter={() => hasPreviewContent && setPreviewKey(k)}
                    onMouseLeave={() => setPreviewKey((cur) => (cur === k ? null : cur))}
                    onFocus={() => hasPreviewContent && setPreviewKey(k)}
                    onBlur={() => setPreviewKey((cur) => (cur === k ? null : cur))}
                    onClick={() => hasPreviewContent && setPreviewKey((cur) => (cur === k ? null : k))}
                    style={{ width: "100%", minHeight: 44, background: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: "3px 0", borderRadius: 6, border: isToday ? "1px solid #E8792B" : "1px solid transparent", cursor: hasPreviewContent ? "pointer" : "default", font: "inherit" }}
                  >
                    <span style={{ fontSize: 14, color: hasPreviewContent ? "#F4F3EF" : "#868A85" }}>{d.getDate()}</span>
                    <span style={{ display: "flex", gap: 2, height: 5 }} aria-hidden="true">
                      {info && (
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: info.status === "skipped" ? "transparent" : dotColor[info.status], border: info.status === "skipped" ? "1px solid #868A85" : "none" }} />
                      )}
                      {hasAdHoc && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#FFD400" }} />}
                    </span>
                  </button>
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
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#FFD400" }}>Extra ride{r.mins ? `, ${r.mins}m` : ""}</div>
                          {r.feeling && <div style={{ fontSize: 13, color: "#B9BDB8", lineHeight: 1.4 }}>{r.feeling}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ width: 34, textAlign: "center", fontSize: 13, fontWeight: 600, color: rowMins > 0 ? "#1B8A82" : "#868A85" }} aria-label={rowMins > 0 ? `${rowMins} minutes this week` : "No minutes this week"}>
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

const monthNavBtn = { background: "none", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, width: 44, height: 44, minHeight: 44, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 };

const FEELINGS = ["Easier than expected", "About right", "Tougher than expected", "Had to stop early"];
// A skipped session is logged under this key whatever the button said, so streaks, badges and the calendar agree.
const SKIPPED = "Didn't get to it";
// Juniors: the grown-up answers about the child.
const JUNIOR_FEELINGS = ["Loved it", "Fine", "Found it hard", "Had to stop early"];
const JUNIOR_SKIPPED_LABEL = "Didn't get to it this week";

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
// A device that already holds progress under the original key keeps "main" for it (nothing is migrated); a fresh device
// mints a random id for its first rider, so two people's "main" copies can never collide on one account.
function loadRiderIndex() {
  try {
    const parsed = normaliseRiderIndex(JSON.parse(localStorage.getItem(RIDERS_KEY) || "null"));
    if (parsed) return parsed;
  } catch (e) { /* fall through to a fresh index */ }
  let hasLegacy = false;
  try { hasLegacy = !!localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage unavailable */ }
  const fresh = freshRiderIndex(hasLegacy);
  try { localStorage.setItem(RIDERS_KEY, JSON.stringify(fresh)); } catch (e) { /* storage unavailable: the id lives for this session only */ }
  return fresh;
}

// A complete, empty snapshot for a new rider, so switching to them clears every trace of the previous rider.
// ageBand is "under14" (Sofa to Singletrack Juniors, with a grown-up) or "14plus" (the adult plans); junior follows it.
// raceReady marks a 2- or 3-week Race ready block; delayWeeks holds a race plan's start back so it ends in race week.
// riderProfileId links the programme to a rider on the MTB east account (a uuid from /api/programme/me), or null.
const BLANK_PROFILE = { name: "", riderProfileId: null, ageBand: null, junior: false, experience: "none", planType: null, raceId: null, months: null, sessionsPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"], raceReady: false, delayWeeks: 0 };
function blankSaved(name) {
  return {
    profile: { ...BLANK_PROFILE, name: name || "" },
    weeks: defaultPlan(), planVersion: PLAN_VERSION,
    sessionLog: {}, clearedLog: {}, badges: [], adHocLog: [], notifAsked: false, notifEnabled: false, reminderTime: "17:30", lastFeeling: null,
    programStart: new Date().toISOString(), sessionDurations: {}, activeTimer: null, stage: "onboarding",
    lastActivityAt: null, comebackNudgeShown: false, raceOfferShown: false, savedAt: 0, continuedFrom: null,
  };
}

export default function SofaToSingletrack() {
  const [stage, setStage] = useState("welcome");
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState(BLANK_PROFILE);
  const [step, setStep] = useState(0);
  const [weeks, setWeeks] = useState(defaultPlan);
  const [planVersion, setPlanVersion] = useState(PLAN_VERSION); // which plan tables built `weeks`; saved with them
  const audioCtxRef = useRef(null); // made in the Start tap so the countdown beep is not silent on iPhone
  const [coachNote, setCoachNote] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const [programStart, setProgramStart] = useState(new Date());
  // When this programme is a deliberate carry-on (weeks 8 to 11, start again, the full plan after the race), the
  // finished programme's programStart (ISO string): the sync rule then knows an empty log is not a stray new plan.
  const [continuedFrom, setContinuedFrom] = useState(null);
  const [bikeCheckDone, setBikeCheckDone] = useState(false);
  const [fitnessConfirmed, setFitnessConfirmed] = useState(false);
  const [badges, setBadges] = useState([]);
  const [sessionLog, setSessionLog] = useState({}); // "wN-i" -> feeling
  // "wN-i" -> when (ms) a logged session was cleared, or a skip undone, so the account merge never brings it back.
  const [clearedLog, setClearedLog] = useState({});
  const [lastFeeling, setLastFeeling] = useState(null);
  const [checkinTarget, setCheckinTarget] = useState(null);
  const [cancelAsk, setCancelAsk] = useState(false); // the timer's Cancel asks before throwing the time away
  const [timerSettingsOpen, setTimerSettingsOpen] = useState(() => {
    try { return localStorage.getItem(TIMER_SETTINGS_KEY) === "open"; } catch (e) { return false; }
  });
  // "Keep my dates" on the missed-weeks card: the week number it was pressed in, so the card stays away until another week passes.
  const [keepDatesWeek, setKeepDatesWeek] = useState(null);
  const [adHocLog, setAdHocLog] = useState([]); // [{ week, at }]
  const [sessionDurations, setSessionDurations] = useState({}); // "wN-i" -> actual mins, from the ride timer
  const [activeTimer, setActiveTimer] = useState(null); // { key, startedAt, mode, targetMins } while a ride timer is running
  const [timerMode, setTimerMode] = useState("up"); // "up" | "down", chosen before starting
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
  const [toast, setToast] = useState(null); // { text, action?: { label, onClick } }
  const [toastType, setToastType] = useState("info"); // "info" | "trophy" | "undo"
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
  const [account, setAccount] = useState(null); // null until we know; { signedIn, name, riders } from the website
  const [nameBoxOpen, setNameBoxOpen] = useState(false); // setup's name step: "Someone else" shows the text box under the account's riders
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
  // Set when a localStorage write throws: this browser is not keeping progress, and the dashboard says so.
  const [storageBroken, setStorageBroken] = useState(false);
  const writeItem = (key, value) => {
    try { localStorage.setItem(key, value); return true; } catch (e) { setStorageBroken(true); return false; }
  };
  const readItem = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const [riderIndex, setRiderIndex] = useState(loadRiderIndex);
  const riderIndexRef = useRef(riderIndex);
  riderIndexRef.current = riderIndex;
  const persistIndex = (next) => {
    riderIndexRef.current = next;
    setRiderIndex(next);
    writeItem(RIDERS_KEY, JSON.stringify(next));
  };
  const firstSaveRef = useRef(true);
  // What the account knows: "connecting" until the first answer, then saved / pending / offline / signedOut / removed.
  const [syncState, setSyncState] = useState({ status: "connecting", at: 0 });
  const accountRef = useRef(null);
  // The sync machinery lives on refs so the window listeners (online, focus, visibility) always call the latest version.
  const syncRef = useRef({ inFlight: false, lastGetAt: 0, pending: null, attempt: 0, timer: null, stopped: new Set() });
  const actionsRef = useRef({});
  const syncReadyRef = useRef(false);
  syncReadyRef.current = syncReady;
  // The log fields as they are right now, for merging an account answer that arrives after a render.
  const stateRef = useRef({});
  stateRef.current = { sessionLog, sessionDurations, clearedLog, badges, adHocLog, programStart };
  const restoringRef = useRef(false); // a Restore is being written and pushed: nothing else may touch the live copy until the reload
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

  // Puts a saved snapshot (from this device, a backup or the account) into the app. Anything that is not already a blank
  // snapshot goes through normaliseSaved first, so a half-written or hand-edited copy can never leave a field the wrong shape.
  const applySaved = (input) => {
    const saved = normaliseSaved(input, blankSaved("")) || blankSaved("");
    modifiedAtRef.current = saved.savedAt || 0;
    suppressBumpUntilRef.current = Date.now() + 1000;
    setShowComebackNudge(false);
    setShowRaceOffer(false);
    setTimerAlerted(false);
    setCheckinTarget(null);
    setCoachNote("");
    setWelcomeNote("");
    // The confirm step's ticks belong to one rider's one sign-up, never to the next rider or the next programme.
    setBikeCheckDone(false);
    setFitnessConfirmed(false);
    if (saved.profile) setProfile({ ...BLANK_PROFILE, ...saved.profile, junior: !!saved.profile.junior });
    // A saved programme's weeks are kept exactly as saved, whatever version built them. A programme saved before
    // planVersion 2 used session copy that no longer exists in the plan tables, so rebuilding it would scramble its
    // log; its old Easy / Moderate / Hard efforts show as Chatting / Breathing / Can't talk through the same keys.
    // A copy still in setup may have no weeks yet: it gets the default plan rather than the previous rider's weeks.
    const savedWeeks = weeksFromSaved(saved);
    setWeeks(savedWeeks || defaultPlan());
    setPlanVersion(saved.planVersion);
    setSessionLog(saved.sessionLog);
    setBadges(saved.badges);
    setAdHocLog(saved.adHocLog);
    setNotifAsked(saved.notifAsked);
    setNotifEnabled(saved.notifEnabled);
    setReminderTime(saved.reminderTime);
    setLastFeeling(saved.lastFeeling);
    if (saved.programStart) setProgramStart(new Date(saved.programStart));
    setContinuedFrom(saved.continuedFrom);
    setSessionDurations(saved.sessionDurations);
    setClearedLog(saved.clearedLog);
    setActiveTimer(saved.activeTimer);
    setCancelAsk(false);
    setKeepDatesWeek(null);
    // A reload mid check-in lands back on the dashboard, never on the welcome screen: before this, leaving the stage
    // at its initial "welcome" meant the next save wrote that back, and the rider reopened the app to the intro page
    // as if their programme had gone.
    if (saved.stage) setStage(saved.stage === "checkin" || saved.stage === "print" ? "dashboard" : saved.stage);
    setLastActivityAt(typeof saved.lastActivityAt === "number" ? saved.lastActivityAt : null);

    // One-time "the bike misses you" nudge: never repeats once shown, so
    // it doesn't turn into a nag. Fires the first time someone reopens the
    // app 14+ days after their last logged ride (or since starting, if
    // they never got one logged at all).
    const alreadyShown = !!saved.comebackNudgeShown;
    const baseline = saved.lastActivityAt || (saved.programStart ? new Date(saved.programStart).getTime() : null);
    if (!alreadyShown && baseline && saved.stage === "dashboard" && Date.now() - baseline >= 14 * 24 * 60 * 60 * 1000) {
      setShowComebackNudge(true);
    }
    setComebackNudgeShown(alreadyShown || (!!baseline && saved.stage === "dashboard" && Date.now() - baseline >= 14 * 24 * 60 * 60 * 1000));

    // One-time "fancy a race?" nudge: fires once someone is 2+ weeks into
    // their programme, then never again regardless of how long they stick around.
    const raceAlreadyShown = !!saved.raceOfferShown;
    const startMs = saved.programStart ? new Date(saved.programStart).getTime() : null;
    const raceEligible = !!startMs && saved.stage === "dashboard" && Date.now() - startMs >= 14 * 24 * 60 * 60 * 1000;
    if (!raceAlreadyShown && raceEligible) setShowRaceOffer(true);
    setRaceOfferShown(raceAlreadyShown || raceEligible);
  };

  // Loads what this device holds for a rider. A copy that claims to be on the dashboard but has no programme in it
  // starts blank, and the raw text is kept under ":backup" (unless a backup is already there) so nothing is lost.
  const applyStored = (key, raw, fallbackName) => {
    const blank = blankSaved(fallbackName || "");
    const safe = raw ? normaliseSaved(raw, blank) : null;
    if (!safe) { applySaved(blank); return; }
    if (needsBlankFallback(safe)) {
      if (!readItem(key + ":backup")) writeItem(key + ":backup", typeof raw === "string" ? raw : JSON.stringify(raw));
      applySaved(blank);
      return;
    }
    applySaved(safe);
  };

  useEffect(() => {
    const raw = readItem(keyForRider(riderIndex.active));
    if (raw) applyStored(keyForRider(riderIndex.active), raw, "");
    setLoaded(true);
  }, []);

  const buildPayload = () => ({ profile, weeks, planVersion, sessionLog, clearedLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart: programStart.toISOString(), continuedFrom, savedAt: modifiedAtRef.current, sessionDurations, activeTimer, stage, lastActivityAt, comebackNudgeShown, raceOfferShown });

  useEffect(() => {
    if (!loaded) return;
    if (firstSaveRef.current) firstSaveRef.current = false;
    else if (Date.now() > suppressBumpUntilRef.current) modifiedAtRef.current = Date.now();
    if (restoringRef.current) return;
    // A failed write (private browsing, quota) sets storageBroken, and the dashboard banner says so.
    writeItem(keyForRider(riderIndex.active), JSON.stringify(buildPayload()));
  }, [loaded, riderIndex.active, profile, weeks, planVersion, sessionLog, clearedLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart, sessionDurations, activeTimer, stage, lastActivityAt, comebackNudgeShown, raceOfferShown]);

  // The rider's name on the switcher follows what they type in setup, and the index remembers which account rider
  // (if any) each programme is set up for, so Add a rider can grey out the ones already here.
  useEffect(() => {
    if (!loaded) return;
    const cur = riderIndex.riders.find((r) => r.id === riderIndex.active);
    if (!cur) return;
    const name = profile.name || cur.name;
    const linked = profile.riderProfileId || null;
    if (cur.name === name && (cur.riderProfileId || null) === linked) return;
    persistIndex({ ...riderIndex, riders: riderIndex.riders.map((r) => {
      if (r.id !== riderIndex.active) return r;
      const { riderProfileId: _dropped, ...rest } = r;
      return { ...rest, name, ...(linked ? { riderProfileId: linked } : {}) };
    }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, profile.name, profile.riderProfileId, riderIndex.active]);

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

  // One sign-in with the main website: is this visitor signed in to their MTB east account, and who are its riders?
  // { signedIn, firstName?, riders?: [{ id, firstName, ageBand, junior }] }; an older server sends `name` and no riders.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/programme/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setAccount(json && json.signedIn ? { signedIn: true, name: json.firstName || json.name || "", riders: Array.isArray(json.riders) ? json.riders : [] } : { signedIn: false, name: "", riders: [] }); })
      .catch(() => { if (!cancelled) setAccount({ signedIn: false, name: "", riders: [] }); });
    return () => { cancelled = true; };
  }, []);

  // Signed in and entered in a race? Show where and when, the forecast, and the timings. A programme linked to one of
  // the account's riders asks for that rider's next race, so a child's dashboard shows their race, not a parent's.
  useEffect(() => {
    if (!account || !account.signedIn) { setRaceWeek(null); return; }
    let cancelled = false;
    const forRider = profile.riderProfileId ? "?rider=" + encodeURIComponent(profile.riderProfileId) : "";
    fetch("/api/programme/race-week" + forRider, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (!cancelled) setRaceWeek(json && json.entry ? json.entry : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [account, profile.riderProfileId]);

  // Keeps a ref of the account so the sync machinery (which runs from window events) sees the latest answer.
  useEffect(() => { accountRef.current = account; }, [account]);

  const signedIn = () => !!(accountRef.current && accountRef.current.signedIn);

  // The website said the session has gone: stop saving, say so on the account card, keep working from this device.
  const handleSignedOut = () => {
    setAccount({ signedIn: false, name: "", riders: [] });
    setSyncReady(false);
    setSyncState({ status: "signedOut", at: Date.now() });
  };

  const recordSaved = (id, at) => {
    persistIndex(withLastSaved(riderIndexRef.current, id, at));
    if (id === riderIndexRef.current.active) setSyncState({ status: "saved", at });
  };

  // The account's merged copy of a rider folded back into this device: only the logs, badges and off-plan rides move
  // (never the stage, weeks, programme start or where the rider is on screen). For the active rider that is a state
  // update with the savedAt bump suppressed; for anyone else it is their stored copy.
  const mergeIntoRider = (id, remoteData) => {
    const remote = normaliseSaved(remoteData, blankSaved(""));
    if (!remote) return;
    if (id === riderIndexRef.current.active) {
      if (restoringRef.current) return;
      const current = stateRef.current;
      if (remote.programStart && current.programStart.toISOString() !== remote.programStart) return; // a different programme: left to the next full reconcile
      const merged = mergeLogs({ ...current, savedAt: modifiedAtRef.current }, remote);
      if (!merged.changed) return;
      suppressBumpUntilRef.current = Date.now() + 1000;
      setSessionLog(merged.sessionLog);
      setSessionDurations(merged.sessionDurations);
      setClearedLog(merged.clearedLog);
      setBadges(merged.badges);
      setAdHocLog(merged.adHocLog);
      return;
    }
    const key = keyForRider(id);
    const local = normaliseSaved(readItem(key), blankSaved(""));
    if (!local) { writeItem(key, JSON.stringify(remote)); return; }
    if (local.programStart !== remote.programStart) return;
    const merged = mergeLogs(local, remote);
    if (merged.changed) writeItem(key, JSON.stringify({ ...local, sessionLog: merged.sessionLog, sessionDurations: merged.sessionDurations, clearedLog: merged.clearedLog, badges: merged.badges, adHocLog: merged.adHocLog }));
  };

  // One rider's copy up to the account. Resolves to { ok, status }; the caller decides whether to retry.
  const pushRider = async (id, name, payload) => {
    if (isRemovedRider(riderIndexRef.current, id) || syncRef.current.stopped.has(id)) return { ok: false, status: 410 };
    let res;
    try {
      res = await fetch("/api/programme/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ riderId: id, name: name || "", data: payload }) });
    } catch (e) {
      return { ok: false, status: 0 };
    }
    if (res.status === 401) { handleSignedOut(); return { ok: false, status: 401 }; }
    if (res.status === 410) {
      // Removed on another device: nothing more goes up for this rider. The next GET tidies the device's copy.
      syncRef.current.stopped.add(id);
      showToast("This rider was removed on another device");
      if (id === riderIndexRef.current.active) setSyncState({ status: "removed", at: Date.now() });
      return { ok: false, status: 410 };
    }
    if (!res.ok) return { ok: false, status: res.status };
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (json && json.merged && json.data) mergeIntoRider(id, json.data);
    recordSaved(id, Date.now());
    return { ok: true, status: 200 };
  };

  // The debounced push of the active rider, with the retry ladder: anything that fails for a reason other than
  // "signed out" or "removed" stays pending and goes again on online/focus or after 10 s, 30 s, 2 min, then 10 min.
  const attemptPush = async () => {
    const sync = syncRef.current;
    clearTimeout(sync.timer);
    sync.timer = null;
    const job = sync.pending;
    if (!job || !signedIn()) return;
    sync.pending = null;
    const result = await pushRider(job.id, job.name, job.payload);
    if (result.ok) { sync.attempt = 0; return; }
    if (result.status === 401 || result.status === 410) return;
    if (result.status === 400 || result.status === 413) {
      // Too many riders or too big: trying the same copy again will not help. The card says it is not saved.
      if (job.id === riderIndexRef.current.active) setSyncState({ status: "pending", at: Date.now() });
      return;
    }
    if (!sync.pending) sync.pending = job; // nothing newer queued meanwhile: keep this one for the retry
    if (job.id === riderIndexRef.current.active) setSyncState({ status: "pending", at: Date.now() });
    sync.timer = setTimeout(() => actionsRef.current.attemptPush(), retryDelay(sync.attempt));
    sync.attempt += 1;
  };

  const queuePush = (id, name, payload, delayMs) => {
    const sync = syncRef.current;
    sync.pending = { id, name, payload };
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => actionsRef.current.attemptPush(), delayMs);
  };

  // Straight away, no debounce: used when a rider is switched away from, added, or restored from a backup.
  const pushNow = (id, name, payload) => {
    const sync = syncRef.current;
    if (sync.pending && sync.pending.id === id) { sync.pending = null; clearTimeout(sync.timer); sync.timer = null; }
    if (!signedIn()) return Promise.resolve({ ok: false, status: 0 });
    return pushRider(id, name, payload).then((result) => {
      if (!result.ok && result.status !== 401 && result.status !== 410) {
        sync.pending = sync.pending || { id, name, payload };
        if (id === riderIndexRef.current.active) setSyncState({ status: "pending", at: Date.now() });
        if (!sync.timer) sync.timer = setTimeout(() => actionsRef.current.attemptPush(), retryDelay(sync.attempt));
      }
      return result;
    });
  };

  // A rider removed on this device whose DELETE did not reach the account: tried again when the connection is back.
  const retryDeletes = async () => {
    const index = riderIndexRef.current;
    if (!signedIn()) return;
    for (const r of (index.removed || []).filter((x) => x.pendingDelete)) {
      try {
        const res = await fetch("/api/programme/progress", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ riderId: r.id }) });
        if (res.status === 401) { handleSignedOut(); return; }
        if (res.ok || res.status === 404 || res.status === 410) persistIndex(confirmRemoved(riderIndexRef.current, [r.id]));
      } catch (e) { /* still offline: next time */ }
    }
  };

  // Reconciles this device with the account, rider by rider. The first run (initial) may replace the active rider's
  // copy outright, which is why it happens before the rider has done anything; a later run (a tablet left open while
  // the phone logged a ride) only folds merged logs into the active rider and never moves them off their screen.
  const reconcile = async ({ initial }) => {
    const sync = syncRef.current;
    if (!signedIn() || sync.inFlight) return;
    sync.inFlight = true;
    try {
      let res;
      try {
        res = await fetch("/api/programme/progress", { credentials: "same-origin" });
      } catch (e) {
        setSyncState((s) => (s.status === "connecting" || s.status === "saved" ? { status: "offline", at: Date.now() } : s));
        return;
      }
      if (res.status === 401) { handleSignedOut(); return; }
      if (!res.ok) { setSyncState((s) => (s.status === "connecting" || s.status === "saved" ? { status: "offline", at: Date.now() } : s)); return; }
      let json;
      try { json = await res.json(); } catch (e) { setSyncState((s) => (s.status === "connecting" ? { status: "offline", at: Date.now() } : s)); return; }
      const remote = Array.isArray(json && json.riders) ? json.riders : [];
      const removedIds = Array.isArray(json && json.removed) ? json.removed.filter((x) => typeof x === "string") : [];
      const blank = blankSaved("");
      let index = riderIndexRef.current;
      let appliedActive = false;
      let addedOthers = false;

      // 1. Riders removed on another device go from this one too.
      if (removedIds.length > 0) {
        index = confirmRemoved(index, removedIds);
        const { index: next, dropped, activeChanged } = dropRiders(index, removedIds);
        if (dropped.length > 0) {
          for (const r of dropped) { try { localStorage.removeItem(keyForRider(r.id)); localStorage.removeItem(keyForRider(r.id) + ":backup"); } catch (e) { /* storage unavailable */ } }
          index = next;
          if (activeChanged) { loadRider(index.active, (index.riders.find((r) => r.id === index.active) || {}).name); setStep(0); }
          persistIndex(index);
          showToast(`${dropped.map((r) => r.name || "A rider").join(", ")} ${dropped.length === 1 ? "was" : "were"} removed on another device`);
        }
      }

      // 2. Two different people both saved as "main" (this device's first rider and the account's): the device copy
      //    gets its own id and goes up as a new rider; the account's "main" joins this device as another rider.
      if (initial) {
        const serverMain = remote.find((r) => r.riderId === "main");
        const localMainRaw = readItem(STORAGE_KEY);
        const localMain = localMainRaw ? normaliseSaved(localMainRaw, blank) : null;
        const serverMainName = serverMain ? serverMain.name || (serverMain.data && serverMain.data.profile && serverMain.data.profile.name) : "";
        if (serverMain && localMain && shouldSplitMain(index, localMain.profile.name, serverMainName)) {
          const newId = newRiderId();
          if (writeItem(keyForRider(newId), localMainRaw)) {
            const backupRaw = readItem(STORAGE_KEY + ":backup");
            if (backupRaw) writeItem(keyForRider(newId) + ":backup", backupRaw);
            try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_KEY + ":backup"); } catch (e) { /* storage unavailable */ }
            index = renameRider(index, "main", newId);
            persistIndex(index);
            await pushRider(newId, localMain.profile.name, localMain);
          }
        }
      }

      // 3. Every rider the account holds.
      let deleteLater = false;
      for (const r of remote) {
        if (!r || typeof r.riderId !== "string") continue;
        if (isRemovedRider(index, r.riderId)) {
          // Removed on this device (while signed out, say) but still on the account: the DELETE goes after this pass.
          index = markRemoved(index, r.riderId, (index.removed.find((x) => x.id === r.riderId) || {}).at || Date.now(), true);
          deleteLater = true;
          continue;
        }
        const key = keyForRider(r.riderId);
        const localRaw = readItem(key);
        const local = localRaw ? normaliseSaved(localRaw, blank) : null;
        const server = normaliseSaved(r.data, blank);
        const isActive = r.riderId === index.active;
        if (!index.riders.some((x) => x.id === r.riderId)) {
          const linked = server && server.profile.riderProfileId;
          index = { ...index, riders: [...index.riders, { id: r.riderId, name: r.name || (server && server.profile.name) || "", ...(linked ? { riderProfileId: linked } : {}) }] };
        }
        if (isActive && !initial) {
          // A re-check never moves the rider off their screen: logs only.
          if (server) mergeIntoRider(r.riderId, server);
          continue;
        }
        const decision = decideSync(local, server);
        if (decision.action === "useAccount" && server) {
          if (decision.keepBackup && localRaw) writeItem(key + ":backup", localRaw);
          if (isActive) {
            if (needsBlankFallback(server)) { if (!readItem(key + ":backup")) writeItem(key + ":backup", JSON.stringify(r.data)); }
            else { applySaved(server); appliedActive = true; }
          } else {
            writeItem(key, JSON.stringify(server));
            addedOthers = true;
          }
        } else if (decision.action === "saveToAccount" && local) {
          await pushRider(r.riderId, r.name || local.profile.name || "", local);
        }
      }

      // 4. Riders this device has that the account does not.
      const remoteIds = new Set(remote.map((r) => r && r.riderId));
      for (const rider of index.riders) {
        if (remoteIds.has(rider.id) || isRemovedRider(index, rider.id)) continue;
        const local = normaliseSaved(readItem(keyForRider(rider.id)), blank);
        if (!local) continue;
        if (decideSync(local, null).action === "saveToAccount") await pushRider(rider.id, rider.name || local.profile.name || "", local);
      }
      // Save times recorded by pushes during this pass live on the ref's index, not this local copy: keep them.
      const latest = riderIndexRef.current;
      index = { ...index, riders: index.riders.map((r) => { const cur = latest.riders.find((x) => x.id === r.id); return cur && cur.lastSavedAt ? { ...r, lastSavedAt: cur.lastSavedAt } : r; }) };
      persistIndex(index);
      sync.lastGetAt = Date.now();
      setSyncReady(true);
      if (deleteLater) actionsRef.current.retryDeletes();
      // In step with the account as of now; a push still waiting keeps its own status and goes next.
      if (sync.pending) actionsRef.current.attemptPush();
      else setSyncState((s) => (s.status === "removed" ? s : { status: "saved", at: Date.now() }));
      if (initial && appliedActive) showToast("Your saved progress has been loaded");
      else if (initial && addedOthers) showToast("Your family's saved progress has been loaded");
    } finally {
      sync.inFlight = false;
    }
  };

  // The latest versions of the sync actions, for the window listeners and timers.
  actionsRef.current = { reconcile, attemptPush, retryDeletes };

  // On sign-in, reconcile this device with the account's saved progress.
  useEffect(() => {
    if (!loaded || !account || !account.signedIn) return;
    actionsRef.current.reconcile({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, account]);

  // Coming back online or back to the app: finish anything that failed, and re-check the account if it has been a
  // while (so a tablet left open picks up the phone's rides).
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      const sync = syncRef.current;
      if (!signedIn()) return;
      if (!syncReadyRef.current) actionsRef.current.reconcile({ initial: true });
      else if (Date.now() - sync.lastGetAt > 60000) actionsRef.current.reconcile({ initial: false });
      if (sync.pending) actionsRef.current.attemptPush();
      actionsRef.current.retryDeletes();
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  // While signed in, keep the account copy of the current rider up to date (a couple of seconds after the last change).
  useEffect(() => {
    if (!loaded || !syncReady || !account || !account.signedIn) return;
    queuePush(riderIndex.active, profile.name, buildPayload(), 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, syncReady, account, riderIndex.active, profile, weeks, planVersion, sessionLog, clearedLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart, sessionDurations, activeTimer, stage, lastActivityAt, comebackNudgeShown, raceOfferShown]);

  // A signed-in rider doesn't have to type their name again.
  useEffect(() => {
    if (account && account.signedIn && account.name && !profile.name && riderIndex.riders.length === 1 && (stage === "welcome" || stage === "onboarding")) {
      setProfile((p) => (p.name ? p : { ...p, name: account.name }));
    }
  }, [account, stage, profile.name]);

  useEffect(() => { if (stage === "onboarding" && nameRef.current) nameRef.current.focus(); }, [stage, step]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toastType === "trophy" ? 4200 : toastType === "undo" ? 6000 : 3000); return () => clearTimeout(t); }, [toast, toastType]);
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
      // No countdown beep on a Junior session: on a 15-minute ride it sounds like a telling-off. The voice cues stay.
      if (!activeTimer.junior) playTimerAlertSound(audioCtxRef.current);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    }
  }, [nowTick, activeTimer, timerAlerted]);

  const junior = !!profile.junior;

  // A Junior session's timer starts as a countdown from the session's minutes (15 to 35); there is no beep at the end.
  // An adult's starts counting up. Set on every rider change, so a Junior's countdown never sticks to the next adult.
  useEffect(() => { setTimerMode(junior ? "down" : "up"); }, [junior, riderIndex.active]);

  const allSessions = weeks.flatMap((w) =>
    w.sessions.map((s, i) => ({ key: `${w.n}-${i}`, weekN: w.n, idx: i, session: s, weekTitle: w.title }))
  );
  const unlogged = allSessions.filter((s) => !(s.key in sessionLog));
  const nextSession = unlogged[0] || null;
  const nextSessionEffective = nextSession ? effectiveSession(nextSession.session) : null;
  const upcoming = unlogged.slice(1, 3);
  const justLogged = recentlyLogged(allSessions, sessionLog, 2); // newest first, for the Change links
  const currentWeekN = nextSession ? nextSession.weekN : weeks[weeks.length - 1].n;
  const currentWeek = weeks.find((w) => w.n === currentWeekN) || null;
  const programmeComplete = unlogged.length === 0;
  // The next round on the calendar, for the Juniors graduation card ("a fun race is next if they want it").
  const nextRace = races.find((r) => new Date(r.date + "T00:00:00") >= new Date(new Date().setHours(0, 0, 0, 0))) || null;
  const programEndDate = new Date(programStart.getTime() + weeks.length * 7 * 24 * 60 * 60 * 1000);
  const nextRelevantRace = races.find((r) => new Date(r.date) > programEndDate && new Date(r.date) > new Date());

  // A week counts as "engaged" if it has at least one real (non-skip) session log,
  // or an ad-hoc ride logged during it. Streak = consecutive engaged weeks counting
  // back from the current week: a single skip doesn't break it, but a week with
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

  // Recap of the week just gone, shown on the dashboard, only surfaced when
  // there's something to report, never to call out an empty week.
  const lastWeekN = currentWeekN - 1;
  const lastWeekStructured = allSessions.filter((s) => s.weekN === lastWeekN && sessionLog[s.key] && sessionLog[s.key] !== "Didn't get to it");
  const lastWeekAdHoc = adHocLog.filter((r) => r.week === lastWeekN);
  const lastWeekRideCount = lastWeekStructured.length + lastWeekAdHoc.length;
  const lastWeekMinutes = lastWeekStructured.reduce((sum, s) => sum + (sessionDurations[s.key] ?? s.session.mins), 0) + lastWeekAdHoc.reduce((sum, r) => sum + (r.mins || 0), 0);

  // Longest run of consecutive engaged weeks across the whole programme so far,
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
  // is available synchronously to the caller: setState updaters aren't guaranteed
  // to run before the next line of code, only before the next render.
  const checkAllBadges = (log, adHoc) => {
    const candidates = [];
    if (junior) {
      // Juniors: each game ticked by the grown-up collects its own named badge, nothing else.
      allSessions.forEach((s) => { if (log[s.key] && log[s.key] !== SKIPPED && s.session.badge) candidates.push(s.session.badge); });
      const justAwardedJ = candidates.filter((label) => !badges.includes(label));
      if (justAwardedJ.length > 0) setBadges((prev) => [...prev, ...justAwardedJ.filter((l) => !prev.includes(l))]);
      return justAwardedJ;
    }
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

  // The onboarding steps, by name. Juniors is shorter: no experience, plan type or timescale (fixed at 8 weeks, 2 sessions).
  const stepList = profile.junior
    ? ["name", "age", "days", "confirm"]
    : ["name", "age", "experience", "daysPerWeek", "days", "planType", profile.planType === "race" ? "race" : "months", "confirm"];
  const stepName = stepList[Math.min(step, stepList.length - 1)];
  const goToStep = (name) => setStep(Math.max(0, stepList.indexOf(name)));

  // Settles the age band on a profile and moves on to the step after age (index 2 in both step lists).
  const settleAge = (base, ageBand, isJunior) => {
    const p = { ...base, ageBand, junior: isJunior, sessionsPerWeek: isJunior ? 2 : base.sessionsPerWeek, chosenDays: isJunior ? ["Sat", "Sun"] : base.chosenDays };
    // A Junior has no race plan: clear anything an earlier adult pass through setup left behind, so no Race ready
    // block, delayed start or race-week note can follow the child onto the dashboard.
    if (isJunior) Object.assign(p, { planType: null, raceId: null, raceReady: false, raceReadyWeeks: null, delayWeeks: 0, months: null, continuation: null });
    setProfile(p);
    setWeeks(isJunior ? buildJuniorPlan({ chosenDays: p.chosenDays }) : defaultPlan());
    setStep(2);
  };
  const chooseAge = (ageBand) => settleAge(profile, ageBand, ageBand === "under14");

  // "Set up Ollie" from the account's riders: the name, the link and the age band come from the account, so the age
  // step is skipped. `base` is the profile to build on (the current one in setup, a blank one for a rider just added).
  const startFromAccountRider = (base, r) => {
    const patch = profileFromAccountRider(r);
    settleAge({ ...base, ...patch }, patch.ageBand, patch.junior);
  };
  const accountChoices = account && account.signedIn ? riderChoices(account.riders, riderIndex.riders) : [];

  const chooseRace = (race) => {
    const choice = planForRace(weeksUntil(race.date));
    if (choice.kind === "raceReady") {
      const p = { ...profile, planType: "race", raceId: race.id, raceReady: true, raceReadyWeeks: choice.weeksToRace, delayWeeks: 0, months: null };
      setProfile(p);
      setWeeks(buildRaceReadyPlan({ weeksToRace: choice.weeksToRace, daysPerWeek: p.sessionsPerWeek, chosenDays: p.chosenDays }));
    } else {
      const p = { ...profile, planType: "race", raceId: race.id, raceReady: false, raceReadyWeeks: null, delayWeeks: choice.delayWeeks, months: null };
      setProfile(p);
      setWeeks(buildAdultPlan({ lengthWeeks: choice.lengthWeeks, daysPerWeek: p.sessionsPerWeek, chosenDays: p.chosenDays, planType: "race" }));
    }
    setStep(step + 1);
  };

  const chooseMonths = (months) => {
    const p = { ...profile, planType: "months", months, raceId: null, raceReady: false, raceReadyWeeks: null, delayWeeks: 0 };
    setProfile(p);
    setWeeks(buildAdultPlan({ lengthWeeks: months * 4, daysPerWeek: p.sessionsPerWeek, chosenDays: p.chosenDays, planType: "months" }));
    setStep(step + 1);
  };

  // Puts a freshly built set of weeks in place as the rider's programme, starting now (or on a later Monday).
  const beginProgramme = (builtWeeks, { delayWeeks = 0, carryOn = false } = {}) => {
    // A carry-on records which programme it follows (the one that is ending now), so an empty log on a device that
    // has not pushed yet is not mistaken for a stray new plan when it meets the account's finished copy.
    const previousStart = programStart.toISOString();
    // The programme starts now (not when the app was first opened), and week 1 is this calendar week: the rides whose
    // day has already gone are dropped from it. If none are left this week, it starts next Monday instead. A race plan
    // whose race is further off than the plan is long starts on a later Monday, so its last week is race week.
    let start;
    if (delayWeeks > 0) {
      start = mondayOf(new Date());
      start.setDate(start.getDate() + 7 * delayWeeks);
    } else {
      start = programmeStartFor(new Date(), builtWeeks[0]);
    }
    const plan = trimWeekOne(builtWeeks, start);
    setProgramStart(start);
    setContinuedFrom(carryOn ? previousStart : null);
    setWeeks(plan);
    setPlanVersion(PLAN_VERSION);
    setSessionLog({});
    setSessionDurations({});
    setClearedLog({});
    setAdHocLog([]);
    setActiveTimer(null);
    setTimerAlerted(false);
    setCancelAsk(false);
    setKeepDatesWeek(null);
    setLastFeeling(null);
    setCheckinTarget(null);
    setCoachNote("");
    setStage("dashboard");
    const first = plan[0].sessions[0];
    const welcomeTemplate = (profile.junior && COACH_SCENARIOS.junior && COACH_SCENARIOS.junior.welcome)
      || COACH_SCENARIOS.welcome || "Welcome aboard, {name}. Your first session, {sessionName}, is a gentle one on purpose.";
    setWelcomeNote(fillTemplate(welcomeTemplate, { name: profile.name || "rider", sessionName: first.name }));
    return plan;
  };

  // Everyone starts the plan as written, whatever they said about experience: the signed-off plan is one schedule
  // and the app never adds minutes to it. A rider who finds a week easy adds five minutes themselves (Tips & advice).
  const startProgramme = () => {
    beginProgramme(weeks, { delayWeeks: profile.delayWeeks || 0 });
  };

  // The 8-week finisher carries on with weeks 8 to 11 of the full plan; the Taster finisher with the 8-week plan from
  // week 5. Badges and the "I did it" record stay; the new programme starts with a clean log.
  const carryOn = ({ lengthWeeks, fromWeek, toWeek }) => {
    // Always the no-race version: any race the rider picked has been and gone by the time this is offered.
    const more = buildContinuationPlan({ lengthWeeks, fromWeek, toWeek, daysPerWeek: profile.sessionsPerWeek, chosenDays: profile.chosenDays, planType: "months" });
    setProfile({ ...profile, planType: "months", raceId: null, raceReady: false, raceReadyWeeks: null, delayWeeks: 0, months: null, continuation: { lengthWeeks, fromWeek, toWeek } });
    beginProgramme(more, { carryOn: true });
    showToast(`Carrying on with weeks ${fromWeek} to ${toWeek}.`);
  };

  // After a Race ready block: "the full plan starts after the race". The 12-week plan, no race, on the same days.
  const startFullPlan = () => {
    const full = buildAdultPlan({ lengthWeeks: 12, daysPerWeek: profile.sessionsPerWeek, chosenDays: profile.chosenDays, planType: "months" });
    setProfile({ ...profile, planType: "months", raceId: null, raceReady: false, raceReadyWeeks: null, delayWeeks: 0, months: 3, continuation: null });
    beginProgramme(full, { carryOn: true });
    showToast("The full 12-week plan starts now.");
  };

  // What to offer a rider who has finished: the Taster's next step is the 8-week plan from week 5; the 8-week finisher
  // (or a Taster finisher who carried on) gets weeks 8 to 11 of the full plan; a Race ready finisher gets the full plan.
  const carryOnOffer = (() => {
    if (profile.junior || !programmeComplete) return null;
    if (profile.raceReady) return { kind: "full" };
    const c = profile.continuation;
    if (c) return c.lengthWeeks === 8 ? { kind: "weeks", lengthWeeks: 12, fromWeek: 8, toWeek: 11 } : null;
    if (weeks.length === 4) return { kind: "weeks", lengthWeeks: 8, fromWeek: 5, toWeek: 8 };
    if (weeks.length === 8) return { kind: "weeks", lengthWeeks: 12, fromWeek: 8, toWeek: 11 };
    return null;
  })();

  // Juniors graduation: the whole plan can be done again at the next age up.
  const juniorAgain = () => {
    beginProgramme(buildJuniorPlan({ chosenDays: profile.chosenDays }), { carryOn: true });
    showToast("Same games, next age up. Badges already earned stay in the trophy case.");
  };

  const openCheckin = (target) => {
    setCheckinTarget(target);
    setStage("checkin");
  };

  const showToast = (text, type = "info", action = null) => {
    setToastType(type);
    setToast({ text, action });
  };

  const triggerConfetti = () => {
    setConfettiKey((k) => k + 1);
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 2600);
  };

  const trophyToastText = (justAwarded) => {
    if (junior) return justAwarded.length === 1 ? `🏅 Badge collected: ${justAwarded[0]}` : `🏅 ${justAwarded.length} badges collected!`;
    return justAwarded.length === 1 ? `🏆 Trophy unlocked: ${justAwarded[0]}` : `🏆 ${justAwarded.length} new trophies unlocked!`;
  };

  const celebrateTrophies = (justAwarded) => {
    showToast(trophyToastText(justAwarded), "trophy");
    triggerConfetti();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]); // Android only: iOS Safari has no Vibration API
  };

  // How a ride felt changes the coach note, never the plan: no session's minutes move from a feeling.
  const logSession = (target, feeling, { navigate = true } = {}) => {
    const changing = !!target.changing;
    const wasSkipped = changing && target.previousFeeling === SKIPPED;
    if (changing) setCheckinTarget((t) => (t && t.key === target.key ? { ...t, changing: false } : t));
    const newLog = { ...sessionLog, [target.key]: feeling };
    setSessionLog(newLog);
    // Logged again after a clear: the cleared marker goes, so the account merge keeps this log.
    if (target.key in clearedLog) setClearedLog((prev) => { const next = { ...prev }; delete next[target.key]; return next; });
    // Changing a logged session: a ride that becomes a skip loses its minutes; a skip that becomes a ride gets the
    // planned minutes below; a timed ride whose feeling changes keeps its timed minutes.
    if (changing && feeling === SKIPPED) setSessionDurations((prev) => { const next = { ...prev }; delete next[target.key]; return next; });
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
    // without the timer: a real timer reading (the one just stopped above, or one
    // already in sessionDurations) takes priority over the planned figure.
    if (feeling !== "Didn't get to it" && timedMins == null && (wasSkipped || !(target.key in sessionDurations))) {
      const effectiveMins = effectiveSession(target.session).mins;
      setSessionDurations((prev) => ({ ...prev, [target.key]: effectiveMins }));
    }
    if (feeling !== "Didn't get to it") setLastActivityAt(Date.now());

    const justAwarded = checkAllBadges(newLog, adHocLog); // never awards a trophy already in the case

    if (justAwarded.length > 0) {
      celebrateTrophies(justAwarded);
    } else if (!navigate) {
      showToast(feeling === "Didn't get to it" ? "No worries. Logged as skipped." : "Session logged.");
    } else if (changing) {
      showToast("Changed.");
    }

    if (!navigate) return;
    setCoachNote(getCoachNote(target, feeling, junior));
  };

  const submitCheckin = (feeling) => checkinTarget && logSession(checkinTarget, feeling, { navigate: true });

  // Marks a session as cleared (not done) right now, and drops its minutes: the account merge then keeps it cleared.
  const markCleared = (key) => {
    setClearedLog((prev) => ({ ...prev, [key]: Date.now() }));
    setSessionDurations((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  // One-tap skip, with six seconds to take it back. Undo restores the log and the trophy case exactly as they were,
  // and marks the skip as cleared so a copy already on the account cannot bring it back.
  const quickSkip = (target) => {
    const before = { sessionLog, badges };
    if (activeTimer && activeTimer.key === target.key) { setActiveTimer(null); setCancelAsk(false); }
    logSession(target, "Didn't get to it", { navigate: false });
    showToast("Skipped.", "undo", { label: "Undo", onClick: () => {
      setSessionLog(before.sessionLog);
      setBadges(before.badges);
      if (!(target.key in before.sessionLog)) markCleared(target.key);
    } });
  };

  // Reopens check-in for a logged or skipped session, with what was chosen last time shown.
  const openChange = (target) => {
    setCoachNote("");
    openCheckin({ ...target, changing: true, previousFeeling: sessionLog[target.key] });
  };

  // "Clear this": the session goes back to not done, and its minutes with it. Trophies already earned stay.
  const clearSession = (target) => {
    setSessionLog((prev) => { const next = { ...prev }; delete next[target.key]; return next; });
    markCleared(target.key);
    showToast("Cleared.");
    backToDashboard();
  };

  const toggleTimerSettings = () => {
    const next = !timerSettingsOpen;
    setTimerSettingsOpen(next);
    try { localStorage.setItem(TIMER_SETTINGS_KEY, next ? "open" : "closed"); } catch (e) { /* storage unavailable */ }
  };

  const startRideTimer = (target, targetMins) => {
    // The AudioContext is created (or resumed) here, inside the tap, and reused for the countdown beep: one made later,
    // when the timer runs out, is silent on iPhone. Juniors sessions have no beep, so no context is needed.
    if (!junior && timerMode === "down") audioCtxRef.current = getAudioContext(audioCtxRef.current);
    if (voiceOn) speak(`Starting your ${targetMins} minute ride.`);
    setActiveTimer({ key: target.key, startedAt: Date.now(), mode: timerMode, targetMins, junior });
    setTimerAlerted(false);
    setCancelAsk(false);
  };
  // Cancel asks first ("Stop the timer and lose the time?"); only Stop throws the time away.
  const cancelRideTimer = () => { setActiveTimer(null); setTimerAlerted(false); setCancelAsk(false); };
  const finishRideTimer = () => {
    if (!activeTimer) return;
    const elapsedMins = Math.max(1, Math.round((Date.now() - activeTimer.startedAt) / 60000));
    const key = activeTimer.key;
    const priorBest = Math.max(0, ...Object.values(sessionDurations));
    setSessionDurations((prev) => ({ ...prev, [key]: elapsedMins }));
    setActiveTimer(null);
    setTimerAlerted(false);
    setCancelAsk(false);
    if (priorBest > 0 && elapsedMins > priorBest) {
      showToast(`⭐ New personal best! Longest ride yet: ${formatMinutes(elapsedMins)}`, "trophy");
    }
    const target = allSessions.find((s) => s.key === key);
    if (target) openCheckin(target);
  };

  const backToDashboard = () => {
    setCheckinTarget(null);
    setCoachNote("");
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
    const mailto = `mailto:info@mtbeast.co.uk?subject=${encodeURIComponent("Sofa to Singletrack: what I'd like from MTB East")}&body=${encodeURIComponent(lines)}`;
    window.location.href = mailto;
    setQaTopics([]);
    setQaNotes("");
    setStage("dashboard");
    showToast("Thanks. Opening your email to send this to the coaches.");
  };

  const handleShare = async () => {
    const shareData = {
      title: "Sofa to Singletrack",
      text: "I'm using Sofa to Singletrack, an MTB East programme to get riding regularly. Thought you might like it too.",
      url: window.location.origin,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch (e) { /* user cancelled the share sheet */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      showToast("Link copied. Paste it to share!");
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
    ctx.fillText(junior ? "SOFA TO SINGLETRACK JUNIOR" : "I'M A REGULAR RIDER NOW", 540, 560);

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
      showToast("Couldn't create the image. Try again.");
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
    showToast("Image saved. Share it from your photos!");
  };

  const openAdHocForm = () => {
    setAdHocDate(dateKey(new Date()));
    setAdHocMins(junior ? "15" : "30");
    setAdHocFeeling(junior ? "Fine" : "About right");
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
      showToast("Nice one. Ride logged.");
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
    const payload = buildPayload();
    writeItem(keyForRider(riderIndex.active), JSON.stringify(payload));
    // The outgoing rider goes up now, not after the usual two-second wait, so switching never leaves them behind.
    if (syncReady) pushNow(riderIndex.active, profile.name, payload);
  };
  const loadRider = (id, fallbackName) => {
    applyStored(keyForRider(id), readItem(keyForRider(id)), fallbackName || "");
    setStep(0);
    setNameBoxOpen(false);
  };
  const switchRider = (id) => {
    if (id === riderIndex.active) return;
    flushCurrentRider();
    const target = riderIndex.riders.find((r) => r.id === id);
    loadRider(id, target ? target.name : "");
    persistIndex({ ...riderIndex, active: id });
  };
  // A new rider on this device: by name, or one of the account's riders (accountRider), whose setup starts past the age step.
  const addRider = (name, accountRider = null) => {
    const clean = (name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!clean) return "Please give their first name.";
    if (riderIndex.riders.length >= MAX_RIDERS) return "That's the most riders one account can hold.";
    flushCurrentRider();
    const id = newRiderId();
    const blank = blankSaved(clean);
    applySaved(blank);
    setBikeCheckDone(false);
    setFitnessConfirmed(false);
    setStep(0);
    setNameBoxOpen(false);
    persistIndex({ active: id, riders: [...riderIndex.riders, { id, name: clean, ...(accountRider ? { riderProfileId: accountRider.id } : {}) }] });
    if (accountRider) startFromAccountRider(blank.profile, accountRider);
    return null;
  };
  const addAccountRider = (r) => (r.linkedTo ? `${r.firstName} is already set up on this device.` : addRider(r.firstName, r));
  const removeRider = (id) => {
    if (id === riderIndex.riders[0].id) return;
    const who = riderIndex.riders.find((r) => r.id === id);
    if (!window.confirm(`Remove ${who && who.name ? who.name : "this rider"} and their progress for good?`)) return;
    try { localStorage.removeItem(keyForRider(id)); localStorage.removeItem(keyForRider(id) + ":backup"); } catch (e) { /* storage unavailable */ }
    const sync = syncRef.current;
    if (sync.pending && sync.pending.id === id) { sync.pending = null; clearTimeout(sync.timer); sync.timer = null; }
    // Remembered as removed (so this device never pushes them again); the DELETE is retried when back online if it fails.
    let next = markRemoved(riderIndex, id, Date.now(), !!(account && account.signedIn));
    if (id === riderIndex.active) {
      const first = next.riders[0];
      loadRider(first.id, first.name);
      next = { ...next, active: first.id };
    }
    persistIndex(next);
    if (account && account.signedIn) {
      fetch("/api/programme/progress", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ riderId: id }) })
        .then((res) => { if (res.status === 401) handleSignedOut(); else if (res.ok || res.status === 404 || res.status === 410) persistIndex(confirmRemoved(riderIndexRef.current, [id])); })
        .catch(() => { /* still pending: retried on online/focus */ });
    }
  };

  // Settings' Restore of the earlier copy: it becomes the live copy with savedAt = now, goes up at once, and the app reloads.
  const restoreBackup = async (safe) => {
    const key = keyForRider(riderIndex.active);
    restoringRef.current = true;
    if (!writeItem(key, JSON.stringify(safe))) { restoringRef.current = false; showToast("This browser wouldn't save the earlier copy."); return; }
    try { localStorage.removeItem(key + ":backup"); } catch (e) { /* storage unavailable */ }
    if (syncReady) await Promise.race([pushNow(riderIndex.active, safe.profile.name, safe), new Promise((r) => setTimeout(r, 4000))]);
    window.location.reload();
  };

  const changeTextSize = (key) => {
    setTextSize(key);
    try { localStorage.setItem(TEXT_SIZE_KEY, key); } catch (e) { /* storage unavailable */ }
  };

  // Settings' "Add all my sessions to my calendar": one .ics with an all-day event per session still to do.
  const downloadProgrammeIcs = () => {
    const text = programmeIcs(weeks, programStart, sessionLog, riderIndex.active, new Date());
    downloadTextFile(text, `sofa-to-singletrack-${(profile.name || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`, "text/calendar;charset=utf-8");
    showToast("Calendar file downloaded. Open it to add the sessions.");
  };

  const selectedRace = races.find((r) => r.id === profile.raceId);

  // Missed weeks: today's week is more than one past the last week with anything logged. The card offers to move the
  // programme so this week holds the next unlogged session; "Keep my dates" puts it away until another week passes.
  const thisWeekN = weekNumberForDate(programStart, new Date());
  const missed = stage === "dashboard" && !programmeComplete ? missedWeeks(programStart, sessionLog, weeks, new Date()) : 0;
  const showMissedWeeks = missed > 0 && keepDatesWeek !== thisWeekN;
  const pickUpWhereLeftOff = () => {
    setProgramStart(shiftProgrammeStart(programStart, missed));
    setKeepDatesWeek(null);
    setShowComebackNudge(false); // they are back: no need to say the bike missed them as well
    showToast("Your plan now starts again this week");
  };

  // "Skip Thursday's Steady ride", for the Skip buttons.
  const skipLabel = (s) => {
    const name = s.session.name;
    const what = name === "Steady" ? "Steady ride" : name === "Skills" ? "Skills session" : name === "Intervals" ? "Intervals session" : name;
    const day = DAY_NAMES[s.session.day];
    return `Skip ${day ? `${day}'s ` : ""}${what}`;
  };

  return (
    <div className="app-root" style={{ fontFamily: "'Source Sans 3', sans-serif", background: stage === "print" ? "#ffffff" : "#000000", color: "#F4F3EF", minHeight: "100vh", position: "relative" }}>
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
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          body, .app-root { background: #ffffff !important; color: #000000 !important; }
          #mtbe-site-nav, .no-print, .app-root button { display: none !important; }
          .print-view { padding: 0 !important; min-height: 0 !important; }
        }
      `}</style>
      {showSplash && <SplashScreen />}
      {stage !== "print" && <TopoBackground />}
      <SiteNav account={account} />
      <div style={{ position: "relative", zIndex: 1, zoom: TEXT_SCALES[textSize] || 1 }}>
        {stage !== "print" && <AppHeader />}
        {stage !== "print" && <RiderSwitcher index={riderIndex} onSwitch={switchRider} />}

        {stage === "print" && <PrintView profile={profile} weeks={weeks} programStart={programStart} junior={junior} onBack={backToDashboard} />}

        {showConfetti && !reduceMotion && <Confetti key={confettiKey} />}

        {toast && (
          <div
            role="status"
            aria-live="polite"
            className={toastType === "trophy" ? "toast-pop" : undefined}
            style={{
              position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
              background: toastType === "trophy" ? "#AE5B20" : "#0F5F59", color: "#fff",
              padding: toastType === "trophy" ? "10px 20px" : "8px 16px", borderRadius: 20,
              fontSize: toastType === "trophy" ? 14 : 13, fontWeight: 700, zIndex: 10,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)", maxWidth: "88vw", textAlign: "center",
            }}
          >
            {toast.text}
            {toast.action && (
              <button onClick={() => { setToast(null); toast.action.onClick(); }} style={{ marginLeft: 12, minHeight: 32, background: "none", border: "1px solid rgba(255,255,255,0.6)", color: "#fff", borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{toast.action.label}</button>
            )}
          </div>
        )}

      {stage === "welcome" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px 40px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>AN MTB EAST PROGRAMME</div>
          <h1 className="display" style={{ fontSize: 40, lineHeight: 1.05, margin: "0 0 16px", color: "#E8792B" }}>SOFA TO<br />SINGLETRACK</h1>
          <TextSizeControl value={textSize} onChange={changeTextSize} />
          <p style={{ fontSize: 16, lineHeight: 1.5, color: "#F4F3EF", marginBottom: 10 }}>
            A simple plan to get you riding regularly: two or three rides a week, on days that suit you, timed by the clock
            so you need no bike computer. Racing is optional, and never the point.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#B9BDB8", marginBottom: 20 }}>
            Built by MTB East for off-road riding on real local trails. Under-14s get Sofa to Singletrack Juniors: eight weeks of games, with a grown-up.
          </p>
          <button onClick={() => { setBikeCheckDone(false); setFitnessConfirmed(false); setStage("onboarding"); }} style={{ ...navBtn, marginBottom: 28 }}>Start your programme</button>
          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 28, border: "1px solid #2b2b2b" }}>
            <ContourProgress weeks={defaultPlan()} currentWeek={1} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "#B9BDB8", marginTop: 4 }}>
              <span>Week 1</span><span>Riding regularly</span>
            </div>
          </div>
          <GpNote />
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 20 }}>
            <div className="display" style={{ fontSize: 14, color: "#1B8A82" }}>GET STARTED</div>
            <div style={{ fontSize: 14, color: "#B9BDB8", fontWeight: 600 }} aria-live="polite">Step {stepList.indexOf(stepName) + 1} of {stepList.length}</div>
          </div>

          {stepName === "name" && (() => {
            // Signed in with riders on the account: pick one and the name and age step are done. "Someone else" shows
            // the text box. A rider already set up on another programme on this device is greyed out.
            // A name already typed (or the account holder's own, filled in for them) with no link keeps the box open.
            const showNameBox = accountChoices.length === 0 || nameBoxOpen || (!!profile.name && !profile.riderProfileId);
            return (
              <div>
                <TextSizeControl value={textSize} onChange={changeTextSize} />
                {accountChoices.length > 0 && (
                  <AccountRiderPicker choices={accountChoices} isTaken={(r) => !!r.linkedTo && r.linkedTo !== riderIndex.active} onPick={(r) => startFromAccountRider(profile, r)}>
                    {!showNameBox && <button onClick={() => setNameBoxOpen(true)} style={{ ...choiceBtn, borderStyle: "dashed", color: "#B9BDB8" }}>Someone else</button>}
                  </AccountRiderPicker>
                )}
                {showNameBox && (
                  <>
                    <label htmlFor="rider-name" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>{riderIndex.active === riderIndex.riders[0].id ? "What should we call you?" : "What should we call them?"}</label>
                    {/* Typing a name here means someone else: any link to an account rider picked earlier goes. */}
                    <input id="rider-name" ref={nameRef} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value, riderProfileId: null })} placeholder="First name" style={inputStyle} />
                    <button onClick={() => setStep(1)} style={navBtn} disabled={!profile.name.trim()}>Next</button>
                  </>
                )}
              </div>
            );
          })()}

          {stepName === "age" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How old is the rider?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>
                Under-14s get <strong>Sofa to Singletrack Juniors</strong>: about 6 to 12, eight weeks of games, with a grown-up. {JUNIOR_INTRO.ages}
              </p>
              <button onClick={() => chooseAge("under14")} style={{ ...choiceBtn, borderColor: profile.ageBand === "under14" ? "#E8792B" : "#2b2b2b" }}>Junior (6 to 12, rides with a grown-up)</button>
              <button onClick={() => chooseAge("14plus")} style={{ ...choiceBtn, borderColor: profile.ageBand === "14plus" ? "#E8792B" : "#2b2b2b" }}>14 and over</button>
              <button onClick={() => goToStep("name")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "experience" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Have you ridden off-road before?</label>
              {["Never ridden a bike off-road", "Ridden trails casually", "Ridden regularly, never raced"].map((opt) => (
                <button key={opt} onClick={() => { setProfile({ ...profile, experience: opt }); goToStep("daysPerWeek"); }} style={{ ...choiceBtn, borderColor: profile.experience === opt ? "#E8792B" : "#2b2b2b" }}>{opt}</button>
              ))}
              <button onClick={() => goToStep("age")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "daysPerWeek" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How many days a week can you ride?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either works. Pick whatever fits your week. Three days is Skills, Steady and The long one; two days folds the skill into the long ride, so nothing is dropped.</p>
              <button onClick={() => { setSessionsPerWeek(3); goToStep("days"); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 3 ? "#E8792B" : "#2b2b2b" }}>3 days a week (recommended)</button>
              <button onClick={() => { setSessionsPerWeek(2); goToStep("days"); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 2 ? "#E8792B" : "#2b2b2b" }}>2 days a week, weekends for example</button>
              <button onClick={() => goToStep("experience")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "days" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{profile.junior ? "Which two days work best?" : `Which ${profile.sessionsPerWeek} days work best?`}</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Pick exactly {profile.sessionsPerWeek}. Tap to select or deselect.{profile.junior ? " Two sessions a week, 15 to 35 minutes each." : ""}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {WEEKDAYS.map((day) => {
                  const selected = profile.chosenDays.includes(day);
                  const disabled = !selected && profile.chosenDays.length >= profile.sessionsPerWeek;
                  return (
                    <button key={day} onClick={() => toggleDay(day)} disabled={disabled}
                      style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid " + (selected ? "#AE5B20" : "#2b2b2b"), background: selected ? "#AE5B20" : "#161616", color: selected ? "#fff" : disabled ? "#868A85" : "#F4F3EF", fontSize: 16, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>
                      {day}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => { if (profile.junior) setWeeks(buildJuniorPlan({ chosenDays: profile.chosenDays })); goToStep(profile.junior ? "confirm" : "planType"); }} style={navBtn} disabled={profile.chosenDays.length !== profile.sessionsPerWeek}>Next</button>
              <button onClick={() => goToStep(profile.junior ? "age" : "daysPerWeek")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "planType" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How do you want to plan it?</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either way, the goal is the same: riding regularly. Racing is an optional bonus if you fancy it.</p>
              <button onClick={() => { setProfile({ ...profile, planType: "race" }); setStep(step + 1); }} style={{ ...choiceBtn, borderColor: profile.planType === "race" ? "#E8792B" : "#2b2b2b" }}>I'd like the option of a race at the end</button>
              <button onClick={() => { setProfile({ ...profile, planType: "months" }); setStep(step + 1); }} style={{ ...choiceBtn, borderColor: profile.planType === "months" ? "#E8792B" : "#2b2b2b" }}>No pressure, just build a riding habit</button>
              <button onClick={() => goToStep("days")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "race" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Choose your target round</label>
              <p style={{ fontSize: 14, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>The 2027 League calendar. Pick the round you'd like to aim for. Racing is entirely optional. Twelve weeks or more away gets the full plan, eight the 8-week plan, four the 4-week Taster; under four weeks is a short Race ready block.</p>
              {(() => {
                // Only rounds from tomorrow on: a block cannot be built for a race that is today.
                const future = races.filter((race) => new Date(race.date + "T00:00:00") > new Date(new Date().setHours(0, 0, 0, 0)));
                if (future.length === 0) {
                  return (
                    <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 14, border: "1px solid #2b2b2b" }}>
                      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5 }}>No rounds on the calendar yet. Pick a timescale instead; racing can come later.</p>
                      <button onClick={() => setProfile({ ...profile, planType: "months", raceId: null, raceReady: false, raceReadyWeeks: null, delayWeeks: 0 })} style={navBtn}>Choose a timescale</button>
                    </div>
                  );
                }
                return future.map((race) => {
                  const away = weeksUntil(race.date);
                  return (
                    <button key={race.id} onClick={() => chooseRace(race)} style={{ ...choiceBtn, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <span><strong>{race.name}</strong>, {race.venue}</span>
                      <span style={{ color: "#B9BDB8", fontSize: 15, textAlign: "right", flexShrink: 0 }}>{new Date(race.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}<br /><span style={{ fontSize: 13 }}>{away} week{away === 1 ? "" : "s"} away</span></span>
                    </button>
                  );
                });
              })()}
              <button onClick={() => goToStep("planType")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "months" && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Choose a timescale</label>
              {[[1, "the 4-week Taster"], [2, "the 8-week plan"], [3, "the full 12-week plan"]].map(([m, what]) => (
                <button key={m} onClick={() => chooseMonths(m)} style={choiceBtn}>{m} month{m > 1 ? "s" : ""} ({m * 4} weeks): {what}</button>
              ))}
              <button onClick={() => goToStep("planType")} style={backBtn}>Back</button>
            </div>
          )}

          {stepName === "confirm" && (
            <div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{profile.junior ? "Sofa to Singletrack Juniors" : profile.raceReady ? "Race ready" : "Your programme"}</div>
                {profile.junior ? (
                  <>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{JUNIOR_INTRO.what}</p>
                    <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.5 }}>{JUNIOR_INTRO.helpers}</p>
                    <p style={{ margin: "10px 0 0", fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>Sessions on {profile.chosenDays.join(" and ")}. Each one shows the game, where to play it, what the child does, what the grown-up does, and the badge.</p>
                  </>
                ) : profile.raceReady && selectedRace ? (
                  <>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                      <strong>{selectedRace.name}</strong>, {selectedRace.venue}, is under four weeks away, so this is a {weeks.length}-week Race ready block, not a full plan: {weeks.length === 1 ? "the taper week, with six practice starts added" : "the M-check, a steady ride and a course recon, with six practice starts, then the taper week"}.
                    </p>
                    <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.5, color: "#E8792B", fontWeight: 600 }}>{RACE_READY_TEXT}</p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                      {weeks.length} weeks, {profile.sessionsPerWeek} sessions a week ({profile.chosenDays.join("/")}){profile.planType === "race" && selectedRace ? <>, with the option to race at <strong>{selectedRace.name}</strong>, {selectedRace.venue}</> : <>, no race pressure, just building the habit</>}.
                    </p>
                    {profile.delayWeeks > 0 && selectedRace && (
                      <p style={{ margin: "10px 0 0", fontSize: 15, lineHeight: 1.5, color: "#E8792B" }}>
                        {selectedRace.name} is {weeksUntil(selectedRace.date)} weeks away and this plan is {weeks.length} weeks long, so it starts on Monday {(() => { const d = mondayOf(new Date()); d.setDate(d.getDate() + 7 * profile.delayWeeks); return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" }); })()} and its last week is race week. Until then, any ride you do can be logged as an extra ride.
                      </p>
                    )}
                    <p style={{ margin: "10px 0 0", fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>
                      Every session works just as well outdoors on the trail or indoors on a turbo trainer / gym bike: same time, same effort, whichever suits you that day.
                    </p>
                  </>
                )}
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 14, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{profile.junior ? "Before the first game" : "Before your first ride"}</div>
                <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5, color: "#B9BDB8" }}>{profile.junior ? "A two-minute check of the child's bike, done together: brakes, tyres and quick releases. Tap each one to see what to look for." : "A two-minute check of brakes, tyres and quick releases before you head out. Tap each one to see what to look for."}</p>
                <BikeSetupCheck bordered={false} />
                <button onClick={() => setBikeCheckDone(true)} style={{ width: "100%", padding: "10px 0", background: bikeCheckDone ? "#0F5F59" : "#0d0d0d", color: bikeCheckDone ? "#fff" : "#F4F3EF", border: "1px solid " + (bikeCheckDone ? "#0F5F59" : "#2b2b2b"), borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                  {bikeCheckDone ? "✓ Bike checked" : profile.junior ? "Bike check done with a grown-up" : "I've checked my bike"}
                </button>
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Before you start</div>
                {/* The full health note is on the welcome screen; here it is one tap away rather than read twice in full. */}
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#E8792B", minHeight: 44, display: "flex", alignItems: "center" }}>Read the health note</summary>
                  <div style={{ marginTop: 10 }}><GpNote forGrownUp={profile.junior} /></div>
                </details>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={fitnessConfirmed} onChange={(e) => setFitnessConfirmed(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>
                    {profile.junior
                      ? "I'm the grown-up riding with them. I've read the health note, they're well enough to take part in this kind of activity, and if I'm unsure I'll check with their GP before starting."
                      : "I've read the health note. I'm well enough to take part in this kind of activity, and if I'm unsure I'll check with my GP before starting."}
                  </span>
                </label>
              </div>

              <button onClick={startProgramme} style={navBtn} disabled={!bikeCheckDone || !fitnessConfirmed}>{profile.junior ? "Build their programme" : "Build my programme"}</button>
              {(!bikeCheckDone || !fitnessConfirmed) && (
                <p role="status" style={{ margin: "-2px 0 10px", fontSize: 14, color: "#B9BDB8", textAlign: "center", lineHeight: 1.4 }}>
                  {!bikeCheckDone && !fitnessConfirmed ? "Tick the bike check and the health note to carry on" : !bikeCheckDone ? "Tick the bike check to carry on" : "Tick the health note to carry on"}
                </p>
              )}
              <button onClick={() => goToStep(profile.junior ? "days" : profile.planType === "race" ? "race" : "months")} style={backBtn}>Back</button>
            </div>
          )}
        </div>
      )}

      {stage === "dashboard" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "28px 20px 48px" }}>

          {storageBroken && (
            <div role="alert" style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "2px solid #E24B4A", fontSize: 15, lineHeight: 1.5, color: "#F4F3EF" }}>
              This browser isn't keeping your progress. Sign in so it saves to your account, or download a backup from Settings.
            </div>
          )}

          {showMissedWeeks && (
            <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #E8792B" }}>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Been away for a bit? No problem.</div>
              <p style={{ margin: "0 0 12px", fontSize: 15, color: "#B9BDB8", lineHeight: 1.5 }}>
                Your next session was {missed === 1 ? "a week" : `${missed} weeks`} ago on the calendar. Pick up where you left off and the plan starts again this week, with every ride you have logged kept. Or keep the dates as they are.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={pickUpWhereLeftOff} style={{ ...navBtn, marginBottom: 0, flex: 1, minWidth: 180 }}>Pick up where I left off</button>
                <button onClick={() => setKeepDatesWeek(thisWeekN)} style={{ flex: 1, minWidth: 140, background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "12px 14px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Keep my dates</button>
              </div>
            </div>
          )}

          {showComebackNudge && !programmeComplete && !showMissedWeeks && (
            <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #E8792B", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">🚲</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>Your bike misses you</div>
                <div style={{ fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>It's been a couple of weeks. No pressure, jump back in whenever you're ready.</div>
              </div>
              <button onClick={() => setShowComebackNudge(false)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "#868A85", fontSize: 24, cursor: "pointer", width: 44, height: 44, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>
          )}

          {(syncState.status === "signedOut" || !(account && !account.signedIn && signInCardHidden)) && <AccountCard account={account} syncState={{ ...syncState, lastSavedAt: (riderIndex.riders.find((r) => r.id === riderIndex.active) || {}).lastSavedAt }} onHide={() => { setSignInCardHidden(true); try { localStorage.setItem("sofaToSingletrack:hideSignInCard", "1"); } catch (e) { /* storage unavailable */ } }} />}
          {raceWeek && <RaceWeekCard entry={raceWeek} junior={junior} />}
          {!raceWeek && selectedRace && raceWeekNote(daysUntil(selectedRace.date), junior) && new Date(selectedRace.date + "T00:00:00") >= new Date(new Date().setHours(0, 0, 0, 0)) && (
            <RaceCoachNote race={selectedRace} note={raceWeekNote(daysUntil(selectedRace.date), junior)} />
          )}
          {showRaceOffer && nextRelevantRace && !raceWeek && !programmeComplete && !junior && (
            <RaceAdvert race={nextRelevantRace} funPrice={funPrice} onDismiss={() => setShowRaceOffer(false)} />
          )}

          {!programmeComplete && nextSession && (
            <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 16, border: "2px solid #E8792B", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -112, right: -112, width: 254, height: 254, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,121,43,0.35) 0%, rgba(232,121,43,0) 70%)", pointerEvents: "none" }} />
              <div style={{ position: "relative" }}>
              {(() => {
                const when = sessionDate(programStart, nextSession.weekN, nextSession.session.day);
                const explainer = explainerFor(nextSession.session);
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div aria-label={shortDate(when)} style={{ background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 10, padding: "5px 10px", textAlign: "center", minWidth: 48, flexShrink: 0 }}>
                        <div aria-hidden="true" style={{ fontSize: 12.5, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.04em" }}>{nextSession.session.day}</div>
                        <div aria-hidden="true" className="display" style={{ fontSize: 20, color: "#F4F3EF", lineHeight: 1.1 }}>{when.getDate()}</div>
                        <div aria-hidden="true" style={{ fontSize: 12.5, fontWeight: 700, color: "#B9BDB8", letterSpacing: "0.04em" }}>{when.toLocaleDateString("en-GB", { month: "short" })}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Next up{roleLabel(nextSession.session) ? ` · ${roleLabel(nextSession.session)}` : ""}{DAY_NAMES[nextSession.session.day] ? ` · ${DAY_NAMES[nextSession.session.day]}` : ""}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">{iconFor(nextSession.session.name)}</span>
                          <div style={{ fontSize: 20, fontWeight: 700 }}>{nextSession.session.name}</div>
                          {explainer && (
                            <button onClick={() => setExplainerOpen((v) => !v)} aria-label="What this session means" aria-expanded={explainerOpen} style={{ width: 44, height: 44, minHeight: 44, borderRadius: "50%", background: "none", border: "none", color: "#B9BDB8", cursor: "pointer", padding: 0, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                              <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", border: "1px solid #B9BDB8", fontSize: 14, fontWeight: 700, lineHeight: "20px", textAlign: "center" }}>?</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <EffortDots effort={nextSession.session.effort} note={sameNote(nextSession.session.effortNote, nextSessionEffective.detail) ? null : nextSession.session.effortNote} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#B9BDB8" }}>{nextSession.session.minsText || `${nextSessionEffective.mins} min`}</span>
                    </div>
                    {explainerOpen && explainer && (
                      <p style={{ fontSize: 14, color: "#B9BDB8", background: "#0d0d0d", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px", lineHeight: 1.4 }}>
                        {explainer}
                      </p>
                    )}
                  </>
                );
              })()}
              {junior ? (
                <JuniorGame key={nextSession.key} session={nextSession.session} />
              ) : nextSessionEffective.detail ? (
                <GlossaryText key={nextSession.key} text={nextSessionEffective.detail} />
              ) : null}
              <DoneWhen session={nextSession.session} />
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
                    <div
                      className={overtime ? "timer-alert" : undefined}
                      role="timer"
                      aria-live={running ? "off" : undefined}
                      style={{ background: "#0d0d0d", borderRadius: 10, padding: "14px", marginBottom: 12, textAlign: "center", border: "1px solid " + (overtime ? "#E24B4A" : "#E8792B") }}
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
                    {running ? (
                      cancelAsk ? (
                        <div role="alertdialog" aria-label="Stop the timer and lose the time?" style={{ background: "#0d0d0d", border: "1px solid #E8792B", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                          <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 600 }}>Stop the timer and lose the time?</p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setCancelAsk(false)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Keep going</button>
                            <button onClick={cancelRideTimer} style={{ flex: 1, background: "none", border: "1px solid #5a2a2a", color: "#E24B4A", borderRadius: 10, padding: "0 12px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Stop</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                          <button onClick={finishRideTimer} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Finish ride</button>
                          <button onClick={() => setCancelAsk(true)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>Cancel</button>
                        </div>
                      )
                    ) : (
                      <button onClick={() => startRideTimer(nextSession, nextSessionEffective.mins)} style={{ ...navBtn, background: "#E8792B", color: "#14171A" }}>▶ Start ride timer</button>
                    )}
                    {/* Count up or down, the voice cues and what the phone will do about the screen: tucked away so the card is the timer and the Start button. */}
                    <div style={{ marginBottom: 12 }}>
                      <button onClick={toggleTimerSettings} aria-expanded={timerSettingsOpen} style={{ width: "100%", background: "none", border: "1px solid #2b2b2b", borderRadius: 8, padding: "0 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", color: "#B9BDB8", fontSize: 14, fontWeight: 600 }}>
                        <span>Timer settings</span>
                        <span style={{ color: "#E8792B", fontSize: 16 }} aria-hidden="true">{timerSettingsOpen ? "–" : "+"}</span>
                      </button>
                      {timerSettingsOpen && (
                        <div style={{ marginTop: 10 }}>
                          {!running && (
                            <div role="group" aria-label="Timer direction" style={{ display: "flex", gap: 6, marginBottom: 10, justifyContent: "center" }}>
                              {["up", "down"].map((m) => {
                                const active = timerMode === m;
                                return (
                                  <button key={m} onClick={() => setTimerMode(m)} aria-pressed={active}
                                    style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 5, border: "1px solid " + (active ? "#E8792B" : "#2b2b2b"), background: active ? "rgba(232,121,43,0.14)" : "#0d0d0d", color: active ? "#E8792B" : "#B9BDB8", cursor: "pointer" }}>
                                    {m === "up" ? "⏱ Count up" : "⏳ Count down"}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <RideTimerStatus running={running} wakeState={wakeState} voiceOn={voiceOn} onToggleVoice={toggleVoice} beep={!junior} />
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
              {justLogged.length > 0 && (
                <p style={{ margin: "0 0 10px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>
                  {sessionWords(justLogged[0].session)}: {sessionLog[justLogged[0].key] === SKIPPED ? "skipped" : sessionLog[justLogged[0].key].toLowerCase()}.{" "}
                  <button onClick={() => openChange(justLogged[0])} style={changeLink}>Change</button>
                </p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openCheckin(nextSession)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>{junior ? "Ticked by a grown-up" : "Log this session"}</button>
                <button onClick={() => downloadSessionICS(nextSessionEffective, nextSession.weekN, nextSession.weekTitle, programStart)} aria-label="Add this session to your calendar" style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>+ Cal</button>
                <button onClick={() => quickSkip(nextSession)} aria-label={skipLabel(nextSession)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 15, cursor: "pointer" }}>Skip</button>
              </div>
              </div>
            </div>
          )}

          <PreRideChecklist />

          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Week {currentWeekN} of {weeks.length}
            </div>
            {currentWeek && currentWeek.title && (
              <div style={{ marginBottom: 8 }}>
                <div className="display" style={{ fontSize: 20, lineHeight: 1.2, color: "#F4F3EF" }}>{currentWeek.title}</div>
                {currentWeek.focus && <p style={{ margin: "4px 0 0", fontSize: 15, lineHeight: 1.5, color: "#B9BDB8" }}>{currentWeek.focus}</p>}
              </div>
            )}
            {profile.raceReady && !programmeComplete && (
              <p style={{ margin: "0 0 8px", fontSize: 15, lineHeight: 1.5, color: "#E8792B", fontWeight: 600 }}>{RACE_READY_TEXT}</p>
            )}
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#F4F3EF" }}>
              {welcomeNote || `Nice and steady, ${profile.name || "rider"}. Every session counts.`}
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
                <div style={{ fontSize: 13, color: "#B9BDB8", marginTop: 2 }}>Longest run of weeks</div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Trophy case</div>
            {badges.length === 0 ? (
              <p style={{ margin: 0, fontSize: 15, color: "#868A85", lineHeight: 1.5 }}>{junior ? "The first badge comes with the first game, once a grown-up has ticked it." : "Keep going. Your first trophy unlocks after your first week done."}</p>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {badges.map((b) => (
                  <div key={b} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ fontSize: 16 }}>{JUNIOR_BADGES.includes(b) ? "🏅" : "🏆"}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>{b}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Settings sit here, just after the week card, so text size and training days are a short scroll away rather than at the very bottom. */}
          <SettingsSection
            storageKey={keyForRider(riderIndex.active)} profile={profile} setProfile={setProfile} weeks={weeks} setWeeks={setWeeks} showToast={showToast} onRestoreBackup={restoreBackup}
            textSize={textSize} onTextSize={changeTextSize}
            onCalendarFile={downloadProgrammeIcs} onPrint={() => setStage("print")} programmeComplete={programmeComplete}
            family={<FamilyPanel index={riderIndex} onSwitch={switchRider} onAdd={addRider} onRemove={removeRider} accountChoices={accountChoices} onAddFromAccount={addAccountRider} bordered={false} />}
          />

          {programmeComplete && junior ? (
            <div>
              <div style={{ background: "#AE5B20", borderRadius: 12, padding: "20px", textAlign: "center", color: "#fff", marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 18, marginBottom: 6 }}>SOFA TO SINGLETRACK JUNIOR{profile.name ? ": " + profile.name.toUpperCase() : ""}</div>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{(COACH_SCENARIOS.junior && COACH_SCENARIOS.junior.graduation) || "A fun race is next if they want it, and the whole plan can be done again at the next age up."}</p>
                <button onClick={handleShareFinishCard} style={{ marginTop: 14, background: "#14171A", border: "none", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📸 Share the badge</button>
              </div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #2b2b2b" }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>A fun race is next, if they want it</div>
                {nextRace ? (
                  <p style={{ fontSize: 15, color: "#F4F3EF", margin: "0 0 10px", lineHeight: 1.5 }}>
                    The next round is <strong>{nextRace.name}</strong>, {nextRace.venue}, on {new Date(nextRace.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Under-16s race in their age category, and a fun race means a fun race.
                  </p>
                ) : (
                  <p style={{ fontSize: 15, color: "#B9BDB8", margin: "0 0 10px", lineHeight: 1.5 }}>The next round's date is on the League page.</p>
                )}
                <a href="/league" style={{ ...navBtn, marginBottom: 0, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>See the race calendar</a>
              </div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #2b2b2b" }}>
                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Do it again at the next age up</div>
                <p style={{ fontSize: 15, color: "#B9BDB8", margin: "0 0 10px", lineHeight: 1.5 }}>The whole plan works again at the next age up: same games, bigger child, longer laps. The badges already earned stay in the trophy case.</p>
                <button onClick={juniorAgain} style={{ ...navBtn, marginBottom: 0 }}>Start the eight weeks again</button>
              </div>
            </div>
          ) : programmeComplete ? (
            <div>
              <div style={{ background: "#AE5B20", borderRadius: 12, padding: "20px", textAlign: "center", color: "#fff", marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 18, marginBottom: 6 }}>{profile.raceReady ? "YOU MADE THE START LINE" : "YOU'VE GRADUATED"}{profile.name ? ", " + profile.name.toUpperCase() : ""}</div>
                <p style={{ margin: 0, fontSize: 16 }}>{profile.raceReady ? "That was the deal: the start line in one piece. The full plan starts after the race." : "You're a regular rider now. That's the real win, and racing from here is entirely optional."}</p>
                <button onClick={handleShareFinishCard} style={{ marginTop: 14, background: "#14171A", border: "none", color: "#fff", borderRadius: 10, padding: "10px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>📸 Share your achievement</button>
              </div>
              {carryOnOffer && (
                <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #1B8A82" }}>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{carryOnOffer.kind === "full" ? "The full plan starts after the race" : "Want more?"}</div>
                  <p style={{ fontSize: 15, color: "#B9BDB8", margin: "0 0 10px", lineHeight: 1.5 }}>
                    {carryOnOffer.kind === "full"
                      ? "Twelve weeks, from week 1, on the days you already ride. Your badges and the rides you have logged stay."
                      : carryOnOffer.fromWeek === 5
                        ? "The obvious next step is the 8-week plan starting at week 5: descending and the first snack on the bike, your first hour, the first short efforts, then the taper and graduation."
                        : "Carry on with weeks 8 to 11 of the full plan: the repeat week, the first short hard efforts, race pace if you fancy it, and the real thing, slowly."}
                  </p>
                  <button onClick={() => (carryOnOffer.kind === "full" ? startFullPlan() : carryOn(carryOnOffer))} style={{ ...navBtn, marginBottom: 0 }}>
                    {carryOnOffer.kind === "full" ? "Start the full 12-week plan" : carryOnOffer.fromWeek === 5 ? "Carry on with the 8-week plan from week 5" : "Carry on with weeks 8 to 11"}
                  </button>
                </div>
              )}
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
                  <li>Keep logging rides whenever you get out, no plan required</li>
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
                    const eff = effectiveSession(s.session);
                    return (
                      <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < upcoming.length - 1 ? 10 : 0 }}>
                        <div className="display" style={{ fontSize: 14, color: "#E8792B", minWidth: 30 }}>{s.session.day}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{s.session.name}{roleLabel(s.session) ? <span style={{ fontWeight: 400, color: "#868A85" }}> · {roleLabel(s.session)} · {s.session.minsText || `${eff.mins} min`}</span> : null}</div>
                          <div style={{ fontSize: 14, color: "#B9BDB8" }}>{eff.detail || s.session.child || ""}</div>
                        </div>
                        <button onClick={() => quickSkip(s)} aria-label={skipLabel(s)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#868A85", borderRadius: 6, padding: "3px 8px", fontSize: 13, cursor: "pointer", height: "fit-content" }}>Skip</button>
                      </div>
                    );
                  })}
                  {justLogged.length > 0 && (
                    <div style={{ borderTop: "1px solid #2b2b2b", marginTop: 12, paddingTop: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#868A85", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Just logged</div>
                      {justLogged.map((s) => (
                        <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, marginBottom: 4 }}>
                          <span style={{ flex: 1, color: "#B9BDB8" }}>{sessionWords(s.session)}: {sessionLog[s.key] === SKIPPED ? "skipped" : sessionLog[s.key].toLowerCase()}</span>
                          <button onClick={() => openChange(s)} style={changeLink}>Change</button>
                        </div>
                      ))}
                    </div>
                  )}
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
          />

          <div style={{ background: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, padding: adHocFormOpen ? "14px" : "10px 12px", marginBottom: 16 }}>
            {!adHocFormOpen ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#F4F3EF" }}>Had a ride that wasn't on the plan?</div>
                  <div style={{ fontSize: 14, color: "#B9BDB8" }}>Any ride counts</div>
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
                <label style={{ display: "block", fontSize: 13, color: "#B9BDB8", marginBottom: 6 }}>{junior ? "How did it go? (the grown-up answers)" : "How did it feel?"}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {(junior ? JUNIOR_FEELINGS : FEELINGS).map((f) => (
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

          {!junior && <CoachTips onContact={() => setStage("coachQA")} />}
          <TipsAndAdvice />

          {/* Get in touch and donations stay last. The donation and "Contact a coach" tiles are hidden on a Junior rider's dashboard; they stay on the account holder's. */}
          <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 16, border: "2px solid #E8792B" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Get in touch</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {!junior && <button onClick={() => setStage("coachQA")} style={actionGridBtn}>💬 Contact a coach</button>}
              <a href="/league" style={actionGridBtn}>📅 Race calendar</a>
              <button onClick={handleShare} style={actionGridBtn}>📤 Share this app</button>
              <a href="mailto:info@mtbeast.co.uk?subject=Sofa%20to%20Singletrack%20feedback" style={actionGridBtn}>💡 Feedback / bug</a>
            </div>

            {!junior && (
              <>
                <div style={{ borderTop: "1px solid #2b2b2b", margin: "16px 0 14px" }} />

                <div style={{ fontSize: 14, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Support MTB East</div>
                <p style={{ margin: "0 0 12px", fontSize: 14, color: "#B9BDB8", lineHeight: 1.4 }}>This app is free to use. If it's helped you, a donation helps us keep it that way.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <a href="https://buy.stripe.com/4gMbJ2cXM6jFd1c2uR43S00" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>£5</a>
                  <a href="https://buy.stripe.com/bJeeVe3nc6jFbX81qN43S01" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>£10</a>
                  <a href="https://buy.stripe.com/bJe9AUbTI6jFbX8b1n43S02" target="_blank" rel="noopener noreferrer" style={actionGridBtn}>Choose amount</a>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {stage === "checkin" && checkinTarget && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          {(() => {
            // Changing a logged session shows the choices again with last time's answer marked; once a choice is made
            // (logSession clears the flag) the page reads as a normal check-in with the coach note.
            const changingNow = !!checkinTarget.changing;
            const showChoices = !(checkinTarget.key in sessionLog) || changingNow;
            return (
              <>
                <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>{changingNow ? changingLabel(checkinTarget.session).toUpperCase() : junior ? "TICKED BY A GROWN-UP" : "HOW DID IT GO?"}</div>
                <h2 className="display" style={{ fontSize: 24, margin: "0 0 12px", color: "#E8792B" }}>{checkinTarget.session.name.toUpperCase()}</h2>
                {junior && showChoices && !changingNow && (
                  <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: 1.5, color: "#B9BDB8" }}>For the grown-up who rode with {profile.name || "them"}: how did it go?</p>
                )}
                <DoneWhen session={checkinTarget.session} />
                {showChoices && (
                  <div>
                    {(junior ? JUNIOR_FEELINGS : FEELINGS).map((opt) => {
                      const was = changingNow && checkinTarget.previousFeeling === opt;
                      return (
                        <button key={opt} onClick={() => submitCheckin(opt)} aria-pressed={changingNow ? was : undefined} style={was ? { ...choiceBtn, borderColor: "#E8792B" } : choiceBtn}>{opt}{was ? " (last time)" : ""}</button>
                      );
                    })}
                    <div style={{ height: 8 }} />
                    <button onClick={() => submitCheckin(SKIPPED)} aria-pressed={changingNow ? checkinTarget.previousFeeling === SKIPPED : undefined} style={{ ...choiceBtn, borderStyle: "dashed", color: "#B9BDB8", ...(changingNow && checkinTarget.previousFeeling === SKIPPED ? { borderColor: "#E8792B" } : {}) }}>
                      {junior ? JUNIOR_SKIPPED_LABEL : "Didn't get to it. That's fine, the next one is waiting."}{changingNow && checkinTarget.previousFeeling === SKIPPED ? " (last time)" : ""}
                    </button>
                    {changingNow && (
                      <>
                        <button onClick={() => clearSession(checkinTarget)} style={{ ...choiceBtn, color: "#E24B4A", borderColor: "#5a2a2a" }}>Clear this</button>
                        <button onClick={backToDashboard} style={backBtn}>Back</button>
                      </>
                    )}
                  </div>
                )}
                {!showChoices && (
                  <div>
              <div style={{ background: "#14171A", borderRadius: 12, padding: "18px 20px", marginBottom: 20, color: "#F4F3EF" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{junior ? "Coach note, for the grown-up" : "Coach note"}</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, minHeight: 20 }}>{coachNote}</p>
              </div>

                    <button onClick={backToDashboard} style={navBtn}>Back to home</button>
                    <button onClick={() => openChange(checkinTarget)} style={{ ...backBtn, color: "#E8792B", fontWeight: 600 }}>Change</button>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {stage === "coachQA" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 14, color: "#1B8A82", marginBottom: 8 }}>CONTACT A COACH</div>
          <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px", color: "#E8792B" }}>WHAT WOULD HELP YOU MOST?</h2>
          <p style={{ fontSize: 15, color: "#B9BDB8", lineHeight: 1.5, marginBottom: 14 }}>
            This isn't live chat. It opens an email from your own address to the coaches, so they can reply directly and we can find out what riders actually want from us.
          </p>
          <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
            <p style={{ margin: 0, fontSize: 14, color: "#B9BDB8", lineHeight: 1.5 }}>
              This form is free to use. All coaching, 1-to-1 or an organised skills session, is a chargeable service. Tell us what you're after below and we'll get back to you with details.
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
// The small "Change" link on a session that has been logged or skipped.
const changeLink = { background: "none", border: "none", color: "#E8792B", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "0 4px", minHeight: 0, textDecoration: "underline" };
const choiceBtn = { display: "block", width: "100%", textAlign: "left", padding: "14px 16px", marginBottom: 10, background: "#161616", border: "1.5px solid #2b2b2b", color: "#F4F3EF", borderRadius: 10, fontSize: 15, cursor: "pointer" };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #2b2b2b", background: "#161616", color: "#F4F3EF", fontSize: 16, marginBottom: 20, boxSizing: "border-box" };
const actionGridBtn = { display: "block", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "center", textDecoration: "none", boxSizing: "border-box" };
