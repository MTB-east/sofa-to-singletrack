import React, { useState, useEffect, useRef } from "react";
import COACH_SCENARIOS from "./data/coach-scenarios.json";

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

const MTB_EAST_RACES = [
  { id: 1, name: "Round 1", venue: "Potash, Rochford", date: "2027-03-14" },
  { id: 2, name: "Round 2", venue: "Potash, Rochford", date: "2027-04-11" },
  { id: 3, name: "Round 3", venue: "Gallows Green, Lindsell", date: "2027-05-09" },
  { id: 4, name: "Round 4", venue: "Potash, Rochford", date: "2027-06-13" },
  { id: 5, name: "Round 5", venue: "Gallows Green, Lindsell", date: "2027-07-11" },
  { id: 6, name: "Round 6", venue: "Potash, Rochford", date: "2027-09-12" },
  { id: 7, name: "Round 7", venue: "Potash, Rochford", date: "2027-10-10" },
  { id: 8, name: "Round 8", venue: "Gallows Green, Lindsell", date: "2027-11-07" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const TEMPLATE = [
  {
    title: "Off the sofa", focus: "Short flat rides, get comfortable on the bike",
    sessions: [
      { name: "Easy spin", mins: 20, detail: "20 min, flat path, stay seated, get used to the bike", trainerAlt: "20 min on a trainer/gym bike, easy spin, no resistance changes — just get used to pedalling rhythm" },
      { name: "Easy spin", mins: 20, detail: "20 min, flat path, practice looking up rather than at the front wheel", trainerAlt: "20 min easy spin on a gym bike, focus on relaxed shoulders and hands" },
      { name: "Steady ride", mins: 30, detail: "30 min, flat/gentle terrain, 2–3 stops to practice clipping in/out", trainerAlt: "30 min steady effort on a trainer, low resistance, no drills needed" },
    ],
  },
  {
    title: "Finding balance", focus: "Basic bike handling: braking, cornering, body position",
    sessions: [
      { name: "Handling drills", mins: 25, detail: "25 min: figure-of-8s in a car park or field, slow-speed balance", trainerAlt: "No direct trainer equivalent — swap for 20 min core/balance work (planks, single-leg stands)" },
      { name: "Braking practice", mins: 25, detail: "25 min flat ride, 8x practice stops — front/rear brake balance", trainerAlt: "25 min on a trainer, alternate 2 min seated / 1 min standing efforts to build bike-handling strength" },
      { name: "Easy trail ride", mins: 35, detail: "35 min gentle wide singletrack, focus on body position on corners", trainerAlt: "35 min steady spin on a gym bike, moderate resistance" },
    ],
  },
  {
    title: "First climbs", focus: "Gentle gradients, gear selection, pacing",
    sessions: [
      { name: "Gear practice", mins: 25, detail: "25 min flat, shift before (not during) short rises", trainerAlt: "25 min on a trainer practising smooth gear changes under light load" },
      { name: "Easy spin", mins: 25, detail: "25 min recovery ride, low effort", trainerAlt: "25 min easy spin on a gym bike, very light resistance" },
      { name: "Hill intro", mins: 40, detail: "40 min incl. 3x short gentle climbs, walk anything too steep", trainerAlt: "40 min on a trainer, 3x5 min at raised resistance simulating a climb, easy spin between" },
    ],
  },
  {
    title: "Rolling terrain", focus: "Mixed surface rides, short technical sections",
    sessions: [
      { name: "Mixed terrain", mins: 35, detail: "35 min, alternate gravel and packed dirt", trainerAlt: "35 min steady effort on a gym bike, varying cadence every 5 min" },
      { name: "Skills session", mins: 25, detail: "25 min, small roots/ruts at walking pace, practice weighting pedals", trainerAlt: "No direct trainer equivalent — swap for 20 min leg strength (squats, step-ups)" },
      { name: "Rolling ride", mins: 45, detail: "45 min rolling singletrack, no time pressure", trainerAlt: "45 min on a trainer, gently varying resistance to mimic rolling terrain" },
    ],
  },
  {
    title: "Building endurance", focus: "Longer rides, fuelling practice on the bike",
    sessions: [
      { name: "Steady ride", mins: 40, detail: "40 min, conversational pace", trainerAlt: "40 min steady zone 2 effort on a trainer or gym bike" },
      { name: "Fuelling practice", mins: 45, detail: "45 min, eat a snack and drink at the 20-min mark", trainerAlt: "45 min on a gym bike, practise eating/drinking mid-session exactly as you would on the trail" },
      { name: "Longer ride", mins: 60, detail: "60 min mixed terrain, first ride over an hour", trainerAlt: "60 min steady effort on a trainer, break into 3x20 min blocks if that's easier to hold focus" },
    ],
  },
  {
    title: "Race pace", focus: "Interval efforts, simulate race-length effort",
    sessions: [
      { name: "Intervals", mins: 35, detail: "35 min with 5x2 min hard-but-controlled, easy spin between", trainerAlt: "35 min on a trainer, 5x2 min at hard effort with 2 min easy spin recovery" },
      { name: "Easy spin", mins: 25, detail: "25 min recovery, low effort", trainerAlt: "25 min easy spin on a gym bike" },
      { name: "Race simulation", mins: 50, detail: "50 min at the effort you'd expect to hold in a race", trainerAlt: "50 min steady-hard effort on a trainer, treat it as a genuine time-trial effort" },
    ],
  },
  {
    title: "Course skills", focus: "Ride a real course, practice starts and lines",
    sessions: [
      { name: "Line choice", mins: 30, detail: "30 min varied terrain, pick the smoothest line, not the fastest", trainerAlt: "No direct trainer equivalent — swap for 20 min video study of a course preview or past race footage" },
      { name: "Start practice", mins: 20, detail: "20 min, 6x practice starts from a standstill", trainerAlt: "20 min on a trainer, 6x hard 15-second efforts from a dead stop to build start power" },
      { name: "Course recon", mins: 40, detail: "Ride an actual race course (or similar terrain) at an easy pace", trainerAlt: "No trainer equivalent — this one needs real terrain if at all possible" },
    ],
  },
  {
    title: "Taper", focus: "Short easy spins, rest, kit check",
    sessions: [
      { name: "Easy spin", mins: 20, detail: "20 min, very easy, legs should feel fresh afterwards", trainerAlt: "20 min very easy spin on a gym bike" },
      { name: "Kit check", mins: 15, detail: "15 min ride to test bike, tyre pressure, and race-day kit", trainerAlt: "No trainer equivalent — do the kit check on the actual race bike regardless" },
      { name: "Rest", mins: 15, detail: "Full rest or a gentle 15-min spin only — save your legs for race day", trainerAlt: "Full rest, or 15 min very easy spin on a gym bike if you want to move" },
    ],
  },
];

// chosenDays.length is 2 or 3. For a 2-day week we use the first and last
// template session (the lightest and the main ride), skipping the middle one.
function buildProgramme(totalWeeks, chosenDays) {
  const days = chosenDays && chosenDays.length ? chosenDays : ["Tue", "Thu", "Sat"];
  const weeks = [];
  for (let i = 0; i < totalWeeks; i++) {
    const srcIdx = Math.round((i * (TEMPLATE.length - 1)) / Math.max(totalWeeks - 1, 1));
    const src = TEMPLATE[srcIdx];
    const base = days.length === 2 ? [src.sessions[0], src.sessions[2]] : src.sessions;
    const sessions = base.map((s, idx) => ({ ...s, day: days[idx] }));
    weeks.push({
      n: i + 1,
      title: src.title,
      focus: src.focus,
      sessions,
      elev: Math.round(8 + (i / Math.max(totalWeeks - 1, 1)) * 84),
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

function toICSDate(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function sessionDate(programStart, weekNum, dayLabel) {
  // Program start is treated as the Monday of week 1 for scheduling purposes,
  // regardless of the actual weekday someone signs up on.
  const dayOffset = WEEKDAYS.indexOf(dayLabel);
  const d = new Date(programStart);
  d.setDate(d.getDate() + (weekNum - 1) * 7 + Math.max(dayOffset, 0));
  d.setHours(17, 30, 0, 0);
  return d;
}

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
  const rows = 14;
  return (
    <svg style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }} preserveAspectRatio="none" viewBox="0 0 400 800">
      {Array.from({ length: rows }).map((_, i) => {
        const baseY = (i / rows) * 800 + 20;
        const amp = 18 + (i % 3) * 6;
        const d = `M -20 ${baseY} C 60 ${baseY - amp}, 120 ${baseY + amp}, 200 ${baseY} S 340 ${baseY - amp}, 420 ${baseY}`;
        return <path key={i} d={d} fill="none" stroke={i % 2 === 0 ? "#1B8A82" : "#E8792B"} strokeWidth="0.7" opacity="0.06" />;
      })}
    </svg>
  );
}

function AppHeader() {
  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 20px", borderBottom: "1px solid #1c1c1c" }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#E8792B" }} />
      <span className="display" style={{ fontSize: 13, letterSpacing: "0.08em", color: "#F4F3EF" }}>SOFA TO SINGLETRACK</span>
      <span style={{ fontSize: 10, color: "#B9BDB8", fontWeight: 600 }}>· MTB EAST</span>
    </div>
  );
}

function SplashScreen() {
  // Placeholder mark — swap for the real MTB East mole/beaver logo asset when available.
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#161616", border: "2px solid #1B8A82", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#E8792B" }} />
      </div>
      <div className="display" style={{ fontSize: 15, letterSpacing: "0.1em", color: "#B9BDB8", marginBottom: 6 }}>MTB EAST</div>
      <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1, margin: 0, color: "#E8792B", textAlign: "center" }}>SOFA TO<br />SINGLETRACK</h1>
    </div>
  );
}

const FAQS = [
  { q: "I don't have a mountain bike — can I still start?", a: "Yes. Any bike you can ride safely off a smooth path on is fine to begin with. You don't need mountain bike specific kit for the early weeks." },
  { q: "What if a session feels too hard or too easy?", a: "Log it honestly — the coach note adjusts your next session based on how it felt. There's no wrong answer, and nothing bad happens if a session is tough." },
  { q: "What happens if I miss a session?", a: "Nothing bad. Tap skip and carry on to the next one. Missing the odd session is completely normal and won't reset your progress." },
  { q: "Do I need to be fit already?", a: "No — the whole point of the programme is to build fitness gradually from wherever you're starting. Early sessions are deliberately gentle." },
  { q: "Is this a race training plan?", a: "No. It's a plan to get you riding regularly. Racing is offered as an optional next step at the end, never a requirement." },
  { q: "What if I don't want to race at the end?", a: "That's completely fine — plenty of riders use the programme just to build a lasting cycling habit. You'll get other suggestions instead, like local routes and clubs." },
  { q: "What kit do I actually need?", a: "A helmet is the one non-negotiable. Comfortable clothing you can move in and a water bottle cover the rest for now." },
  { q: "Can I do the sessions on a turbo trainer or gym bike?", a: "Most sessions have a trainer/gym bike alternative built in — look for the \"Trail / Trainer\" toggle on each session." },
  { q: "Can I choose which days I ride?", a: "Yes — during setup you pick 2 or 3 days a week and exactly which ones, so it fits round work, family or weekend-only availability." },
];

function FAQSection() {
  const [open, setOpen] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? FAQS : FAQS.slice(0, 3);
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginTop: 16, border: "1px solid #2b2b2b", position: "relative", zIndex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Common questions</div>
      <div style={{ position: "relative" }}>
        {visible.map((f, i) => (
          <div key={i} style={{ borderBottom: i < visible.length - 1 ? "1px solid #2b2b2b" : "none" }}>
            <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", color: "#F4F3EF", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>{f.q}</span>
              <span style={{ color: "#E8792B", fontSize: 16, flexShrink: 0 }}>{open === i ? "–" : "+"}</span>
            </button>
            {open === i && <p style={{ margin: "0 0 12px", fontSize: 13, color: "#B9BDB8", lineHeight: 1.5 }}>{f.a}</p>}
          </div>
        ))}
        {!expanded && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 36, background: "linear-gradient(to bottom, rgba(22,22,22,0), #161616)", pointerEvents: "none" }} />
        )}
      </div>
      <button onClick={() => setExpanded((e) => !e)} style={{ width: "100%", textAlign: "center", background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: "10px 0 0" }}>
        {expanded ? "Show less ↑" : `Read more (${FAQS.length - 3} more) ↓`}
      </button>
    </div>
  );
}

const GENERIC_COACH_FALLBACK = "Nice work getting out there — keep it up and see you at the next session.";

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

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

function weeksBetween(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return Math.max(4, Math.min(16, Math.round(days / 7)));
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function MonthCalendar({ weeks, sessionLog, adHocLog, programStart, totalRidesLogged, totalSessions, badges }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [previewKey, setPreviewKey] = useState(null);

  const sessionsByDate = {};
  weeks.forEach((w) => {
    w.sessions.forEach((s, i) => {
      const key = `${w.n}-${i}`;
      const feeling = sessionLog[key];
      const status = feeling === undefined ? "upcoming" : feeling === "Didn't get to it" ? "skipped" : "done";
      const d = sessionDate(programStart, w.n, s.day);
      sessionsByDate[dateKey(d)] = { status, name: s.name, detail: s.detail, mins: s.mins };
    });
  });
  const adHocByDate = {};
  adHocLog.forEach((r) => {
    const k = dateKey(new Date(r.at));
    adHocByDate[k] = (adHocByDate[k] || 0) + 1;
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your calendar</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#F4F3EF" }}>{totalRidesLogged}/{totalSessions} sessions logged</div>
      </div>

      {badges.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 4px" }}>
          {badges.map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 4, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 14, padding: "3px 8px" }}>
              <span style={{ fontSize: 11 }}>🏅</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#B9BDB8" }}>{b}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 8px" }}>
        <button onClick={() => setMonthOffset((m) => Math.max(minOffset, m - 1))} disabled={monthOffset <= minOffset} style={monthNavBtn}>‹</button>
        <div className="display" style={{ fontSize: 13, color: "#F4F3EF" }}>{monthLabel}</div>
        <button onClick={() => setMonthOffset((m) => Math.min(maxOffset, m + 1))} disabled={monthOffset >= maxOffset} style={monthNavBtn}>›</button>
      </div>

      <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 700, color: "#5c5f5c" }}>{d}</div>
        ))}
        <div style={{ width: 34, textAlign: "center", fontSize: 9, fontWeight: 700, color: "#5c5f5c" }}>TIME</div>
      </div>

      {rows.map((row, ri) => {
        const rowMins = row.reduce((sum, d) => {
          if (!d) return sum;
          const info = sessionsByDate[dateKey(d)];
          return sum + (info && info.status === "done" ? (info.mins || 0) : 0);
        }, 0);
        return (
          <div key={ri} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3 }}>
            {row.map((d, ci) => {
              if (!d) return <div key={ci} style={{ flex: 1 }} />;
              const k = dateKey(d);
              const info = sessionsByDate[k];
              const hasAdHoc = adHocByDate[k];
              const isToday = k === todayKey;
              const isPreviewing = previewKey === k;
              return (
                <div key={ci} style={{ flex: 1, position: "relative" }}>
                  <div
                    onMouseEnter={() => info && setPreviewKey(k)}
                    onMouseLeave={() => setPreviewKey((cur) => (cur === k ? null : cur))}
                    onClick={() => info && setPreviewKey((cur) => (cur === k ? null : k))}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "3px 0", borderRadius: 6, border: isToday ? "1px solid #E8792B" : "1px solid transparent", cursor: info ? "pointer" : "default" }}
                  >
                    <span style={{ fontSize: 11, color: "#F4F3EF" }}>{d.getDate()}</span>
                    <div style={{ display: "flex", gap: 2 }}>
                      {info && (
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: info.status === "skipped" ? "transparent" : dotColor[info.status], border: info.status === "skipped" ? "1px solid #5c5f5c" : "none" }} />
                      )}
                      {hasAdHoc && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#1B8A82", opacity: 0.5 }} />}
                    </div>
                  </div>
                  {isPreviewing && info && (
                    <div style={{ position: "absolute", zIndex: 20, bottom: "100%", left: "50%", transform: "translateX(-50%)", marginBottom: 6, width: 150, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 8, padding: "8px 10px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "#E8792B", marginBottom: 2 }}>{info.name}</div>
                      <div style={{ fontSize: 10.5, color: "#B9BDB8", lineHeight: 1.4 }}>{info.detail}</div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ width: 34, textAlign: "center", fontSize: 10.5, fontWeight: 600, color: rowMins > 0 ? "#1B8A82" : "#3a3d3a" }}>
              {rowMins > 0 ? `${rowMins}m` : "–"}
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 10.5, color: "#B9BDB8", marginTop: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B8A82", display: "inline-block" }} /> Done</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", border: "1px solid #5c5f5c", display: "inline-block" }} /> Skipped</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E8792B", display: "inline-block" }} /> Upcoming</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1B8A82", opacity: 0.5, display: "inline-block" }} /> Extra ride</span>
      </div>
      <p style={{ fontSize: 10, color: "#5c5f5c", margin: "8px 0 0" }}>Tap or hover a session dot for a quick preview.</p>
    </div>
  );
}

const monthNavBtn = { background: "none", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, width: 28, height: 28, fontSize: 16, cursor: "pointer", lineHeight: 1 };

const FEELINGS = ["Easier than expected", "About right", "Tougher than expected", "Had to stop early"];

const STORAGE_KEY = "sofaToSingletrack:progress";

export default function SofaToSingletrack() {
  const [stage, setStage] = useState("welcome");
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState({ name: "", experience: "none", planType: null, raceId: null, months: null, sessionsPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] });
  const [step, setStep] = useState(0);
  const [weeks, setWeeks] = useState(buildProgramme(8, ["Tue", "Thu", "Sat"]));
  const [coachNote, setCoachNote] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [programStart] = useState(new Date());
  const [mode, setMode] = useState({});
  const [bikeCheckDone, setBikeCheckDone] = useState(false);
  const [fitnessConfirmed, setFitnessConfirmed] = useState(false);
  const [badges, setBadges] = useState([]);
  const [sessionLog, setSessionLog] = useState({}); // "wN-i" -> feeling
  const [lastFeeling, setLastFeeling] = useState(null);
  const [checkinTarget, setCheckinTarget] = useState(null);
  const [adHocLog, setAdHocLog] = useState([]); // [{ week, at }]
  const [notifAsked, setNotifAsked] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("17:30");
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.profile) setProfile(saved.profile);
        if (saved.weeks) setWeeks(saved.weeks);
        if (saved.sessionLog) setSessionLog(saved.sessionLog);
        if (saved.badges) setBadges(saved.badges);
        if (Array.isArray(saved.adHocLog)) setAdHocLog(saved.adHocLog);
        if (typeof saved.notifAsked === "boolean") setNotifAsked(saved.notifAsked);
        if (typeof saved.notifEnabled === "boolean") setNotifEnabled(saved.notifEnabled);
        if (saved.reminderTime) setReminderTime(saved.reminderTime);
        if (typeof saved.lastFeeling !== "undefined") setLastFeeling(saved.lastFeeling);
        if (saved.stage && saved.stage !== "checkin") setStage(saved.stage);
      }
    } catch (e) {
      // no saved progress yet, or storage unavailable
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      const payload = JSON.stringify({ profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, stage });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (e) {
      // storage unavailable (private browsing, quota) — progress just won't persist
    }
  }, [loaded, profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, stage]);

  useEffect(() => { if (stage === "onboarding" && nameRef.current) nameRef.current.focus(); }, [stage, step]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 3000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { const t = setTimeout(() => setShowSplash(false), 1600); return () => clearTimeout(t); }, []);

  const allSessions = weeks.flatMap((w) =>
    w.sessions.map((s, i) => ({ key: `${w.n}-${i}`, weekN: w.n, idx: i, session: s, weekTitle: w.title }))
  );
  const unlogged = allSessions.filter((s) => !(s.key in sessionLog));
  const nextSession = unlogged[0] || null;
  const upcoming = unlogged.slice(1, 3);
  const currentWeekN = nextSession ? nextSession.weekN : weeks[weeks.length - 1].n;
  const programmeComplete = unlogged.length === 0;

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

  const awardBadge = (label) => setBadges((prev) => (prev.includes(label) ? prev : [...prev, label]));

  const checkWeekBadges = (log) => {
    weeks.forEach((w) => {
      const allLogged = w.sessions.every((_, i) => `${w.n}-${i}` in log);
      if (!allLogged) return;
      if (w.n === 1) awardBadge("First week done");
      if (w.n === 4) awardBadge("First month done");
      if (w.n === 8) awardBadge("Two months done");
      if (w.n === 12) awardBadge("Three months done");
    });
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
    setStage("dashboard");
    const first = weeks[0].sessions[0];
    const welcomeTemplate = COACH_SCENARIOS.welcome || "Welcome aboard, {name} — your first session, {sessionName}, is a gentle one on purpose.";
    setWelcomeNote(fillTemplate(welcomeTemplate, { name: profile.name || "rider", sessionName: first.name }));
  };

  const openCheckin = (target) => {
    setCheckinTarget(target);
    setStage("checkin");
  };

  const logSession = (target, feeling, { navigate = true } = {}) => {
    const isFirstEver = Object.keys(sessionLog).length === 0;
    const newLog = { ...sessionLog, [target.key]: feeling };
    setSessionLog(newLog);
    setLastFeeling(feeling === "Didn't get to it" ? lastFeeling : feeling);
    checkWeekBadges(newLog);
    if (isFirstEver && !notifAsked) setShowNotifPrompt(true);

    if (!navigate) {
      setToast(feeling === "Didn't get to it" ? "No worries — logged as skipped." : "Session logged.");
      return;
    }

    setCoachNote(getCoachNote(target, feeling));
  };

  const submitCheckin = (feeling) => checkinTarget && logSession(checkinTarget, feeling, { navigate: true });
  const quickSkip = (target) => logSession(target, "Didn't get to it", { navigate: false });

  const backToDashboard = () => {
    setCheckinTarget(null);
    setCoachNote("");
    setExplainerOpen(false);
    setStage("dashboard");
  };

  const logAdHocRide = () => {
    setAdHocLog((prev) => [...prev, { week: currentWeekN, at: Date.now() }]);
    setToast("Nice one — ride logged.");
  };

  const dismissNotifPrompt = (enable) => {
    setNotifEnabled(enable);
    setNotifAsked(true);
    setShowNotifPrompt(false);
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

  const selectedRace = MTB_EAST_RACES.find((r) => r.id === profile.raceId);

  const adjustTag = (feeling) => {
    if (feeling === "Tougher than expected" || feeling === "Had to stop early") return "Take it easier — adjusted after your last session";
    if (feeling === "Easier than expected") return "Pushed a little more — adjusted after your last session";
    return null;
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#000000", color: "#F4F3EF", minHeight: "100vh", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fjalla+One&family=Inter:wght@400;500;600;700&display=swap');
        .display { font-family: 'Fjalla One', sans-serif; letter-spacing: 0.04em; }
        button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #E8792B; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>
      {showSplash && <SplashScreen />}
      <TopoBackground />
      <div style={{ position: "relative", zIndex: 1 }}>
        <AppHeader />

        {toast && (
          <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", background: "#1B8A82", color: "#fff", padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, zIndex: 10, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
            {toast}
          </div>
        )}

      {stage === "welcome" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px 40px" }}>
          <div className="display" style={{ fontSize: 12, color: "#1B8A82", marginBottom: 8 }}>AN MTB EAST PROGRAMME</div>
          <h1 className="display" style={{ fontSize: 40, lineHeight: 1.05, margin: "0 0 16px", color: "#E8792B" }}>SOFA TO<br />SINGLETRACK</h1>
          <p style={{ fontSize: 16, lineHeight: 1.5, color: "#F4F3EF", marginBottom: 28 }}>
            A simple plan to get you riding regularly — 2 or 3 sessions a week, on days that work for you, time-based
            so you don't need a fancy bike computer. Racing is entirely optional, and never the point.
          </p>
          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 28, border: "1px solid #2b2b2b" }}>
            <ContourProgress weeks={buildProgramme(8, ["Tue", "Thu", "Sat"])} currentWeek={1} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#B9BDB8", marginTop: 4 }}>
              <span>Week 1</span><span>Riding regularly</span>
            </div>
          </div>
          <button onClick={() => setStage("onboarding")} style={navBtn}>Start your programme</button>
          <p style={{ fontSize: 11.5, color: "#7A7E79", lineHeight: 1.5, marginTop: 18 }}>
            Training and fuelling notes are general guidance from a fixed content library, not personalised medical, dietetic or coaching advice.
            Mountain biking carries a risk of injury — ride within your ability, and speak to a GP before starting if you have any health concerns.
          </p>
          <FAQSection />
        </div>
      )}

      {stage === "onboarding" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 12, color: "#1B8A82", marginBottom: 20 }}>GET STARTED</div>

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
              <p style={{ fontSize: 12.5, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either works — pick whatever actually fits your week.</p>
              <button onClick={() => { setSessionsPerWeek(3); setStep(3); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 3 ? "#E8792B" : "#2b2b2b" }}>3 days a week (recommended)</button>
              <button onClick={() => { setSessionsPerWeek(2); setStep(3); }} style={{ ...choiceBtn, borderColor: profile.sessionsPerWeek === 2 ? "#E8792B" : "#2b2b2b" }}>2 days a week — e.g. weekends only</button>
              <button onClick={() => setStep(1)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 3 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Which {profile.sessionsPerWeek} days work best?</label>
              <p style={{ fontSize: 12.5, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Pick exactly {profile.sessionsPerWeek} — tap to select or deselect.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                {WEEKDAYS.map((day) => {
                  const selected = profile.chosenDays.includes(day);
                  const disabled = !selected && profile.chosenDays.length >= profile.sessionsPerWeek;
                  return (
                    <button key={day} onClick={() => toggleDay(day)} disabled={disabled}
                      style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid " + (selected ? "#E8792B" : "#2b2b2b"), background: selected ? "#E8792B" : "#161616", color: selected ? "#fff" : disabled ? "#5c5f5c" : "#F4F3EF", fontSize: 14, fontWeight: 600, cursor: disabled ? "default" : "pointer" }}>
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
              <p style={{ fontSize: 12.5, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Either way, the goal is the same — riding regularly. Racing is just an optional bonus if you fancy it.</p>
              <button onClick={() => setStep(5)} style={{ ...choiceBtn, borderColor: profile.planType === "race" ? "#E8792B" : "#2b2b2b" }}>I'd like the option of a race at the end</button>
              <button onClick={() => setStep(6)} style={{ ...choiceBtn, borderColor: profile.planType === "months" ? "#E8792B" : "#2b2b2b" }}>No pressure — just build a riding habit</button>
              <button onClick={() => setStep(3)} style={backBtn}>Back</button>
            </div>
          )}

          {step === 5 && (
            <div>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Choose your target round</label>
              <p style={{ fontSize: 12.5, color: "#B9BDB8", marginTop: 0, marginBottom: 14 }}>Example fixtures — swap in the real season calendar.</p>
              {MTB_EAST_RACES.map((race) => (
                <button key={race.id} onClick={() => chooseRace(race)} style={{ ...choiceBtn, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span><strong>{race.name}</strong> — {race.venue}</span>
                  <span style={{ color: "#B9BDB8", fontSize: 13 }}>{new Date(race.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Your programme</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                  {weeks.length} weeks, {profile.sessionsPerWeek} sessions a week ({profile.chosenDays.join("/")}){profile.planType === "race" && selectedRace ? <> — with the option to race at <strong>{selectedRace.name}</strong>, {selectedRace.venue}</> : <> — no race pressure, just building the habit</>}.
                </p>
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 14, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Before your first ride</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#0d0d0d", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#1B8A82", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ width: 0, height: 0, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "10px solid #fff", marginLeft: 3 }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Quick bike safety check (2 min)</div>
                    <div style={{ fontSize: 12.5, color: "#B9BDB8" }}>Brakes, tyres, quick releases — before you head out</div>
                  </div>
                </div>
                <button onClick={() => setBikeCheckDone(true)} style={{ width: "100%", padding: "10px 0", background: bikeCheckDone ? "#1B8A82" : "#0d0d0d", color: bikeCheckDone ? "#fff" : "#F4F3EF", border: "1px solid " + (bikeCheckDone ? "#1B8A82" : "#2b2b2b"), borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                  {bikeCheckDone ? "✓ Bike check watched" : "I've watched it"}
                </button>
              </div>

              <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Before you start</div>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={fitnessConfirmed} onChange={(e) => setFitnessConfirmed(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: "#F4F3EF" }}>
                    I confirm I'm reasonably fit and well enough to take part in this kind of physical activity. If I'm unsure, I'll check with a doctor before starting.
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

          <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Week {currentWeekN} of {weeks.length}
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: "#F4F3EF" }}>
              {welcomeNote || `Nice and steady, ${profile.name || "rider"} — every session counts.`}
            </p>
          </div>

          {programmeComplete ? (
            <div>
              <div style={{ background: "#E8792B", borderRadius: 12, padding: "20px", textAlign: "center", color: "#fff", marginBottom: 16 }}>
                <div className="display" style={{ fontSize: 18, marginBottom: 6 }}>YOU'RE A REGULAR RIDER NOW</div>
                <p style={{ margin: 0, fontSize: 14 }}>That's the real win. Racing from here is entirely optional.</p>
              </div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 12, border: "1px solid #2b2b2b" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Fancy trying a race?</div>
                <p style={{ fontSize: 13, color: "#B9BDB8", margin: "0 0 10px", lineHeight: 1.4 }}>
                  {selectedRace ? <>You could line up at <strong>{selectedRace.name}</strong>, {selectedRace.venue}.</> : "There's a full MTB East fixture list you could dip into whenever you're ready."}
                  {" "}You don't need to compete to come along — plenty of riders spectate at a race first.
                </p>
                <button style={{ ...navBtn, marginBottom: 8 }}>See the race calendar</button>
                <button style={{ background: "none", border: "1px solid #E8792B", color: "#E8792B", borderRadius: 10, width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Talk to a coach about racing</button>
              </div>
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", border: "1px solid #2b2b2b" }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Just want to keep riding?</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "#F4F3EF", lineHeight: 1.7 }}>
                  <li>Keep logging rides whenever you get out — no plan required</li>
                  <li>Find local routes and clubs via British Cycling</li>
                  <li>Come watch an MTB East race — no entry needed, just turn up</li>
                </ul>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 14, border: "2px solid #E8792B" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Next up — {nextSession.session.day}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{nextSession.session.name}</div>
                  {MICRO_EXPLAINERS[nextSession.session.name] && (
                    <button onClick={() => setExplainerOpen((v) => !v)} aria-label="Why this session?" style={{ width: 20, height: 20, borderRadius: "50%", background: "none", border: "1px solid #B9BDB8", color: "#B9BDB8", fontSize: 12, fontWeight: 700, cursor: "pointer", lineHeight: "18px", padding: 0 }}>?</button>
                  )}
                </div>
                {explainerOpen && MICRO_EXPLAINERS[nextSession.session.name] && (
                  <p style={{ fontSize: 12.5, color: "#B9BDB8", background: "#0d0d0d", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px", lineHeight: 1.4 }}>
                    {MICRO_EXPLAINERS[nextSession.session.name]}
                  </p>
                )}
                {adjustTag(lastFeeling) && (
                  <div style={{ display: "inline-block", background: "#0d0d0d", color: "#1B8A82", fontSize: 11, fontWeight: 600, borderRadius: 6, padding: "3px 8px", marginBottom: 8 }}>
                    {adjustTag(lastFeeling)}
                  </div>
                )}
                <p style={{ fontSize: 14, color: "#F4F3EF", lineHeight: 1.5, margin: "4px 0 12px" }}>
                  {mode[nextSession.key] === "trainer" && nextSession.session.trainerAlt ? nextSession.session.trainerAlt : nextSession.session.detail}
                </p>
                {nextSession.session.trainerAlt && (
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {["outdoor", "trainer"].map((m) => (
                      <button key={m} onClick={() => setMode({ ...mode, [nextSession.key]: m })}
                        style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 5, border: "1px solid " + ((mode[nextSession.key] || "outdoor") === m ? "#1B8A82" : "#2b2b2b"), background: (mode[nextSession.key] || "outdoor") === m ? "#1B8A82" : "#0d0d0d", color: (mode[nextSession.key] || "outdoor") === m ? "#fff" : "#B9BDB8", cursor: "pointer" }}>
                        {m === "outdoor" ? "Outdoor / Trail" : "Indoor / Gym or trainer bike"}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0d0d0d", borderRadius: 8, padding: "10px 12px", marginBottom: 14, border: "1px dashed #2b2b2b" }}>
                  <span style={{ fontSize: 18 }}>🎥</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF" }}>Video demo — coming soon</div>
                    <div style={{ fontSize: 11, color: "#7A7E79" }}>Real footage from your coach will go here</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => openCheckin(nextSession)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Log this session</button>
                  <button onClick={() => downloadSessionICS(nextSession.session, nextSession.weekN, nextSession.weekTitle, programStart)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>+ Cal</button>
                  <button onClick={() => quickSkip(nextSession)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>Skip</button>
                </div>
              </div>

              {upcoming.length > 0 && (
                <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Coming up</div>
                  {upcoming.map((s, i) => (
                    <div key={s.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: i < upcoming.length - 1 ? 10 : 0 }}>
                      <div className="display" style={{ fontSize: 12, color: "#E8792B", minWidth: 30 }}>{s.session.day}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{s.session.name}</div>
                        <div style={{ fontSize: 12.5, color: "#B9BDB8" }}>{s.session.detail}</div>
                      </div>
                      <button onClick={() => quickSkip(s)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#7A7E79", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer", height: "fit-content" }}>Skip</button>
                    </div>
                  ))}
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
            badges={badges}
          />

          {streakWeeks > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#E8792B", borderRadius: 20, padding: "6px 12px" }}>
                <span style={{ fontSize: 13 }}>🔥</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>{streakWeeks} week streak</span>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button style={{ flex: 1, background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>💬 Chat with a coach</button>
            <button style={{ flex: 1, background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>📅 MTB East race calendar</button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, padding: "10px 12px", marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF" }}>Been out on your bike off-plan?</div>
              <div style={{ fontSize: 11, color: "#B9BDB8" }}>Any ride counts — not just the scheduled ones</div>
            </div>
            <button onClick={logAdHocRide} style={{ background: "#1B8A82", border: "none", color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Log a ride</button>
          </div>

          <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <ContourProgress weeks={weeks} currentWeek={currentWeekN} />
          </div>

          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fuelling tip</div>
            <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>{NUTRITION_TIPS[tipIndex]}</p>
            <button onClick={() => setTipIndex((i) => (i + 1) % NUTRITION_TIPS.length)} style={{ background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0 }}>Next tip →</button>
          </div>

          <FAQSection />
        </div>
      )}

      {stage === "checkin" && checkinTarget && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 12, color: "#1B8A82", marginBottom: 8 }}>HOW DID IT GO?</div>
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
                <div style={{ fontSize: 12, fontWeight: 700, color: "#E8792B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Coach note</div>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, minHeight: 20 }}>{coachNote}</p>
              </div>

              {showNotifPrompt && (
                <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Want a reminder for your sessions?</div>
                  <p style={{ fontSize: 12.5, color: "#B9BDB8", margin: "0 0 12px", lineHeight: 1.4 }}>
                    Totally optional — pick one time that works, and we'll nudge you on session days. You can turn this off anytime.
                  </p>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: "#F4F3EF" }}>Remind me at</span>
                    <input type="time" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} style={{ background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => dismissNotifPrompt(true)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Yes, remind me</button>
                    <button onClick={() => dismissNotifPrompt(false)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 14px", fontSize: 13, cursor: "pointer" }}>No thanks</button>
                  </div>
                </div>
              )}

              <button onClick={backToDashboard} style={navBtn}>Back to home</button>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

const navBtn = { width: "100%", padding: "14px 0", background: "#1B8A82", color: "#FFFFFF", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer", marginBottom: 10 };
const backBtn = { width: "100%", padding: "12px 0", background: "none", color: "#B9BDB8", border: "none", fontSize: 14, cursor: "pointer" };
const choiceBtn = { display: "block", width: "100%", textAlign: "left", padding: "14px 16px", marginBottom: 10, background: "#161616", border: "1.5px solid #2b2b2b", color: "#F4F3EF", borderRadius: 10, fontSize: 15, cursor: "pointer" };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #2b2b2b", background: "#161616", color: "#F4F3EF", fontSize: 16, marginBottom: 20, boxSizing: "border-box" };
