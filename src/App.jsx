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

function InstallPrompt({ deferredPrompt, onInstall, isIOS, isStandalone }) {
  if (isStandalone) return null;
  if (!deferredPrompt && !isIOS) return null;
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 16, border: "1px solid #2b2b2b", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>Install this app</div>
        <div style={{ fontSize: 12, color: "#B9BDB8", lineHeight: 1.4 }}>
          {isIOS ? <>Tap the Share icon, then "Add to Home Screen".</> : "Add it to your home screen for a full-screen, offline-friendly experience."}
        </div>
      </div>
      {deferredPrompt && (
        <button onClick={onInstall} style={{ background: "#1B8A82", border: "none", color: "#fff", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Install</button>
      )}
    </div>
  );
}

function AppHeader() {
  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 20px", borderBottom: "1px solid #1c1c1c" }}>
      <img src="/brand/header-mark.png" alt="" width={24} height={24} style={{ display: "block" }} />
      <span className="display" style={{ fontSize: 13, letterSpacing: "0.08em", color: "#F4F3EF" }}>SOFA TO SINGLETRACK</span>
      <span style={{ fontSize: 10, color: "#B9BDB8", fontWeight: 600 }}>· MTB EAST</span>
    </div>
  );
}

function SplashScreen() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <img src="/brand/logo-full.png" alt="MTB East" width={160} height={160} style={{ marginBottom: 20 }} />
      <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1, margin: 0, color: "#E8792B", textAlign: "center" }}>SOFA TO<br />SINGLETRACK</h1>
    </div>
  );
}

const FAQS = [
  { q: "Do I need to already own a mountain bike?", a: "No. You can start by using any safe, working bike you have access to. A mountain bike will make off-road riding more comfortable, but the early sessions can be done on paths, roads, and gentle trails." },
  { q: "I have not ridden a bike in years. Is this really for me?", a: "Absolutely. The programme is designed for people starting from zero, returning after a long break, or rebuilding confidence. You begin gently and progress in small, manageable steps." },
  { q: "What if I cannot ride very far yet?", a: "That is exactly where you are meant to start. Early rides may be short, with plenty of recovery and walking breaks if needed. There is no expectation to keep up with experienced riders." },
  { q: "Do I need to be fit before I begin?", a: "No. The goal is to help you become fitter over time. You only need to be comfortable starting at your own level and taking things gradually." },
  { q: "What does \"singletrack\" mean?", a: "Singletrack is a narrow off-road trail, usually wide enough for one rider at a time. It can be a smooth woodland path, dirt, gravel, roots, or gentle twists. You will build towards it rather than being sent straight onto technical trails." },
  { q: "Is mountain biking dangerous?", a: "Like any activity, it has risks, but you can reduce them a lot by learning gradually, wearing a helmet, checking your bike, choosing suitable trails, and knowing that it is always fine to slow down or walk a section." },
  { q: "What if I am nervous about falling off?", a: "That is very normal. The app should teach confidence skills progressively: braking, balance, cornering, getting on and off the bike, and choosing a safe line. Walking a feature is always a smart option, never a failure." },
  { q: "Do I have to ride down steep hills or over jumps?", a: "No. You choose your own challenge level. There are no jumps, drops, or steep descents required to complete the programme. Many riders enjoy mountain biking for fitness, fresh air, and social rides without wanting technical features." },
  { q: "What equipment do I need to get started?", a: "A safe bike, a properly fitted helmet, comfortable clothing, water, and something to repair a puncture are the basics. You do not need expensive shoes, clothing, suspension, or race equipment to begin." },
  { q: "What type of mountain bike should I buy?", a: "Do not rush into buying one. If you decide to, a comfortable hardtail mountain bike from a reputable shop is often a great first choice." },
  { q: "Can I do the programme on an e-bike?", a: "Yes, provided it is legal and suitable for the terrain where you ride. An e-bike can make hills and longer rides feel more approachable while still building skills, confidence, and fitness. Sessions can be based on time and effort, not only distance." },
  { q: "What if I need to stop, repeat a week, or miss a few sessions?", a: "That is completely fine. Life happens. You can repeat sessions, take extra rest, or resume when you are ready. Progress is not ruined by a missed week." },
  { q: "How much time will I need each week?", a: "The programme should fit around real life. A beginner-friendly plan might include two or three short rides per week, if you are struggling, you can note this when logging a ride and the system will reduce the level of workout in the next session." },
  { q: "Where can I safely ride?", a: "You do not need mountains on your doorstep. Start with quiet cycle paths, parks, bridleways, forest roads, towpaths, and easy local trails where cycling is permitted. The app should clearly explain trail access, signs, and local etiquette." },
  { q: "What if I do not have anyone to ride with?", a: "You can complete the whole programme solo. It can also help you find beginner-friendly group rides, bike shops, clubs, or event communities when you feel ready. Riding with others is optional, not a requirement." },
  { q: "Do I have to race at the end?", a: "No. Racing is one possible destination, not the purpose of the programme. Your finish line might be feeling fitter, exploring local trails, riding with friends, commuting, or simply enjoying being outside." },
  { q: "What is an MTB \"fun race,\" and can a beginner enter one?", a: "A fun race is an informal event where the emphasis is on completing the course and enjoying the day. Riders of mixed experience. You can aim for one when it feels exciting, or come along to watch first." },
  { q: "Can I attend an event just to watch and see what it is like?", a: "Definitely. Watching is a brilliant, low-pressure way to learn what mountain biking events feel like, meet riders, ask questions, and decide whether you would enjoy taking part later. You do not need to earn your place in the community." },
  { q: "What if I decide I never want to race or ride difficult trails?", a: "You have still succeeded. Sofa to Singletrack is about opening up cycling, not pushing everyone into the same outcome. If you finish fitter, happier, more confident on a bike, and able to enjoy the rides you choose, the programme has done its job." },
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

function TrophyCase({ badges }) {
  return (
    <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Trophy case</div>
      {badges.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#7A7E79", lineHeight: 1.5 }}>Keep going — your first trophy unlocks after your first week done.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {badges.map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0d0d0d", border: "1px solid #2b2b2b", borderRadius: 10, padding: "8px 12px" }}>
              <span style={{ fontSize: 16 }}>🏆</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF" }}>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
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

function weekNumberForDate(programStart, date) {
  const start = new Date(programStart);
  start.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

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
      sessionsByDate[dateKey(d)] = { status, name: s.name, detail: s.detail, mins: sessionDurations[key] ?? s.mins };
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Your calendar</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#F4F3EF" }}>{totalRidesLogged}/{totalSessions} sessions logged</div>
      </div>

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
                    <span style={{ fontSize: 11, color: "#F4F3EF" }}>{d.getDate()}</span>
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
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#E8792B", marginBottom: 2 }}>{info.name}</div>
                          <div style={{ fontSize: 10.5, color: "#B9BDB8", lineHeight: 1.4 }}>{info.detail}</div>
                        </>
                      )}
                      {hasAdHoc && adHocForDay.map((r, i) => (
                        <div key={i} style={{ marginTop: info || i > 0 ? 6 : 0 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: "#FFD400" }}>Extra ride{r.mins ? ` — ${r.mins}m` : ""}</div>
                          {r.feeling && <div style={{ fontSize: 10.5, color: "#B9BDB8", lineHeight: 1.4 }}>{r.feeling}</div>}
                        </div>
                      ))}
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
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FFD400", display: "inline-block" }} /> Extra ride</span>
      </div>
      <p style={{ fontSize: 10, color: "#5c5f5c", margin: "8px 0 0" }}>Tap or hover a session dot for a quick preview.</p>
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

export default function SofaToSingletrack() {
  const [stage, setStage] = useState("welcome");
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState({ name: "", experience: "none", planType: null, raceId: null, months: null, sessionsPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] });
  const [step, setStep] = useState(0);
  const [weeks, setWeeks] = useState(buildProgramme(8, ["Tue", "Thu", "Sat"]));
  const [coachNote, setCoachNote] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [programStart, setProgramStart] = useState(new Date());
  const [mode, setMode] = useState({});
  const [bikeCheckDone, setBikeCheckDone] = useState(false);
  const [fitnessConfirmed, setFitnessConfirmed] = useState(false);
  const [badges, setBadges] = useState([]);
  const [sessionLog, setSessionLog] = useState({}); // "wN-i" -> feeling
  const [lastFeeling, setLastFeeling] = useState(null);
  const [checkinTarget, setCheckinTarget] = useState(null);
  const [adHocLog, setAdHocLog] = useState([]); // [{ week, at }]
  const [sessionDurations, setSessionDurations] = useState({}); // "wN-i" -> actual mins, from the ride timer
  const [activeTimer, setActiveTimer] = useState(null); // { key, startedAt } while a ride timer is running
  const [nowTick, setNowTick] = useState(Date.now());
  const [notifAsked, setNotifAsked] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState("17:30");
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
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
  const [adHocMins, setAdHocMins] = useState("");
  const [adHocFeeling, setAdHocFeeling] = useState("About right");
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const nameRef = useRef(null);
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
        if (saved.programStart) setProgramStart(new Date(saved.programStart));
        if (saved.sessionDurations) setSessionDurations(saved.sessionDurations);
        if (saved.activeTimer) setActiveTimer(saved.activeTimer);
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
      const payload = JSON.stringify({ profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart: programStart.toISOString(), sessionDurations, activeTimer, stage });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (e) {
      // storage unavailable (private browsing, quota) — progress just won't persist
    }
  }, [loaded, profile, weeks, sessionLog, badges, adHocLog, notifAsked, notifEnabled, reminderTime, lastFeeling, programStart, sessionDurations, activeTimer, stage]);

  useEffect(() => { if (stage === "onboarding" && nameRef.current) nameRef.current.focus(); }, [stage, step]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), toastType === "trophy" ? 4200 : 3000); return () => clearTimeout(t); }, [toast, toastType]);
  useEffect(() => { const t = setTimeout(() => setShowSplash(false), 1600); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!activeTimer) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeTimer]);

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

    const hasOutdoorRide = allSessions.some((s) => log[s.key] && log[s.key] !== "Didn't get to it" && mode[s.key] !== "trainer");
    if (hasOutdoorRide) candidates.push("First outdoor ride");

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
    setStage("dashboard");
    const first = weeks[0].sessions[0];
    const welcomeTemplate = COACH_SCENARIOS.welcome || "Welcome aboard, {name} — your first session, {sessionName}, is a gentle one on purpose.";
    setWelcomeNote(fillTemplate(welcomeTemplate, { name: profile.name || "rider", sessionName: first.name }));
  };

  const openCheckin = (target) => {
    setCheckinTarget(target);
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

  const logSession = (target, feeling, { navigate = true } = {}) => {
    const isFirstEver = Object.keys(sessionLog).length === 0;
    const newLog = { ...sessionLog, [target.key]: feeling };
    setSessionLog(newLog);
    setLastFeeling(feeling === "Didn't get to it" ? lastFeeling : feeling);
    const justAwarded = checkAllBadges(newLog, adHocLog);
    if (isFirstEver && !notifAsked) setShowNotifPrompt(true);

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

  const startRideTimer = (target) => setActiveTimer({ key: target.key, startedAt: Date.now() });
  const cancelRideTimer = () => setActiveTimer(null);
  const finishRideTimer = () => {
    if (!activeTimer) return;
    const elapsedMins = Math.max(1, Math.round((Date.now() - activeTimer.startedAt) / 60000));
    const key = activeTimer.key;
    const priorBest = Math.max(0, ...Object.values(sessionDurations));
    setSessionDurations((prev) => ({ ...prev, [key]: elapsedMins }));
    setActiveTimer(null);
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

  const openAdHocForm = () => {
    setAdHocDate(dateKey(new Date()));
    setAdHocMins("");
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
    const justAwarded = checkAllBadges(sessionLog, newAdHocLog);
    if (justAwarded.length > 0) {
      celebrateTrophies(justAwarded);
    } else {
      showToast("Nice one — ride logged.");
    }
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
        @keyframes toastPop { 0% { transform: translateX(-50%) scale(0.85); opacity: 0; } 60% { transform: translateX(-50%) scale(1.06); opacity: 1; } 100% { transform: translateX(-50%) scale(1); opacity: 1; } }
        .toast-pop { animation: toastPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes confettiFall { 0% { transform: translateY(0) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(600deg); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>
      {showSplash && <SplashScreen />}
      <TopoBackground />
      <div style={{ position: "relative", zIndex: 1 }}>
        <AppHeader />

        {showConfetti && <Confetti key={confettiKey} />}

        {toast && (
          <div
            className={toastType === "trophy" ? "toast-pop" : undefined}
            style={{
              position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
              background: toastType === "trophy" ? "#E8792B" : "#1B8A82", color: "#fff",
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
          <InstallPrompt deferredPrompt={deferredPrompt} onInstall={handleInstallClick} isIOS={isIOS} isStandalone={isStandalone} />
          <p style={{ fontSize: 11.5, color: "#7A7E79", lineHeight: 1.5, marginTop: 18 }}>
            Training and fuelling notes are general guidance from a fixed content library, not personalised medical, dietetic or coaching advice.
            Mountain biking carries a risk of injury — ride within your ability, and speak to a GP before starting if you have any health concerns.
            Always wear a helmet when riding outside.
            No data about you is recorded or held by MTB East CIC — everything you enter is stored only on this device.
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

          {!programmeComplete && nextSession && (
            <div style={{ background: "#161616", borderRadius: 14, padding: "20px", marginBottom: 16, border: "2px solid #E8792B" }}>
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
                  {["outdoor", "trainer"].map((m) => {
                    const active = (mode[nextSession.key] || "outdoor") === m;
                    const activeColor = m === "outdoor" ? "#E8792B" : "#1B8A82";
                    return (
                      <button key={m} onClick={() => setMode({ ...mode, [nextSession.key]: m })}
                        style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", padding: "4px 10px", borderRadius: 5, border: "1px solid " + (active ? activeColor : "#2b2b2b"), background: active ? activeColor : "#0d0d0d", color: active ? "#fff" : "#B9BDB8", cursor: "pointer" }}>
                        {m === "outdoor" ? "Outdoor / Trail" : "Indoor / Gym or trainer bike"}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0d0d0d", borderRadius: 8, padding: "10px 12px", marginBottom: 14, border: "1px dashed #2b2b2b" }}>
                <span style={{ fontSize: 18 }}>🎥</span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF" }}>Video demo — coming soon</div>
                  <div style={{ fontSize: 11, color: "#7A7E79" }}>Real footage from your coach will go here</div>
                </div>
              </div>
              {activeTimer && activeTimer.key === nextSession.key ? (
                <div style={{ background: "#0d0d0d", borderRadius: 10, padding: "16px", marginBottom: 12, textAlign: "center", border: "1px solid rgb(102, 255, 0)" }}>
                  <div className="display" style={{ fontSize: 32, color: "#F4F3EF", marginBottom: 10 }}>{formatElapsed(nowTick - activeTimer.startedAt)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={finishRideTimer} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Finish ride</button>
                    <button onClick={cancelRideTimer} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => startRideTimer(nextSession)} style={{ ...navBtn, background: "rgb(102, 255, 0)", color: "#14171A" }}>▶ Start ride timer</button>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => openCheckin(nextSession)} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Log this session</button>
                <button onClick={() => downloadSessionICS(nextSession.session, nextSession.weekN, nextSession.weekTitle, programStart)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>+ Cal</button>
                <button onClick={() => quickSkip(nextSession)} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 12px", fontSize: 13, cursor: "pointer" }}>Skip</button>
              </div>
            </div>
          )}

          <div style={{ background: "#161616", borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1B8A82", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Week {currentWeekN} of {weeks.length}
            </div>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: "#F4F3EF" }}>
              {welcomeNote || `Nice and steady, ${profile.name || "rider"} — every session counts.`}
            </p>
            {lastWeekRideCount > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "#1B8A82", fontWeight: 600 }}>
                Last week: {lastWeekRideCount} ride{lastWeekRideCount === 1 ? "" : "s"} · {formatMinutes(lastWeekMinutes)} ridden
              </p>
            )}
          </div>

          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Your progress</div>
            <div style={{ maxWidth: 260, margin: "0 auto" }}>
              <SpeedoGauge pct={completionPct} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div className="display" style={{ fontSize: 20, color: "#E8792B" }}>{formatMinutes(totalMinutesRidden)}</div>
                <div style={{ fontSize: 10.5, color: "#B9BDB8", marginTop: 2 }}>Time ridden</div>
              </div>
              <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 10, padding: "12px 10px", textAlign: "center" }}>
                <div className="display" style={{ fontSize: 20, color: "#E8792B" }}>{longestStreakWeeks}</div>
                <div style={{ fontSize: 10.5, color: "#B9BDB8", marginTop: 2 }}>Best streak (weeks)</div>
              </div>
            </div>
          </div>

          <TrophyCase badges={badges} />

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
                <a href="https://www.mtbeast.co.uk" target="_blank" rel="noopener noreferrer" style={{ ...navBtn, marginBottom: 8, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>See the race calendar</a>
                <button onClick={() => setStage("coachQA")} style={{ background: "none", border: "1px solid #E8792B", color: "#E8792B", borderRadius: 10, width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Talk to a coach about racing</button>
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
            sessionDurations={sessionDurations}
          />

          <div style={{ background: "#161616", border: "1px solid #2b2b2b", borderRadius: 8, padding: adHocFormOpen ? "14px" : "10px 12px", marginBottom: 16 }}>
            {!adHocFormOpen ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF" }}>Been out on your bike off-plan?</div>
                  <div style={{ fontSize: 11, color: "#B9BDB8" }}>Any ride counts — not just the scheduled ones</div>
                </div>
                <button onClick={openAdHocForm} style={{ background: "#1B8A82", border: "none", color: "#fff", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Log a ride</button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F4F3EF", marginBottom: 10 }}>Log an extra ride</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 10.5, color: "#B9BDB8", marginBottom: 4 }}>Date</label>
                    <input type="date" value={adHocDate} max={dateKey(new Date())} onChange={(e) => setAdHocDate(e.target.value)}
                      style={{ width: "100%", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, padding: "8px", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 10.5, color: "#B9BDB8", marginBottom: 4 }}>Minutes</label>
                    <input type="number" inputMode="numeric" min="1" value={adHocMins} onChange={(e) => setAdHocMins(e.target.value)} placeholder="30"
                      style={{ width: "100%", background: "#0d0d0d", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 6, padding: "8px", fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                </div>
                <label style={{ display: "block", fontSize: 10.5, color: "#B9BDB8", marginBottom: 6 }}>How did it feel?</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {FEELINGS.map((f) => (
                    <button key={f} onClick={() => setAdHocFeeling(f)}
                      style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid " + (adHocFeeling === f ? "#1B8A82" : "#2b2b2b"), background: adHocFeeling === f ? "#1B8A82" : "#0d0d0d", color: adHocFeeling === f ? "#fff" : "#B9BDB8", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                      {f}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={submitAdHocRide} style={{ ...navBtn, marginBottom: 0, flex: 1 }}>Save ride</button>
                  <button onClick={cancelAdHocForm} style={{ background: "none", border: "1px solid #2b2b2b", color: "#B9BDB8", borderRadius: 10, padding: "0 14px", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {streakWeeks > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#E8792B", borderRadius: 20, padding: "6px 12px" }}>
                <span style={{ fontSize: 13 }}>🔥</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>{streakWeeks} week streak</span>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setStage("coachQA")} style={{ flex: 1, background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>💬 Contact a coach</button>
            <a href="https://www.mtbeast.co.uk" target="_blank" rel="noopener noreferrer" style={{ flex: 1, background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, textDecoration: "none", textAlign: "center", boxSizing: "border-box" }}>📅 MTB East race calendar</a>
          </div>

          <div style={{ background: "#161616", borderRadius: 12, padding: "18px 20px", marginBottom: 16, border: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#B9BDB8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fuelling tip</div>
            <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.5 }}>{NUTRITION_TIPS[tipIndex]}</p>
            <button onClick={() => setTipIndex((i) => (i + 1) % NUTRITION_TIPS.length)} style={{ background: "none", border: "none", color: "#E8792B", fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0 }}>Next tip →</button>
          </div>

          <FAQSection />

          <button onClick={handleShare} style={{ display: "block", width: "100%", textAlign: "center", background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 16 }}>📤 Know someone who'd like this? Share it</button>

          <a href="mailto:info@mtbeast.co.uk?subject=Sofa%20to%20Singletrack%20feedback" style={{ display: "block", textAlign: "center", background: "#161616", border: "1px solid #2b2b2b", color: "#F4F3EF", borderRadius: 8, padding: "10px 8px", fontSize: 12.5, fontWeight: 600, textDecoration: "none", marginTop: 10 }}>💡 Suggest a feature / report a bug</a>
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

      {stage === "coachQA" && (
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "40px 20px" }}>
          <div className="display" style={{ fontSize: 12, color: "#1B8A82", marginBottom: 8 }}>CONTACT A COACH</div>
          <h2 className="display" style={{ fontSize: 24, margin: "0 0 8px", color: "#E8792B" }}>WHAT WOULD HELP YOU MOST?</h2>
          <p style={{ fontSize: 13.5, color: "#B9BDB8", lineHeight: 1.5, marginBottom: 14 }}>
            This isn't live chat — it opens an email from your own address to the coaches, so they can reply directly and we can find out what riders actually want from us.
          </p>
          <div style={{ background: "#161616", borderRadius: 12, padding: "14px 16px", marginBottom: 20, border: "1px solid #2b2b2b" }}>
            <p style={{ margin: 0, fontSize: 12.5, color: "#B9BDB8", lineHeight: 1.5 }}>
              This form is free to use. All coaching — 1-to-1 or an organised skills session — is a chargeable service. Tell us what you're after below and we'll get back to you with details.
            </p>
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: 10 }}>What would you like more support with?</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {QA_TOPICS.map((topic) => {
              const selected = qaTopics.includes(topic);
              return (
                <button key={topic} onClick={() => toggleQaTopic(topic)}
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px solid " + (selected ? "#E8792B" : "#2b2b2b"), background: selected ? "#E8792B" : "#161616", color: selected ? "#14171A" : "#F4F3EF", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
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

const navBtn = { width: "100%", padding: "14px 0", background: "#1B8A82", color: "#FFFFFF", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer", marginBottom: 10 };
const backBtn = { width: "100%", padding: "12px 0", background: "none", color: "#B9BDB8", border: "none", fontSize: 14, cursor: "pointer" };
const choiceBtn = { display: "block", width: "100%", textAlign: "left", padding: "14px 16px", marginBottom: 10, background: "#161616", border: "1.5px solid #2b2b2b", color: "#F4F3EF", borderRadius: 10, fontSize: 15, cursor: "pointer" };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 8, border: "1px solid #2b2b2b", background: "#161616", color: "#F4F3EF", fontSize: 16, marginBottom: 20, boxSizing: "border-box" };
