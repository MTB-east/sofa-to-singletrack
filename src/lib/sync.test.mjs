import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseSaved, needsBlankFallback, newRiderId, namesDiffer, normaliseRiderIndex, freshRiderIndex, shouldSplitMain, renameRider,
  isRemovedRider, markRemoved, confirmRemoved, dropRiders, withLastSaved, retryDelay, mergeLogs, syncStatusLine, changingLabel,
  sessionWords, recentlyLogged,
} from "./plan.js";

const BLANK = {
  profile: { name: "", junior: false, sessionsPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"], raceReady: false, delayWeeks: 0 },
  weeks: [{ n: 1, sessions: [{ day: "Tue" }] }], planVersion: 2, reminderTime: "17:30", stage: "onboarding",
};

const goodCopy = () => ({
  profile: { name: "Sam", chosenDays: ["Tue", "Thu", "Sat"], junior: 0, sessionsPerWeek: 3 },
  weeks: [{ n: 1, title: "Off the sofa", sessions: [{ day: "Tue", name: "Skills" }, { day: "Thu", name: "Steady" }] }],
  planVersion: 2, sessionLog: { "1-0": "About right" }, sessionDurations: { "1-0": 22 }, badges: ["First ride done"],
  adHocLog: [{ week: 1, at: 1700000000000, mins: 30, feeling: "Fine" }], savedAt: 1700000001000,
  programStart: "2026-10-12T17:30:00.000Z", continuedFrom: null, stage: "dashboard", notifAsked: 1, lastActivityAt: 1700000000000,
});

test("normaliseSaved keeps a good copy as it is, with types tidied", () => {
  const safe = normaliseSaved(goodCopy(), BLANK);
  assert.equal(safe.profile.name, "Sam");
  assert.deepEqual(safe.profile.chosenDays, ["Tue", "Thu", "Sat"]);
  assert.equal(safe.profile.junior, false);
  assert.equal(safe.weeks.length, 1);
  assert.equal(safe.weeks[0].sessions[1].name, "Steady");
  assert.deepEqual(safe.sessionLog, { "1-0": "About right" });
  assert.deepEqual(safe.sessionDurations, { "1-0": 22 });
  assert.deepEqual(safe.badges, ["First ride done"]);
  assert.equal(safe.adHocLog[0].mins, 30);
  assert.equal(safe.savedAt, 1700000001000);
  assert.equal(safe.programStart, "2026-10-12T17:30:00.000Z");
  assert.equal(safe.continuedFrom, null);
  assert.equal(safe.notifAsked, true, "booleans are coerced");
  assert.equal(safe.stage, "dashboard");
  assert.equal(needsBlankFallback(safe), false);
});

test("normaliseSaved accepts JSON text and rejects rubbish", () => {
  assert.equal(normaliseSaved("not json", BLANK), null);
  assert.equal(normaliseSaved("[1,2]", BLANK), null);
  assert.equal(normaliseSaved(null, BLANK), null);
  const safe = normaliseSaved(JSON.stringify(goodCopy()), BLANK);
  assert.equal(safe.profile.name, "Sam");
});

test("normaliseSaved repairs every field it can and nulls the ones it cannot", () => {
  const safe = normaliseSaved({
    profile: { name: "x".repeat(60), chosenDays: ["Tue", "Funday", 3], junior: "yes" },
    weeks: [{ n: "1", sessions: [] }],
    sessionLog: { "1-0": "About right", "1-1": { bad: true }, "1-2": null },
    sessionDurations: { "1-0": "22", "1-1": NaN },
    badges: ["ok", 4, null],
    adHocLog: [{ week: 1, at: "soon" }, { at: 5, mins: "x" }, "junk"],
    savedAt: "yesterday", programStart: "not a date", continuedFrom: "", stage: "dashboard", comebackNudgeShown: "y",
  }, BLANK);
  assert.equal(safe.profile.name.length, 40);
  assert.deepEqual(safe.profile.chosenDays, ["Tue"]);
  assert.equal(safe.profile.junior, true);
  assert.equal(safe.weeks, null, "a week with a string n is not a usable programme");
  assert.deepEqual(safe.sessionLog, { "1-0": "About right" });
  assert.deepEqual(safe.sessionDurations, { "1-0": "22" });
  assert.deepEqual(safe.badges, ["ok"]);
  assert.deepEqual(safe.adHocLog, [{ week: 0, at: 5, mins: 0, feeling: "" }]);
  assert.equal(safe.savedAt, 0);
  assert.equal(safe.programStart, null);
  assert.equal(safe.continuedFrom, null);
  assert.equal(safe.comebackNudgeShown, true);
  assert.equal(safe.planVersion, 1, "a copy without a plan version is a version-1 copy");
  assert.equal(needsBlankFallback(safe), true, "on the dashboard with no weeks: start blank and keep the raw text");
  const onboarding = normaliseSaved({ profile: {}, stage: "onboarding" }, BLANK);
  assert.equal(needsBlankFallback(onboarding), false, "setup with no weeks yet is normal");
  assert.deepEqual(onboarding.profile.chosenDays, [], "a missing chosenDays is an empty list");
});

test("normaliseSaved drops fields it does not know, such as a backup file's `backup`", () => {
  const safe = normaliseSaved({ ...goodCopy(), backup: { sessionLog: {} }, anything: 1 }, BLANK);
  assert.equal("backup" in safe, false);
  assert.equal("anything" in safe, false);
});

test("rider ids are six base36 characters", () => {
  for (let i = 0; i < 50; i++) assert.match(newRiderId(), /^[0-9a-z]{6}$/);
  assert.equal(newRiderId(() => 0), "000000");
  assert.equal(newRiderId(() => 0.9999999), "zzzzzz");
});

test("a fresh device mints an id; a device with legacy data keeps main", () => {
  const fresh = freshRiderIndex(false, () => "abc123");
  assert.deepEqual(fresh, { active: "abc123", riders: [{ id: "abc123", name: "" }], removed: [] });
  const legacy = freshRiderIndex(true);
  assert.equal(legacy.active, "main");
});

test("normaliseRiderIndex tidies a stored index and rejects a broken one", () => {
  assert.equal(normaliseRiderIndex(null), null);
  assert.equal(normaliseRiderIndex({ active: "x", riders: [{ id: "y", name: "A" }] }), null, "active must be a rider");
  const idx = normaliseRiderIndex({ active: "main", riders: [{ id: "main", name: "Sam", lastSavedAt: 5 }, { id: 7 }, { id: "k1", name: 3 }], removed: [{ id: "old", at: 1, pendingDelete: true }, "junk"] });
  assert.deepEqual(idx, { active: "main", riders: [{ id: "main", name: "Sam", lastSavedAt: 5 }, { id: "k1", name: "" }], removed: [{ id: "old", at: 1, pendingDelete: true }] });
  assert.deepEqual(normaliseRiderIndex({ active: "main", riders: [{ id: "main" }] }).removed, [], "no removed list is an empty one");
});

test("two different named people both called main are split, same name or no name are not", () => {
  const idx = { active: "main", riders: [{ id: "main", name: "Sam" }], removed: [] };
  assert.equal(namesDiffer("Sam", "sam "), false);
  assert.equal(namesDiffer("Sam", "Jo"), true);
  assert.equal(namesDiffer("", "Jo"), false);
  assert.equal(shouldSplitMain(idx, "Sam", "Jo"), true);
  assert.equal(shouldSplitMain(idx, "Sam", "SAM"), false);
  assert.equal(shouldSplitMain(idx, "", "Jo"), false);
  assert.equal(shouldSplitMain({ ...idx, active: "k1", riders: [...idx.riders, { id: "k1", name: "Jo" }] }, "Sam", "Jo"), false, "only when main is the active rider");
  const renamed = renameRider(idx, "main", "q9z8y7");
  assert.equal(renamed.active, "q9z8y7");
  assert.deepEqual(renamed.riders, [{ id: "q9z8y7", name: "Sam" }]);
});

test("removed riders are remembered and never re-pushed", () => {
  let idx = { active: "main", riders: [{ id: "main", name: "Sam" }, { id: "k1", name: "Jo" }], removed: [] };
  idx = markRemoved(idx, "k1", 100, true);
  assert.equal(isRemovedRider(idx, "k1"), true);
  assert.equal(isRemovedRider(idx, "main"), false);
  assert.deepEqual(idx.riders.map((r) => r.id), ["main"]);
  assert.deepEqual(idx.removed, [{ id: "k1", at: 100, pendingDelete: true }]);
  idx = confirmRemoved(idx, ["k1"]);
  assert.deepEqual(idx.removed, [{ id: "k1", at: 100 }]);
});

test("riders removed on another device are dropped here; the active rider moves on, or a blank one is minted", () => {
  const idx = { active: "k1", riders: [{ id: "main", name: "Sam" }, { id: "k1", name: "Jo" }], removed: [] };
  const r1 = dropRiders(idx, ["k1", "nobody"], 200);
  assert.deepEqual(r1.dropped.map((r) => r.name), ["Jo"]);
  assert.equal(r1.index.active, "main");
  assert.equal(r1.activeChanged, true);
  assert.deepEqual(r1.index.removed, [{ id: "k1", at: 200 }]);
  const r2 = dropRiders(idx, ["main"], 200);
  assert.equal(r2.index.active, "k1");
  assert.equal(r2.activeChanged, false);
  const r3 = dropRiders(idx, ["main", "k1"], 200, () => "new123");
  assert.deepEqual(r3.index.riders, [{ id: "new123", name: "" }]);
  assert.equal(r3.index.active, "new123");
  const none = dropRiders(idx, [], 200);
  assert.equal(none.index, idx);
  assert.deepEqual(withLastSaved(idx, "k1", 999).riders[1], { id: "k1", name: "Jo", lastSavedAt: 999 });
});

test("push retries back off 10 s, 30 s, 2 min then 10 min", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelay), [10000, 30000, 120000, 600000, 600000, 600000]);
});

test("mergeLogs unions the logs, the newer side winning a shared key, and says whether anything changed", () => {
  const local = { savedAt: 200, sessionLog: { "1-0": "About right", "1-1": "Easier than expected" }, sessionDurations: { "1-0": 20 }, badges: ["First ride done"], adHocLog: [{ week: 1, at: 1, mins: 30, feeling: "Fine" }] };
  const remote = { savedAt: 100, sessionLog: { "1-1": "Tougher than expected", "2-0": "About right" }, sessionDurations: { "2-0": 35 }, badges: ["First ride done", "First week done"], adHocLog: [{ week: 1, at: 1, mins: 30, feeling: "Fine" }, { week: 2, at: 2, mins: 40, feeling: "Fine" }] };
  const m = mergeLogs(local, remote);
  assert.equal(m.changed, true);
  assert.deepEqual(m.sessionLog, { "1-0": "About right", "1-1": "Easier than expected", "2-0": "About right" }, "local is newer so keeps 1-1");
  assert.deepEqual(m.sessionDurations, { "1-0": 20, "2-0": 35 });
  assert.deepEqual(m.badges, ["First ride done", "First week done"]);
  assert.equal(m.adHocLog.length, 2, "union by time, no duplicate");
  const m2 = mergeLogs({ ...local, savedAt: 50 }, remote);
  assert.equal(m2.sessionLog["1-1"], "Tougher than expected", "the account's copy is newer so its value wins");
  const same = mergeLogs(local, { savedAt: 10, sessionLog: { "1-0": "About right" }, badges: ["First ride done"], adHocLog: [] });
  assert.equal(same.changed, false, "nothing new from the account: no state update needed");
  assert.equal(mergeLogs(local, null).changed, false);
});

test("the account card says what actually happened", () => {
  const now = new Date(2026, 9, 15, 14, 5).getTime();
  assert.equal(syncStatusLine({ status: "saved", at: now - 10000 }, now).text, "Saved to your account just now.");
  assert.equal(syncStatusLine({ status: "saved", at: now - 3 * 60000 }, now).text, "Saved to your account 3 min ago.");
  assert.equal(syncStatusLine({ status: "saved", at: new Date(2026, 9, 15, 14, 2).getTime() - 2 * 3600000 }, now).text, "Saved to your account at 12:02.");
  assert.match(syncStatusLine({ status: "saved", at: new Date(2026, 9, 13, 9, 30).getTime() }, now).text, /^Saved to your account on Tue 13 Oct at 09:30\.$/);
  const pending = syncStatusLine({ status: "pending", lastSavedAt: new Date(2026, 9, 15, 14, 2).getTime() }, now);
  assert.equal(pending.text, "Not saved to your account since 14:02. Check your connection.");
  assert.equal(syncStatusLine({ status: "offline", lastSavedAt: new Date(2026, 9, 13, 9, 30).getTime() }, now).text, "Not saved to your account since Tue 13 Oct at 09:30. Check your connection.");
  assert.equal(pending.tone, "warn");
  assert.equal(syncStatusLine({ status: "pending" }, now).text, "Not saved to your account yet. Check your connection.");
  const out = syncStatusLine({ status: "signedOut", since: now }, now);
  assert.equal(out.text, "You've been signed out. Sign in again to keep saving.");
  assert.equal(out.signIn, true);
  assert.equal(syncStatusLine({ status: "removed" }, now).text, "This rider was removed on another device.");
  assert.equal(syncStatusLine({ status: "connecting" }, now).tone, "muted");
  assert.equal(syncStatusLine(null, now).tone, "muted");
});

test("the change heading and the words for a logged session", () => {
  assert.equal(changingLabel({ day: "Tue", role: "A" }), "Changing Tuesday's Ride A");
  assert.equal(changingLabel({ day: "Sat", role: "J1" }), "Changing Saturday's Session 1");
  assert.equal(changingLabel({ day: "Sun", role: "C", twoDay: 2 }), "Changing Sunday's Ride 2");
  assert.equal(changingLabel({ name: "Steady" }), "Changing Steady");
  assert.equal(sessionWords({ day: "Thu", role: "B" }), "Thursday's Ride B");
  const all = [{ key: "1-0" }, { key: "1-1" }, { key: "1-2" }];
  assert.deepEqual(recentlyLogged(all, { "1-0": "x", "1-2": "y", "1-1": "z" }).map((s) => s.key), ["1-1", "1-2"], "newest first");
  assert.deepEqual(recentlyLogged(all, { "9-9": "x" }), [], "keys not in the programme are ignored");
});

test("normaliseSaved keeps clearedLog as a map of times and drops anything else", () => {
  const safe = normaliseSaved({ ...goodCopy(), clearedLog: { "1-0": 1700000002000, "1-1": "later", "2-0": null } }, BLANK);
  assert.deepEqual(safe.clearedLog, { "1-0": 1700000002000 });
  assert.deepEqual(normaliseSaved(goodCopy(), BLANK).clearedLog, {}, "no clearedLog is an empty one");
  assert.deepEqual(normaliseSaved({ ...goodCopy(), clearedLog: "x" }, BLANK).clearedLog, {});
});

test("mergeLogs keeps a session cleared on one side instead of bringing it back from the other", () => {
  // The phone cleared 1-1 at t=300 (after the tablet's copy was saved at 200): the tablet's 1-1 stays cleared.
  const phone = { savedAt: 300, sessionLog: { "1-0": "About right" }, sessionDurations: { "1-0": 20 }, clearedLog: { "1-1": 300 }, badges: [], adHocLog: [] };
  const tablet = { savedAt: 200, sessionLog: { "1-0": "About right", "1-1": "Easier than expected" }, sessionDurations: { "1-0": 20, "1-1": 25 }, badges: [], adHocLog: [] };
  const m = mergeLogs(phone, tablet);
  assert.deepEqual(m.sessionLog, { "1-0": "About right" });
  assert.deepEqual(m.sessionDurations, { "1-0": 20 });
  assert.deepEqual(m.clearedLog, { "1-1": 300 }, "the cleared marker is kept");
  assert.equal(m.changed, false, "nothing new for the phone");
  // Seen from the tablet's side the same merge drops its own 1-1.
  const m2 = mergeLogs(tablet, phone);
  assert.deepEqual(m2.sessionLog, { "1-0": "About right" });
  assert.deepEqual(m2.sessionDurations, { "1-0": 20 });
  assert.deepEqual(m2.clearedLog, { "1-1": 300 });
  assert.equal(m2.changed, true);
  // Logged again after the clear (the copy with the key was saved after the clear time): the ride stands.
  const tabletLater = { ...tablet, savedAt: 400 };
  assert.deepEqual(mergeLogs(phone, tabletLater).sessionLog, { "1-0": "About right", "1-1": "Easier than expected" });
  assert.deepEqual(mergeLogs(tabletLater, phone).sessionLog, { "1-0": "About right", "1-1": "Easier than expected" });
  // A key both sides still hold is never dropped by a stale marker.
  const both = mergeLogs({ ...phone, sessionLog: { ...phone.sessionLog, "1-1": "About right" } }, tablet);
  assert.equal(both.sessionLog["1-1"], "About right");
  // clearedLog merges by the latest time per key.
  const c = mergeLogs({ savedAt: 1, sessionLog: {}, clearedLog: { a: 5, b: 9 } }, { savedAt: 1, sessionLog: {}, clearedLog: { a: 7, c: 2 } });
  assert.deepEqual(c.clearedLog, { a: 7, b: 9, c: 2 });
  assert.equal(c.changed, true);
});
