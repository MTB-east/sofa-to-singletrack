import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionDate, weekNumberForDate, programmeStartFor, trimWeekOne, decideSync, mondayOf } from "./plan.js";

const THURSDAY = new Date(2026, 9, 15, 10, 8); // Thu 15 Oct 2026, local time
const weekOne = { n: 1, sessions: [{ day: "Tue" }, { day: "Thu" }, { day: "Sat" }] };

test("a session's date is on its own weekday whatever day the programme started", () => {
  assert.equal(sessionDate(THURSDAY, 1, "Tue").getDay(), 2);
  assert.equal(sessionDate(THURSDAY, 1, "Thu").getDate(), 15, "Thursday's ride is today");
  assert.equal(sessionDate(THURSDAY, 1, "Sat").getDate(), 17);
  assert.equal(sessionDate(THURSDAY, 2, "Tue").getDate(), 20, "week 2 Tuesday");
  assert.equal(mondayOf(THURSDAY).getDate(), 12);
});

test("week numbers count from the Monday of the start week", () => {
  assert.equal(weekNumberForDate(THURSDAY, new Date(2026, 9, 12)), 1, "the Monday before signing up");
  assert.equal(weekNumberForDate(THURSDAY, new Date(2026, 9, 18)), 1, "the Sunday after");
  assert.equal(weekNumberForDate(THURSDAY, new Date(2026, 9, 19)), 2);
});

test("week 1 drops the rides whose day has already gone, unless that would be all of them", () => {
  const trimmed = trimWeekOne([weekOne, { n: 2, sessions: weekOne.sessions }], THURSDAY);
  assert.deepEqual(trimmed[0].sessions.map((s) => s.day), ["Thu", "Sat"]);
  assert.equal(trimmed[1].sessions.length, 3, "later weeks untouched");
  const monday = new Date(2026, 9, 12);
  assert.equal(trimWeekOne([weekOne], monday)[0].sessions.length, 3, "a Monday start keeps all three");
  const sunday = new Date(2026, 9, 18);
  assert.equal(trimWeekOne([weekOne], sunday)[0].sessions.length, 3, "nothing left this week: keep them (start moves instead)");
});

test("a programme built on a Sunday with no ride left that week starts next Monday", () => {
  const sunday = new Date(2026, 9, 18, 15, 0);
  const start = programmeStartFor(sunday, weekOne);
  assert.equal(start.getDay(), 1);
  assert.equal(start.getDate(), 19);
  assert.equal(programmeStartFor(THURSDAY, weekOne).getDate(), 15, "a Thursday start stays Thursday");
});

test("sync: a fresh plan with no rides never replaces an account that has rides", () => {
  const server = { stage: "dashboard", sessionLog: { "1-0": "Good" }, savedAt: 1000 };
  const freshLocal = { stage: "dashboard", sessionLog: {}, savedAt: 5000 };
  assert.deepEqual(decideSync(freshLocal, server), { action: "useAccount", keepBackup: true });
  const localWithRides = { stage: "dashboard", sessionLog: { "1-0": "Good", "1-1": "Good" }, savedAt: 5000 };
  assert.deepEqual(decideSync(localWithRides, server), { action: "saveToAccount" }, "both have rides: newest wins");
  assert.deepEqual(decideSync({ ...localWithRides, savedAt: 10 }, server), { action: "useAccount", keepBackup: true });
  assert.deepEqual(decideSync({ stage: "welcome" }, server), { action: "useAccount", keepBackup: false });
  assert.deepEqual(decideSync(localWithRides, null), { action: "saveToAccount" });
  assert.deepEqual(decideSync({ stage: "welcome" }, null), { action: "nothing" });
  const serverEmpty = { stage: "dashboard", sessionLog: {}, savedAt: 9000 };
  assert.deepEqual(decideSync(localWithRides, serverEmpty), { action: "saveToAccount" }, "rides beat an empty but newer account copy");
});

test("sync: a deliberate carry-on with an empty log is not a stray new plan", () => {
  const finished = { stage: "dashboard", sessionLog: { "1-0": "Good", "8-2": "Good" }, programStart: "2026-07-06T09:00:00.000Z", savedAt: 1000 };
  const carryOn = { stage: "dashboard", sessionLog: {}, programStart: "2026-10-15T09:08:00.000Z", continuedFrom: "2026-07-06T09:00:00.000Z", savedAt: 5000 };
  // A fresh plan on a new phone (no continuedFrom) still loses to the account's rides.
  const fresh = { stage: "dashboard", sessionLog: {}, programStart: "2026-10-15T09:08:00.000Z", savedAt: 5000 };
  assert.deepEqual(decideSync(fresh, finished), { action: "useAccount", keepBackup: true });
  // "Carry on with weeks 8 to 11" pressed on this phone, not pushed yet: it beats the server's finished copy.
  assert.deepEqual(decideSync(carryOn, finished), { action: "saveToAccount" });
  // A second phone still holding the finished copy does not overwrite the account's carry-on.
  assert.deepEqual(decideSync(finished, carryOn), { action: "useAccount", keepBackup: true });
  // A carry-on from some other programme is just a new plan with no rides: the rides win.
  const otherCarryOn = { ...carryOn, continuedFrom: "2026-01-05T09:00:00.000Z" };
  assert.deepEqual(decideSync(otherCarryOn, finished), { action: "useAccount", keepBackup: true });
  // Once the carry-on has rides of its own the newest-savedAt rule applies as before.
  const carryOnRidden = { ...carryOn, sessionLog: { "1-0": "Good" } };
  assert.deepEqual(decideSync(carryOnRidden, { ...finished, savedAt: 9000 }), { action: "useAccount", keepBackup: true });
  assert.deepEqual(decideSync(carryOnRidden, finished), { action: "saveToAccount" });
});

test("missed weeks: how far to move the programme so this week holds the next unlogged session", async () => {
  const { missedWeeks, shiftProgrammeStart } = await import("./plan.js");
  const start = new Date(2026, 8, 7, 9, 0); // Mon 7 Sep 2026
  const weeks = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, sessions: [{ day: "Tue" }, { day: "Thu" }, { day: "Sat" }] }));
  const week = (n) => new Date(2026, 8, 7 + 7 * (n - 1) + 2); // the Wednesday of week n
  const logged3 = { "1-0": "x", "1-1": "x", "1-2": "x", "2-0": "x", "2-1": "x", "2-2": "x", "3-0": "x", "3-1": "x", "3-2": "x" };
  assert.equal(missedWeeks(start, logged3, weeks, week(3)), 0, "still in the last logged week");
  assert.equal(missedWeeks(start, logged3, weeks, week(4)), 0, "the next week is not a missed week");
  assert.equal(missedWeeks(start, logged3, weeks, week(5)), 1, "week 4 was missed");
  assert.equal(missedWeeks(start, logged3, weeks, week(7)), 3, "weeks 4 to 6 were missed");
  const partial = { ...logged3, "3-2": undefined };
  delete partial["3-2"];
  assert.equal(missedWeeks(start, partial, weeks, week(6)), 3, "the next unlogged session is still in week 3, so week 3 becomes this week");
  assert.equal(missedWeeks(start, {}, weeks, week(2)), 0, "nothing logged, week 2: the start week counts as activity");
  assert.equal(missedWeeks(start, {}, weeks, week(3)), 2, "nothing logged, week 3: week 1 becomes this week");
  const all = {};
  weeks.forEach((w) => w.sessions.forEach((_, i) => { all[`${w.n}-${i}`] = "x"; }));
  assert.equal(missedWeeks(start, all, weeks, week(12)), 0, "a finished programme has nothing to move");
  const shifted = shiftProgrammeStart(start, 3);
  assert.equal(shifted.getDate(), 28);
  assert.equal(shifted.getHours(), 9, "time of day kept");
  assert.equal(weekNumberForDate(shifted, week(7)), 4, "after the shift, this week is week 4");
  assert.equal(sessionDate(shifted, 4, "Tue").getDate(), week(7).getDate() - 1);
  assert.equal(shiftProgrammeStart(start, 0).getTime(), start.getTime());
});
