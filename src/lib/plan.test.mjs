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
