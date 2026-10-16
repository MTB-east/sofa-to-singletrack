// Pure helpers for the programme's calendar and for reconciling a device's copy with the account's copy.
// Kept out of App.jsx so they can be tested with node:test (`npm test`).

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-first weekday index (Mon = 0 ... Sun = 6). */
export function weekdayIndex(date) {
  return (new Date(date).getDay() + 6) % 7;
}

/** Midnight on the Monday of the week that holds `date` (local time). */
export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - weekdayIndex(d));
  return d;
}

/**
 * The calendar date of one session. Week 1 is the week the programme started in, so a "Tue" session is always on a
 * Tuesday: before this the start day itself was treated as a Monday, and anyone who signed up on a Thursday saw their
 * Tuesday ride dated on the Friday.
 */
export function sessionDate(programStart, weekNum, dayLabel) {
  const d = mondayOf(programStart);
  d.setDate(d.getDate() + (weekNum - 1) * 7 + Math.max(WEEKDAYS.indexOf(dayLabel), 0));
  d.setHours(17, 30, 0, 0);
  return d;
}

/** Which programme week a date falls in (1 = the start week), on the same Monday anchor as sessionDate. */
export function weekNumberForDate(programStart, date) {
  const start = mondayOf(programStart);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor((d - start) / (24 * 60 * 60 * 1000) / 7) + 1;
}

/**
 * When to say the programme started, given when the rider pressed "Build my programme" and their week-1 sessions.
 * Normally that moment. But if every week-1 day has already gone by (signing up on a Sunday with Tue/Thu/Sat
 * rides), week 1 starts next Monday instead of being over before it began.
 */
export function programmeStartFor(now, weekOne) {
  const today = weekdayIndex(now);
  const anyLeft = (weekOne?.sessions || []).some((s) => WEEKDAYS.indexOf(s.day) >= today);
  if (anyLeft) return new Date(now);
  const next = mondayOf(now);
  next.setDate(next.getDate() + 7);
  return next;
}

/**
 * Week 1 keeps only the sessions on or after the day the programme started: a Thursday starter with Tue/Thu/Sat
 * rides begins with Thursday's, not with a Tuesday that is already in the past. Deterministic from programStart, so
 * rebuilding the weeks from the template on a later load gives the same week 1 (session keys depend on it).
 */
export function trimWeekOne(weeks, programStart) {
  if (!weeks || weeks.length === 0) return weeks;
  const today = weekdayIndex(programStart);
  const first = weeks[0];
  const kept = (first.sessions || []).filter((s) => WEEKDAYS.indexOf(s.day) >= today);
  if (kept.length === 0 || kept.length === first.sessions.length) return weeks;
  return [{ ...first, sessions: kept }, ...weeks.slice(1)];
}

function ridesLogged(copy) {
  if (!copy) return 0;
  return Object.keys(copy.sessionLog || {}).length + (Array.isArray(copy.adHocLog) ? copy.adHocLog.length : 0);
}

/**
 * Decides what to do when a device and a signed-in account may both hold progress.
 *   useAccount    -- replace this device's copy with the account's (keepBackup: the device copy is kept aside)
 *   saveToAccount -- the device's copy becomes the account's
 *   nothing       -- neither side has anything
 * A copy with rides logged always beats one with none, whatever the clocks say: a brand-new plan on a second phone
 * must never wipe months of real progress just because it was saved a minute ago. When both have rides, the most
 * recently changed copy wins. Opening the app never counts as a change.
 * The one exception: a deliberate carry-on ("weeks 8 to 11", "start again", "the full plan after the race") is a new
 * programme with an empty log, so it marks itself with continuedFrom = the finished programme's programStart. A copy
 * that continues the other side's programme is not a stray new plan: the newest-savedAt rule decides instead.
 */
export function decideSync(local, server) {
  const hasLocal = !!local && ((local.stage && local.stage !== "welcome") || ridesLogged(local) > 0);
  if (!server) return hasLocal ? { action: "saveToAccount" } : { action: "nothing" };
  if (!hasLocal) return { action: "useAccount", keepBackup: false };
  const localRides = ridesLogged(local);
  const serverRides = ridesLogged(server);
  if (serverRides > 0 && localRides === 0 && !continuesFrom(local, server)) return { action: "useAccount", keepBackup: true };
  if (localRides > 0 && serverRides === 0 && !continuesFrom(server, local)) return { action: "saveToAccount" };
  if ((server.savedAt || 0) > (local.savedAt || 0)) return { action: "useAccount", keepBackup: true };
  return { action: "saveToAccount" };
}

/** True when `copy` is a carry-on from the programme `other` holds (its continuedFrom is other's programStart). */
function continuesFrom(copy, other) {
  return !!copy && !!other && typeof copy.continuedFrom === "string" && copy.continuedFrom !== "" && copy.continuedFrom === other.programStart;
}

// ---- The signed-off coaching plans --------------------------------------------------------------
// Transcribed from docs/Sofa-to-Singletrack-Coaching-Plans-SIGNED-OFF-2026-10-15.md, signed off by the MTB east crew.
// The words here are the words riders read: change the document first, then this. Session shape:
//   adult   { role: "A"|"B"|"C", name, mins, effort: "low"|"med"|"high", effortNote?, detail, doneWhen, skill? }
//   junior  { role: "J1"|"J2", name, mins, effort, where, child, grownUp, badge, doneWhen, helper }
// effort keys stay low/med/high; the app shows them as Chatting / Breathing / Can't talk (the talk test).

export const PLAN_VERSION = 2;

export const EFFORT_WORDS = {
  low: { word: "Chatting", feels: "You could talk the whole way. Singing is allowed." },
  med: { word: "Breathing", feels: "Short sentences only. You are working but you could keep this up for a while." },
  high: { word: "Can't talk", feels: "A few words at most. Only ever for short bursts, and never in the Juniors plan." },
};

const REPEAT_WEEK_FOCUS = "Same as week 7. Couch to 5K does this on purpose: the second time is when it feels normal. Riders who found week 7 easy can add five minutes to each ride; the app never adds it for them.";

const WEEK_7_SESSIONS = [
  { role: "A", name: "Skills", skill: "standing climbs", mins: 25, effort: "low", detail: "Climbing standing up: on a short rise, stand for the last ten metres, weight over the pedals, bike rocks a little, that is fine.", doneWhen: "three standing finishes." },
  { role: "B", name: "Steady", mins: 35, effort: "low", detail: "", doneWhen: "35 minutes." },
  { role: "C", name: "The long one", mins: 60, effort: "low", detail: "Mixed terrain. First ride over an hour.", doneWhen: "an hour. That is the whole point of this week." },
];

export const WEEKS_12 = [
  {
    n: 1, title: "Off the sofa", focus: "Get on, ride, get off, smile.",
    sessions: [
      { role: "A", name: "Skills", skill: "standing drill", tenMinutes: true, mins: 20, effort: "low", detail: "Ready position: stand on the pedals, level cranks, elbows bent, eyes up. Ride a flat path and every two minutes stand up for ten pedal strokes.", doneWhen: "you can stand and coast for a count of five without wobbling." },
      { role: "B", name: "Steady", mins: 20, effort: "low", detail: "Flat path. Practise looking 20 metres ahead, not at your front wheel.", doneWhen: "20 minutes without stopping." },
      { role: "C", name: "The long one", mins: 30, effort: "low", detail: "Flat or gentle, two or three stops to drink.", doneWhen: "you got back and your legs feel fine." },
    ],
  },
  {
    n: 2, title: "Stopping", focus: "Brakes are for confidence, not emergencies.",
    sessions: [
      { role: "A", name: "Skills", skill: "braking line", tenMinutes: true, mins: 25, effort: "low", detail: "Braking. Mark a line on a path with a stick. From walking pace, stop with your front wheel on the line, eight times, using both brakes, no skid. Then from a bit faster. Front brake does most of the work; bum goes back as you squeeze.", doneWhen: "eight clean stops on the line from Breathing pace." },
      { role: "B", name: "Steady", mins: 25, effort: "low", detail: "Flat path, ten practice stops spread through the ride.", doneWhen: "you stop without thinking about which lever." },
      { role: "C", name: "The long one", mins: 35, effort: "low", detail: "First ride on a wide, easy trail (a green or blue grade, or a bridleway).", doneWhen: "you rode a trail and it was fine." },
    ],
  },
  {
    n: 3, title: "Gears and the first hill", focus: "",
    sessions: [
      { role: "A", name: "Skills", skill: "five rises", mins: 25, effort: "low", detail: "Gears: change before the hill, not on it. Find a short rise. Ride up it five times, each time changing down on the flat before it. Pedal all the way to the top in a gear that spins.", doneWhen: "five rises without the chain crunching." },
      { role: "B", name: "Steady", mins: 25, effort: "low", detail: "Easy spin, no hills.", doneWhen: "you enjoyed it." },
      { role: "C", name: "The long one", mins: 40, effort: "med", effortNote: "Breathing on the climbs", detail: "Three short gentle climbs. Walk anything too steep, it still counts.", doneWhen: "you got up at least one of them seated and spinning." },
    ],
  },
  {
    n: 4, title: "Cornering", focus: "Look where you want to go. The bike follows your eyes.",
    sessions: [
      { role: "A", name: "Skills", skill: "figure-of-eights", tenMinutes: true, mins: 25, effort: "low", detail: "Two drink bottles ten metres apart on grass. Figure-of-eights round them, outside pedal down, inside knee pointing at the bottle, eyes on the exit. Five laps each way.", doneWhen: "five laps each way without a foot down." },
      { role: "B", name: "Steady", mins: 30, effort: "low", detail: "Flat and gentle.", doneWhen: "30 minutes without stopping." },
      { role: "C", name: "The long one", mins: 40, effort: "low", detail: "Easy trail with corners. Pick the smooth line, not the fast one.", doneWhen: "you looked round a corner before you got to it and it worked." },
    ],
  },
  {
    n: 5, title: "Rolling terrain", focus: "Roots, ruts and the odd rock, slowly.",
    sessions: [
      { role: "A", name: "Skills", skill: "roll-overs", tenMinutes: true, mins: 25, effort: "low", detail: "Small obstacles at walking pace: a root, a kerb edge, a stick. Ready position, heavy feet light hands, let the bike move under you.", doneWhen: "ten roll-overs without stopping pedalling." },
      { role: "B", name: "Steady", mins: 35, effort: "low", detail: "Alternate gravel and packed dirt.", doneWhen: "35 minutes." },
      { role: "C", name: "The long one", mins: 45, effort: "low", effortNote: "Chatting with Breathing moments", detail: "Rolling singletrack, no time pressure.", doneWhen: "the longest ride so far, finished smiling or at least not swearing." },
    ],
  },
  {
    n: 6, title: "The long one gets long", focus: "Fuelling practice starts.",
    sessions: [
      { role: "A", name: "Skills", skill: "descents", tenMinutes: true, mins: 25, effort: "low", detail: "Descending: heels down, bum back, fingers on the brakes, look to the bottom. Find a grassy slope you would normally walk down. Ride it five times.", doneWhen: "five descents with no skid and no stopping halfway." },
      { role: "B", name: "Steady", mins: 35, effort: "med", effortNote: "Breathing in the middle 10 minutes", detail: "Breathing in the middle 10 minutes.", doneWhen: "you held Breathing pace for ten minutes." },
      { role: "C", name: "The long one", mins: 50, effort: "low", detail: "Eat something at 20 minutes and drink every 10.", doneWhen: "you ate on the bike and did not fall off." },
    ],
  },
  { n: 7, title: "Your first hour", focus: "", sessions: WEEK_7_SESSIONS },
  { n: 8, title: "Repeat week", focus: REPEAT_WEEK_FOCUS, sessions: WEEK_7_SESSIONS },
  {
    n: 9, title: "Short, hard, fun", focus: "The first Can't-talk efforts, and they are short.",
    sessions: [
      { role: "A", name: "Skills", skill: "line choice", mins: 25, effort: "low", detail: "Line choice: on a bumpy stretch, ride it three ways, left, middle, right, and feel which is smoothest.", doneWhen: "you can say which line and why." },
      { role: "B", name: "Intervals", mins: 35, effort: "high", detail: "Five lots of one minute at Can't talk, with two minutes Chatting between each. Then easy home.", doneWhen: "five efforts and the fifth was not much slower than the first." },
      { role: "C", name: "The long one", mins: 55, effort: "med", effortNote: "Chatting with a Breathing middle 15 minutes", detail: "Chatting with a Breathing middle 15 minutes.", doneWhen: "55 minutes." },
    ],
  },
  {
    n: 10, title: "Race pace, if you fancy it", focus: "Riders on the \"no race\" plan do this week at Breathing instead of Can't talk; the ride names stay the same.",
    sessions: [
      { role: "A", name: "Skills", skill: "six starts", mins: 20, effort: "high", detail: "Starts: six practice starts from a standstill, pedal already up, three hard pedal strokes then settle.", doneWhen: "six starts without a missed pedal." },
      { role: "B", name: "Intervals", mins: 35, effort: "high", detail: "Five lots of two minutes at Can't talk, two minutes Chatting between.", doneWhen: "five done." },
      { role: "C", name: "Race simulation", mins: 50, effort: "med", detail: "Ride a loop at Breathing all the way, the effort you would hold in a 45-minute race.", doneWhen: "you did not blow up in the first ten minutes." },
    ],
  },
  {
    n: 11, title: "The real thing, slowly", focus: "",
    sessions: [
      { role: "A", name: "Skills", skill: "M-check", mins: 30, effort: "low", detail: "The M-check in the app, then a short ride to test it.", doneWhen: "every point on the M checked and nothing fell off." },
      { role: "B", name: "Steady", mins: 30, effort: "low", detail: "", doneWhen: "legs felt fresh." },
      { role: "C", name: "Course recon", mins: 40, effort: "low", detail: "Ride a real MTB east course, or the nearest trail that feels like one, at an easy pace. Look for the corners, the climbs and where you would want to be fast.", doneWhen: "you could describe the lap to someone." },
    ],
  },
  {
    n: 12, title: "Taper and graduation", focus: "",
    sessions: [
      { role: "A", name: "Easy spin", mins: 20, effort: "low", detail: "", doneWhen: "you wanted to go further and did not." },
      { role: "B", name: "Kit check ride", mins: 15, effort: "low", detail: "Test tyre pressure, brakes and the clothes you will wear.", doneWhen: "nothing rubs, squeaks or leaks." },
      {
        role: "C", name: "Graduation ride", mins: 45, effort: "low", detail: "A 45-minute trail ride on your own terms, then the app's graduation card.", doneWhen: "you got off the sofa and onto singletrack. That was the deal.",
        byPlan: { race: { effort: "med", detail: "Race day." } },
      },
    ],
  },
];

// The 4-week Taster's own last week: the M-check, a 30-minute easy spin, a 40-minute trail ride and the graduation card.
// A rider who picked a race and is 4 to 7 weeks away gets the Taster too, with race day as its graduation ride.
const TASTER_GRADUATION_WEEK = {
  n: null, title: "Graduation week", focus: "",
  sessions: [
    WEEKS_12[10].sessions[0],
    { role: "B", name: "Easy spin", mins: 30, effort: "low", detail: "", doneWhen: WEEKS_12[11].sessions[0].doneWhen },
    { role: "C", name: "Graduation ride", mins: 40, effort: "low", detail: "A 40-minute trail ride, then the graduation card.", doneWhen: WEEKS_12[11].sessions[2].doneWhen, byPlan: { race: { mins: 45, effort: "med", detail: "Race day." } } },
  ],
};

export const RACE_READY_TEXT = "This gets you to the start line in one piece, not fit. The full plan starts after the race.";

export const JUNIOR_INTRO = {
  what: "Eight weeks, two sessions a week, 15 to 35 minutes, every session is a game. The grown-up rides or walks alongside, within sight the whole time, on paths and grass with no roads. Helmet on before the bike moves. The child never does a Can't-talk effort: Juniors is Chatting and Breathing only, and a race at the end is a fun race.",
  helpers: "MTB east's round badges are a badger and a squirrel, so the Juniors plan has two helpers. The Badger does the steady, careful things: stopping, balancing, looking ahead. The Squirrel does the quick, bouncy things: sprints, bunny hops, corners. Each session is one of theirs. A session is \"done\" when the grown-up ticks it in the app, and the child collects the badge.",
  ages: "Under-14s only get Juniors. Ages 12 to 14 are the grown-up's call.",
};

const ALONGSIDE = "Rides or walks alongside, within sight the whole time.";

export const JUNIOR_WEEKS = [
  {
    n: 1, title: "Badger Basics", focus: "",
    sessions: [
      { role: "J1", name: "Badger stands up", mins: 15, effort: "low", helper: "Badger", where: "park path", child: "Every time the grown-up says \"badger!\", stand on the pedals and coast for a count of three.", grownUp: "Counts out loud, says it about ten times.", badge: "Standing Badger", doneWhen: "three clean \"badgers\" in a row." },
      { role: "J2", name: "Look where the squirrel went", mins: 15, effort: "low", helper: "Badger", where: "field", child: "The grown-up points at a tree; the child rides to it looking at the tree, not the front wheel. Five trees.", grownUp: ALONGSIDE, badge: "Tree Spotter", doneWhen: "five trees, no wobble." },
    ],
  },
  {
    n: 2, title: "The Marshal's Whistle", focus: "Stopping is a game, not a panic.",
    sessions: [
      { role: "J1", name: "Whistle stops", mins: 20, effort: "low", helper: "Badger", where: "flat path", child: "Ride along; on the whistle (or \"STOP!\"), stop as neatly as you can with both brakes. Ten whistles.", grownUp: "Starts gentle, gets sneakier.", badge: "Marshal's Whistle", doneWhen: "ten stops, no skids, no foot-down-before-stopping." },
      { role: "J2", name: "Puddle Pilot", mins: 20, effort: "low", helper: "Badger", where: "somewhere with puddles (a dry day works too: a chalk circle)", child: "Ride through every puddle without swerving, eyes on the far side.", grownUp: "Counts puddles, accepts splashing.", badge: "Puddle Pilot", doneWhen: "ten puddles, straight through." },
    ],
  },
  {
    n: 3, title: "Squirrel Sprints", focus: "Short, fast, lots of rest.",
    sessions: [
      { role: "J1", name: "Squirrel sprints", mins: 20, effort: "med", helper: "Squirrel", where: "field", child: "From the grown-up's \"nuts!\" sprint to the next tree, then roll back slowly. Six sprints, long rests.", grownUp: ALONGSIDE, badge: "Squirrel Sprinter", doneWhen: "six sprints and still laughing." },
      { role: "J2", name: "Gear for the hill", mins: 20, effort: "low", helper: "Badger", where: "a path with a tiny slope", child: "Before the slope, change to an easy gear and say \"easy!\"; ride up spinning. Five times.", grownUp: "Checks the gear change happened before the slope.", badge: "Gear Changer", doneWhen: "five \"easy!\" climbs with no stopping." },
    ],
  },
  {
    n: 4, title: "Cornering with the cones", focus: "",
    sessions: [
      { role: "J1", name: "Bottle slalom", mins: 25, effort: "low", helper: "Squirrel", where: "grass", child: "Four drink bottles in a line, two bike-lengths apart; weave through, outside pedal down, look at the next bottle. Five runs each direction.", grownUp: ALONGSIDE, badge: "Slalom Squirrel", doneWhen: "five clean runs each way." },
      { role: "J2", name: "Follow the leader", mins: 25, effort: "low", helper: "Badger", where: "easy trail or wide path", child: "The grown-up (or an older sibling) rides in front and picks the line; the child copies the exact line. Swap halfway.", grownUp: "Rides in front and picks the line. Swap halfway.", badge: "Line Follower", doneWhen: "you rode a real trail following a line." },
    ],
  },
  {
    n: 5, title: "Bumps and roots", focus: "",
    sessions: [
      { role: "J1", name: "Stick jumps", mins: 25, effort: "low", helper: "Squirrel", where: "grass", child: "Lay a stick on the ground; ride over it standing up, heavy feet, light hands. Then two sticks. Then a bigger stick.", grownUp: ALONGSIDE, badge: "Stick Jumper", doneWhen: "ten stick roll-overs without sitting down." },
      { role: "J2", name: "Badger's bumpy trail", mins: 30, effort: "low", helper: "Badger", where: "easy singletrack", child: "Count the roots you rode over standing up.", grownUp: "Counts too; the higher number wins.", badge: "Root Counter", doneWhen: "30 minutes on a real trail." },
    ],
  },
  {
    n: 6, title: "Up and down", focus: "",
    sessions: [
      { role: "J1", name: "Slope slider", mins: 25, effort: "low", helper: "Badger", where: "a grassy slope", child: "Ride down the slope with heels down and bum back, \"like a badger sitting down\". Five times. Then ride up it spinning.", grownUp: ALONGSIDE, badge: "Slope Slider", doneWhen: "five downs with no skid and one up without stopping." },
      { role: "J2", name: "The snack stop", mins: 30, effort: "low", helper: "Badger", where: "trail", child: "Ride 15 minutes, stop, eat a snack and drink, ride 15 minutes.", grownUp: ALONGSIDE, badge: "Snack Stopper", doneWhen: "the whole 30, with a snack in the middle." },
    ],
  },
  {
    n: 7, title: "Laps", focus: "A lap is what a race is.",
    sessions: [
      { role: "J1", name: "Lap the park", mins: 30, effort: "low", helper: "Badger", where: "a loop in the park about five minutes round", child: "Ride laps, counting them; on each lap do one whistle stop and one standing section.", grownUp: ALONGSIDE, badge: "Lap Counter", doneWhen: "four laps." },
      { role: "J2", name: "Start line", mins: 25, effort: "med", helper: "Squirrel", where: "grass", child: "Line up, \"3, 2, 1, go!\", three hard pedal strokes then settle into Breathing. Six starts.", grownUp: ALONGSIDE, badge: "Starter", doneWhen: "six starts with the pedal up and ready." },
    ],
  },
  {
    n: 8, title: "Graduation", focus: "",
    sessions: [
      { role: "J1", name: "M-check with a grown-up", mins: 20, effort: "low", helper: "Badger", where: "", child: "The M-check from the app, child does the pointing, grown-up does the squeezing. Then a short ride.", grownUp: "Does the squeezing.", badge: "Bike Checker", doneWhen: "the M is done and the bike is happy." },
      { role: "J2", name: "Graduation lap", mins: 35, minsText: "20 to 35 min", effort: "med", effortNote: "Chatting and Breathing only", helper: "Badger", where: "A real MTB east kids' course (U7 is about 400 m a lap, U9 about 900 m, U12 just over a kilometre) or the park loop.", child: "Ride the laps a race would, Chatting and Breathing only.", grownUp: "Rides or walks alongside, within sight the whole time, and takes the photo.", badge: "Sofa to Singletrack Junior", doneWhen: "you did it, and the grown-up has a photo." },
    ],
  },
];

export const JUNIOR_BADGES = JUNIOR_WEEKS.flatMap((w) => w.sessions.map((s) => s.badge));

const DEFAULT_DAYS = { 2: ["Sat", "Sun"], 3: ["Tue", "Thu", "Sat"] };

function daysFor(chosenDays, daysPerWeek) {
  const want = daysPerWeek === 2 ? 2 : daysPerWeek === 3 ? 3 : (chosenDays && chosenDays.length === 2 ? 2 : 3);
  if (chosenDays && chosenDays.length === want) return chosenDays;
  return DEFAULT_DAYS[want];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function forPlanType(session, planType) {
  const { byPlan, ...rest } = session;
  return byPlan && byPlan[planType] ? { ...rest, ...byPlan[planType] } : rest;
}

// No-race plans run weeks 9 and 10 at Breathing instead of Can't talk; the ride names stay the same.
function atBreathing(session) {
  if (session.effort !== "high") return session;
  return { ...session, effort: "med", detail: session.detail.replace(/Can't talk/g, "Breathing") };
}

const EFFORT_ORDER = { low: 0, med: 1, high: 2 };

/** The harder of two efforts (low < med < high). */
function harderEffort(x, y) {
  return (EFFORT_ORDER[y] || 0) > (EFFORT_ORDER[x] || 0) ? y : x;
}

const isRaceDay = (session) => session.name === "Graduation ride" && session.detail === "Race day.";

/**
 * The two-day week: Ride A's skill is folded into Ride C, so the week is "Steady" plus "Skill then ride". Nothing is
 * dropped. Week 12 (and any week whose first ride has no skill) is just its Ride B and Ride C. On the race plan, when
 * Ride C is race day itself, nothing is folded into it: the week is the kit check ride and "Graduation ride: Race day."
 * The combined ride's effort is the harder of A's and C's.
 */
function twoDayWeek(week) {
  const [a, b, c] = week.sessions;
  if (week.sessions.length !== 3) return week;
  if (!a.skill || isRaceDay(c)) return { ...week, sessions: [b, c] };
  const cName = c.name === "The long one" ? "the long one" : c.name.toLowerCase();
  const intro = a.tenMinutes ? `${cap(a.skill)} for 10 minutes: ` : `${cap(a.skill)} first: `;
  const detail = `${intro}${a.detail} Then ${cName}${c.detail ? ": " + c.detail : "."}`;
  const ride2 = {
    role: "C", name: `Skill then ride: ${a.skill}`, combined: true, twoDay: 2, mins: 10 + c.mins, effort: harderEffort(a.effort, c.effort),
    detail, doneWhen: `${a.doneWhen}\n${c.doneWhen}`,
  };
  if (c.effortNote) ride2.effortNote = c.effortNote;
  return { ...week, sessions: [{ ...b, twoDay: 1 }, ride2] };
}

function elevFor(i, n) {
  return Math.round(8 + (i / Math.max(n - 1, 1)) * 84);
}

function finishWeeks(weeks, days) {
  return weeks.map((w, i) => {
    const shaped = days.length === 2 ? twoDayWeek(w) : w;
    return { ...shaped, n: i + 1, sessions: shaped.sessions.map((s, idx) => ({ ...s, day: days[idx] })), elev: elevFor(i, weeks.length) };
  });
}

function weekFromSource(src, planType, { breathing = false } = {}) {
  let sessions = src.sessions.map((s) => forPlanType(s, planType));
  let focus = src.focus;
  if (breathing) {
    sessions = sessions.map(atBreathing);
    focus = focus.replace(/Can't-talk/g, "Breathing");
  }
  return { fullWeek: src.n, title: src.title, focus, sessions };
}

/** Which weeks of the twelve make up each plan length (null marks the Taster's own graduation week). */
export function weekPicks(lengthWeeks, planType) {
  if (lengthWeeks === 4) return [1, 2, 4, null];
  if (lengthWeeks === 8) return [1, 2, 3, 4, 6, 7, planType === "race" ? 10 : 9, 12];
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/**
 * Plan A, Sofa to Singletrack (14 and over): the 12-week plan as written, the 8-week plan, or the 4-week Taster, on
 * three days (A, B, C) or two (B, then "Skill then ride").
 */
export function buildAdultPlan({ lengthWeeks = 12, daysPerWeek, chosenDays, planType = "months" } = {}) {
  const days = daysFor(chosenDays, daysPerWeek);
  const noRace = planType !== "race";
  const weeks = weekPicks(lengthWeeks, planType).map((pick) => {
    if (pick === null) return weekFromSource(TASTER_GRADUATION_WEEK, planType);
    const src = WEEKS_12[pick - 1];
    return weekFromSource(src, planType, { breathing: noRace && (pick === 9 || pick === 10) });
  });
  return finishWeeks(weeks, days);
}

/**
 * Weeks fromWeek to toWeek of a plan, as a programme of their own: the 8-week finisher carries on with weeks 8 to 11
 * of the full plan, the Taster finisher with the 8-week plan from week 5. Week numbers restart at 1; fullWeek keeps
 * the source week.
 */
export function buildContinuationPlan({ lengthWeeks = 12, fromWeek, toWeek, daysPerWeek, chosenDays, planType = "months" } = {}) {
  const days = daysFor(chosenDays, daysPerWeek);
  const full = buildAdultPlan({ lengthWeeks, daysPerWeek: days.length, chosenDays: days, planType });
  const slice = full.slice(fromWeek - 1, toWeek).map(({ n, elev, ...w }) => w);
  return finishWeeks(slice.map((w) => ({ ...w, sessions: w.sessions.map(({ day, ...s }) => s) })), days);
}

/**
 * "Race ready", for a race under four weeks away: week 11 (M-check, steady, course recon) with week 10's six practice
 * starts added to Ride A, then week 12 (taper). Three weeks to go gets week 11 as written in between. One week to go
 * (the race is this week or next) is week 12 alone, with the six starts folded into Ride A, so the block never runs
 * past the race. On two days a week the 1-week block puts the starts on the kit check ride instead, since Ride A is
 * cut from a two-day week and race day itself takes nothing extra.
 */
export function buildRaceReadyPlan({ weeksToRace = 2, daysPerWeek, chosenDays } = {}) {
  const days = daysFor(chosenDays, daysPerWeek);
  const starts = WEEKS_12[9].sessions[0];
  const withStarts = (week, role) => ({
    ...week,
    sessions: week.sessions.map((s) => (s.role === role
      ? { ...s, mins: s.mins + starts.mins, effort: harderEffort(s.effort, "med"), detail: `${s.detail ? s.detail + " " : ""}${starts.detail}`, doneWhen: `${s.doneWhen}\n${starts.doneWhen}` }
      : s)),
  });
  const w11 = WEEKS_12[10];
  const w12 = WEEKS_12[11];
  const picks = weeksToRace <= 1
    ? [withStarts(w12, days.length === 2 ? "B" : "A")]
    : weeksToRace >= 3 ? [withStarts(w11, "A"), w11, w12] : [withStarts(w11, "A"), w12];
  return finishWeeks(picks.map((src) => weekFromSource(src, "race")), days);
}

/** Plan B, Sofa to Singletrack Juniors: eight weeks, two sessions a week, every session a game with a badge. */
export function buildJuniorPlan({ chosenDays } = {}) {
  const days = daysFor(chosenDays, 2);
  return finishWeeks(JUNIOR_WEEKS.map((w) => ({ fullWeek: w.n, title: w.title, focus: w.focus, sessions: w.sessions.map((s) => ({ ...s })) })), days);
}

/** Whole weeks until a date, never negative. */
export function weeksUntil(dateStr, now = new Date()) {
  const target = new Date(dateStr);
  const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, Math.round(days / 7));
}

/**
 * What a rider who picks a race gets: under four weeks away is a 1-, 2- or 3-week Race ready block (a race this week
 * or next gets the single taper week, never a block that ends after the race); otherwise the longest plan that fits
 * (12, 8 or 4 weeks). When the race is further off than the plan is long, the start is held back by up to three weeks
 * so the last week is race week (delayWeeks); further than that, the plan starts now.
 */
export function planForRace(weeksAway) {
  if (weeksAway < 4) return { kind: "raceReady", weeksToRace: Math.min(3, Math.max(1, weeksAway)) };
  const lengthWeeks = weeksAway >= 12 ? 12 : weeksAway >= 8 ? 8 : 4;
  const gap = weeksAway - lengthWeeks;
  return { kind: "plan", lengthWeeks, delayWeeks: gap <= 3 ? gap : 0 };
}

/**
 * A saved programme's weeks are kept exactly as saved, whatever version built them: a programme saved before
 * planVersion 2 used session keys that no longer exist in the plan tables, so rebuilding would scramble its log.
 */
export function weeksFromSaved(saved) {
  if (!saved || !Array.isArray(saved.weeks) || saved.weeks.length === 0) return null;
  return saved.weeks;
}

export function planVersionOf(saved) {
  return saved && Number.isInteger(saved.planVersion) ? saved.planVersion : 1;
}

/**
 * Moves an existing programme onto different days without rebuilding it. A trimmed week 1 keeps the last of the new
 * days, matching how trimWeekOne drops the earliest ones.
 */
export function reassignDays(weeks, chosenDays) {
  return weeks.map((w) => {
    const offset = Math.max(0, chosenDays.length - w.sessions.length);
    return { ...w, sessions: w.sessions.map((s, i) => ({ ...s, day: chosenDays[Math.min(i + offset, chosenDays.length - 1)] })) };
  });
}

/** A session's eyebrow on the card: Ride A / B / C for adults (Ride 1 / 2 on two days a week), Session 1 / 2 for Juniors. */
export function roleLabel(session) {
  if (!session || !session.role) return "";
  if (session.role === "J1") return "Session 1";
  if (session.role === "J2") return "Session 2";
  if (session.twoDay) return `Ride ${session.twoDay}`;
  return `Ride ${session.role}`;
}

export const isJuniorSession = (session) => !!session && typeof session.role === "string" && session.role.startsWith("J");

// ---- Saved-copy shape, rider ids, sync merging and the account status line ---------------------------
// Everything the app needs to be careful about when a copy comes from storage or the account lives here, so it can be
// tested without a browser.

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const isoOrNull = (v) => (typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v)) ? v : null);

function cleanProfile(raw, blank) {
  const base = isObj(blank) ? blank : {};
  const p = isObj(raw) ? raw : {};
  const out = { ...base, ...p };
  out.name = typeof p.name === "string" ? p.name.slice(0, 40) : typeof base.name === "string" ? base.name : "";
  out.chosenDays = Array.isArray(p.chosenDays) ? p.chosenDays.filter((d) => WEEKDAYS.includes(d)) : [];
  out.junior = !!p.junior;
  out.raceReady = !!p.raceReady;
  out.sessionsPerWeek = finite(p.sessionsPerWeek) ? p.sessionsPerWeek : finite(base.sessionsPerWeek) ? base.sessionsPerWeek : 3;
  out.delayWeeks = finite(p.delayWeeks) ? p.delayWeeks : 0;
  return out;
}

function cleanLogMap(raw) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string" || finite(v)) out[k] = v;
  return out;
}

// { sessionKey: ms } of sessions cleared (or a skip undone) on some device, so the account merge never brings them back.
function cleanClearedMap(raw) {
  if (!isObj(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (finite(v)) out[k] = v;
  return out;
}

function cleanWeeks(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ok = raw.every((w) => isObj(w) && finite(w.n) && Array.isArray(w.sessions) && w.sessions.every(isObj));
  return ok ? raw.map((w) => ({ ...w, sessions: w.sessions.map((s) => ({ ...s })) })) : null;
}

function cleanAdHoc(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => isObj(r) && finite(r.at))
    .map((r) => ({ week: finite(r.week) ? r.week : 0, at: r.at, mins: finite(r.mins) ? r.mins : 0, feeling: typeof r.feeling === "string" ? r.feeling : "" }));
}

/**
 * A safe copy of a saved snapshot, whatever came out of storage, a backup file or the account. `raw` may be JSON text
 * or an object; anything unparseable gives null. Every field comes back with the right type: `weeks` is null when the
 * copy holds no usable programme (the caller decides whether that means "fall back to blank"), `programStart` is null
 * unless it parses, `savedAt` is a number. Unknown fields (a backup's `backup`, say) are dropped.
 */
export function normaliseSaved(raw, blank = {}) {
  let src = raw;
  if (typeof src === "string") {
    try { src = JSON.parse(src); } catch (e) { return null; }
  }
  if (!isObj(src)) return null;
  const b = isObj(blank) ? blank : {};
  return {
    profile: cleanProfile(src.profile, b.profile),
    weeks: cleanWeeks(src.weeks),
    planVersion: Number.isInteger(src.planVersion) ? src.planVersion : 1,
    sessionLog: cleanLogMap(src.sessionLog),
    sessionDurations: cleanLogMap(src.sessionDurations),
    clearedLog: cleanClearedMap(src.clearedLog),
    badges: Array.isArray(src.badges) ? src.badges.filter((x) => typeof x === "string") : [],
    adHocLog: cleanAdHoc(src.adHocLog),
    notifAsked: !!src.notifAsked,
    notifEnabled: !!src.notifEnabled,
    reminderTime: typeof src.reminderTime === "string" ? src.reminderTime : typeof b.reminderTime === "string" ? b.reminderTime : "17:30",
    lastFeeling: typeof src.lastFeeling === "string" ? src.lastFeeling : null,
    programStart: isoOrNull(src.programStart),
    continuedFrom: typeof src.continuedFrom === "string" && src.continuedFrom !== "" ? src.continuedFrom : null,
    savedAt: finite(src.savedAt) ? src.savedAt : 0,
    activeTimer: isObj(src.activeTimer) ? src.activeTimer : null,
    // Older copies carry a ±5 minute adjustment. The plan says the app never changes a session's minutes, so it is
    // accepted here (a saved copy must round-trip) and ignored everywhere else.
    adjustmentMins: finite(src.adjustmentMins) ? src.adjustmentMins : 0,
    stage: typeof src.stage === "string" && src.stage !== "" ? src.stage : typeof b.stage === "string" ? b.stage : "welcome",
    lastActivityAt: finite(src.lastActivityAt) ? src.lastActivityAt : null,
    comebackNudgeShown: !!src.comebackNudgeShown,
    raceOfferShown: !!src.raceOfferShown,
  };
}

// ---- Missed weeks ------------------------------------------------------------------------------------

const weekOfKey = (key) => parseInt(String(key).split("-")[0], 10);

/**
 * How many whole weeks the programme should move forward so that this calendar week holds the next unlogged session.
 * 0 unless today's week is more than one week past the last week with anything logged (the start week counts when
 * nothing is logged yet), or the programme is complete. A rider back after a month away who logged week 3 last and
 * is now in week 7 gets 3: weeks 4 to 6 were missed, and week 4 becomes this week.
 */
export function missedWeeks(programStart, sessionLog, weeks, today = new Date()) {
  const log = isObj(sessionLog) ? sessionLog : {};
  const thisWeek = weekNumberForDate(programStart, today);
  const loggedWeeks = Object.keys(log).map(weekOfKey).filter(Number.isFinite);
  const lastLogged = loggedWeeks.length ? Math.max(...loggedWeeks) : 1;
  if (thisWeek - lastLogged <= 1) return 0;
  let nextUnlogged = null;
  for (const w of weeks || []) {
    if ((w.sessions || []).some((_, i) => !(`${w.n}-${i}` in log))) { nextUnlogged = w.n; break; }
  }
  if (nextUnlogged === null) return 0;
  return Math.max(0, thisWeek - nextUnlogged);
}

/** The programme start moved forward by whole weeks (the session keys and the log are untouched). */
export function shiftProgrammeStart(programStart, weeksForward) {
  const d = new Date(programStart);
  d.setDate(d.getDate() + 7 * Math.max(0, Math.round(weeksForward) || 0));
  return d;
}

/** A copy that says it is on the dashboard but has no programme to show: the app must start blank and keep the raw text aside. */
export function needsBlankFallback(safe) {
  return !!safe && safe.weeks === null && safe.stage === "dashboard";
}

/** A 6-character base36 rider id. */
export function newRiderId(random = Math.random) {
  let id = "";
  while (id.length < 6) id += Math.floor(Math.min(Math.max(random(), 0), 0.999999) * 36).toString(36);
  return id;
}

/** True when two rider names are both given and are not the same name (case and surrounding spaces ignored). */
export function namesDiffer(a, b) {
  const x = (typeof a === "string" ? a : "").trim().toLowerCase();
  const y = (typeof b === "string" ? b : "").trim().toLowerCase();
  return x !== "" && y !== "" && x !== y;
}

const LEGACY_ID = "main";

/**
 * The rider index as stored on this device: { active, riders: [{ id, name, lastSavedAt? }], removed: [{ id, at, pendingDelete? }] }.
 * Anything malformed gives null so the caller can start a fresh one.
 */
export function normaliseRiderIndex(parsed) {
  if (!isObj(parsed) || !Array.isArray(parsed.riders)) return null;
  const riders = parsed.riders
    .filter((r) => isObj(r) && typeof r.id === "string" && r.id !== "")
    .map((r) => {
      const out = { id: r.id, name: typeof r.name === "string" ? r.name.slice(0, 40) : "" };
      if (finite(r.lastSavedAt)) out.lastSavedAt = r.lastSavedAt;
      return out;
    });
  if (riders.length === 0 || !riders.some((r) => r.id === parsed.active)) return null;
  const removed = Array.isArray(parsed.removed)
    ? parsed.removed.filter((r) => isObj(r) && typeof r.id === "string" && r.id !== "").map((r) => ({ id: r.id, at: finite(r.at) ? r.at : 0, ...(r.pendingDelete ? { pendingDelete: true } : {}) }))
    : [];
  return { active: parsed.active, riders, removed };
}

/**
 * The index for a device with no index yet: a device that already holds progress under the original key keeps the
 * "main" id for it, a fresh device gets a random id for its first rider.
 */
export function freshRiderIndex(hasLegacyData, mintId = newRiderId) {
  const id = hasLegacyData ? LEGACY_ID : mintId();
  return { active: id, riders: [{ id, name: "" }], removed: [] };
}

/**
 * Whether this device's "main" copy and the account's "main" copy are two different people. Only when the device's
 * active rider is "main" and both sides have a name that is not the same: then the device copy is given its own id
 * and pushed as a new rider rather than reconciled against a stranger's programme.
 */
export function shouldSplitMain(index, localName, serverName) {
  return !!index && index.active === LEGACY_ID && namesDiffer(localName, serverName);
}

/** The index with the "main" rider renamed to `newId` (active follows it). */
export function renameRider(index, fromId, newId) {
  return {
    ...index,
    active: index.active === fromId ? newId : index.active,
    riders: index.riders.map((r) => (r.id === fromId ? { ...r, id: newId } : r)),
  };
}

export function isRemovedRider(index, id) {
  return !!index && Array.isArray(index.removed) && index.removed.some((r) => r.id === id);
}

/** Adds `id` to the index's removed list (and drops it from riders if still there). pendingDelete marks a DELETE the account has not confirmed. */
export function markRemoved(index, id, now = Date.now(), pendingDelete = false) {
  const removed = (index.removed || []).filter((r) => r.id !== id);
  removed.push({ id, at: now, ...(pendingDelete ? { pendingDelete: true } : {}) });
  return { ...index, riders: index.riders.filter((r) => r.id !== id), removed };
}

/** The account confirmed these ids are gone: nothing left to retry for them. */
export function confirmRemoved(index, ids) {
  const set = new Set(ids);
  return { ...index, removed: (index.removed || []).map((r) => (set.has(r.id) && r.pendingDelete ? { id: r.id, at: r.at } : r)) };
}

/**
 * Riders the account says were removed elsewhere: dropped from this device's index and remembered as removed. If the
 * active rider goes, the first remaining rider takes over; if none remain, a fresh blank rider is minted.
 */
export function dropRiders(index, ids, now = Date.now(), mintId = newRiderId) {
  const gone = new Set((ids || []).filter((id) => index.riders.some((r) => r.id === id)));
  if (gone.size === 0) return { index, dropped: [], activeChanged: false };
  const dropped = index.riders.filter((r) => gone.has(r.id));
  let riders = index.riders.filter((r) => !gone.has(r.id));
  if (riders.length === 0) riders = [{ id: mintId(), name: "" }];
  const active = gone.has(index.active) ? riders[0].id : index.active;
  const removed = [...(index.removed || []).filter((r) => !gone.has(r.id)), ...dropped.map((r) => ({ id: r.id, at: now }))];
  return { index: { ...index, active, riders, removed }, dropped, activeChanged: active !== index.active };
}

/** The index with one rider's server-confirmed save time. */
export function withLastSaved(index, id, at) {
  return { ...index, riders: index.riders.map((r) => (r.id === id ? { ...r, lastSavedAt: at } : r)) };
}

const RETRY_DELAYS = [10000, 30000, 120000, 600000];

/** How long to wait before the next push attempt: 10 s, 30 s, 2 min, then 10 min every time. */
export function retryDelay(attempt) {
  return RETRY_DELAYS[Math.min(Math.max(attempt, 0), RETRY_DELAYS.length - 1)];
}

function sameMap(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => k in b && a[k] === b[k]);
}

/**
 * The account's merged copy folded into this device's copy of the same programme, by the account's own rules: the
 * logs and durations are a union by key with the newer copy winning a key both have (this device on a tie), badges
 * are a union, off-plan rides a union by their time. Nothing else is touched. `changed` says whether anything differs
 * from the local copy, so the app can skip a state update that would only re-save the same thing.
 *
 * A session cleared on one device ("Clear this", or a skip undone) is remembered in clearedLog as { key: when }. When
 * a key is in only one copy, and the other copy cleared it at or after the first copy's savedAt, the key stays
 * cleared: without this the account merge brought a cleared ride straight back. clearedLog itself merges by the
 * latest time per key. (The website server applies the same rule.)
 */
export function mergeLogs(local, remote) {
  const l = isObj(local) ? local : {};
  const r = isObj(remote) ? remote : {};
  const lSaved = l.savedAt || 0;
  const rSaved = r.savedAt || 0;
  const localWins = lSaved >= rSaved;
  const lLog = cleanLogMap(l.sessionLog);
  const lDur = cleanLogMap(l.sessionDurations);
  const rLog = cleanLogMap(r.sessionLog);
  const rDur = cleanLogMap(r.sessionDurations);
  const lCleared = cleanClearedMap(l.clearedLog);
  const rCleared = cleanClearedMap(r.clearedLog);
  const clearedLog = { ...lCleared };
  for (const [k, at] of Object.entries(rCleared)) if (!(k in clearedLog) || at > clearedLog[k]) clearedLog[k] = at;
  // A key only this side has, cleared on the other side since this side's copy was saved: it stays cleared.
  const keepLocal = (k) => k in rLog || !(k in rCleared) || rCleared[k] < lSaved;
  const keepRemote = (k) => k in lLog || !(k in lCleared) || lCleared[k] < rSaved;
  const pick = (map, keep) => Object.fromEntries(Object.entries(map).filter(([k]) => keep(k)));
  const lLogKept = pick(lLog, keepLocal);
  const rLogKept = pick(rLog, keepRemote);
  const lDurKept = pick(lDur, keepLocal);
  const rDurKept = pick(rDur, keepRemote);
  const sessionLog = localWins ? { ...rLogKept, ...lLogKept } : { ...lLogKept, ...rLogKept };
  const sessionDurations = localWins ? { ...rDurKept, ...lDurKept } : { ...lDurKept, ...rDurKept };
  const lBadges = Array.isArray(l.badges) ? l.badges : [];
  const badges = [...lBadges, ...(Array.isArray(r.badges) ? r.badges : []).filter((b) => typeof b === "string" && !lBadges.includes(b))];
  const lAdHoc = Array.isArray(l.adHocLog) ? l.adHocLog : [];
  const seen = new Set(lAdHoc.map((x) => x && x.at));
  const adHocLog = [...lAdHoc, ...cleanAdHoc(r.adHocLog).filter((x) => !seen.has(x.at))];
  const changed = !sameMap(sessionLog, lLog) || !sameMap(sessionDurations, lDur) || !sameMap(clearedLog, lCleared) || badges.length !== lBadges.length || adHocLog.length !== lAdHoc.length;
  return { sessionLog, sessionDurations, clearedLog, badges, adHocLog, changed };
}

// "at 14:02" today, "on Tue 13 Oct at 09:30" otherwise; bare = true drops the leading "at"/"on" (for "since 14:02").
function clockWords(at, now, bare = false) {
  const d = new Date(at);
  const n = new Date(now);
  const hm = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === n.toDateString()) return bare ? hm : `at ${hm}`;
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return bare ? `${day} at ${hm}` : `on ${day} at ${hm}`;
}

/**
 * The one honest line on the account card. `state` is { status, at, lastSavedAt }: status is "saved" (last push
 * succeeded at `at`), "pending" or "offline" (something is waiting to go up; lastSavedAt is the last time the account
 * confirmed a save), "signedOut", "removed", or "connecting" before the first answer from the account.
 */
export function syncStatusLine(state, now = Date.now()) {
  const s = isObj(state) ? state : {};
  const last = finite(s.lastSavedAt) ? s.lastSavedAt : 0;
  switch (s.status) {
    case "signedOut":
      return { tone: "warn", signIn: true, text: "You've been signed out. Sign in again to keep saving." };
    case "removed":
      return { tone: "warn", text: "This rider was removed on another device." };
    case "pending":
    case "offline":
      return { tone: "warn", text: last ? `Not saved to your account since ${clockWords(last, now, true)}. Check your connection.` : "Not saved to your account yet. Check your connection." };
    case "saved": {
      const at = finite(s.at) ? s.at : last;
      const ago = now - at;
      if (ago < 60000) return { tone: "ok", text: "Saved to your account just now." };
      if (ago < 3600000) return { tone: "ok", text: `Saved to your account ${Math.max(1, Math.round(ago / 60000))} min ago.` };
      return { tone: "ok", text: `Saved to your account ${clockWords(at, now)}.` };
    }
    default:
      return { tone: "muted", text: "Connecting to your account." };
  }
}

export const DAY_NAMES = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

/** The heading when a logged session is being changed: "Changing Tuesday's Ride A". */
export function changingLabel(session) {
  const day = session && DAY_NAMES[session.day];
  const what = roleLabel(session) || (session && session.name) || "this session";
  return `Changing ${day ? `${day}'s ` : ""}${what}`;
}

/** "Tuesday's Ride A" for a session, used when listing what was just logged. */
export function sessionWords(session) {
  const day = session && DAY_NAMES[session.day];
  const what = roleLabel(session) || (session && session.name) || "session";
  return `${day ? `${day}'s ` : ""}${what}`;
}

/** The logged sessions most recently written, newest first (object key order is insertion order), at most `limit`. */
export function recentlyLogged(allSessions, sessionLog, limit = 2) {
  const keys = Object.keys(sessionLog || {}).reverse();
  const out = [];
  for (const k of keys) {
    const s = allSessions.find((x) => x.key === k);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
