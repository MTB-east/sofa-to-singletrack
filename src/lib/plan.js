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
 */
export function decideSync(local, server) {
  const hasLocal = !!local && ((local.stage && local.stage !== "welcome") || ridesLogged(local) > 0);
  if (!server) return hasLocal ? { action: "saveToAccount" } : { action: "nothing" };
  if (!hasLocal) return { action: "useAccount", keepBackup: false };
  const localRides = ridesLogged(local);
  const serverRides = ridesLogged(server);
  if (serverRides > 0 && localRides === 0) return { action: "useAccount", keepBackup: true };
  if (localRides > 0 && serverRides === 0) return { action: "saveToAccount" };
  if ((server.savedAt || 0) > (local.savedAt || 0)) return { action: "useAccount", keepBackup: true };
  return { action: "saveToAccount" };
}
