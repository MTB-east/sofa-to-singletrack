import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEEKS_12, JUNIOR_WEEKS, JUNIOR_BADGES, EFFORT_WORDS, PLAN_VERSION,
  buildAdultPlan, buildContinuationPlan, buildRaceReadyPlan, buildJuniorPlan,
  planForRace, weeksUntil, weeksFromSaved, planVersionOf, reassignDays, roleLabel, isJuniorSession, trimWeekOne,
} from "./plan.js";

const names = (week) => week.sessions.map((s) => s.name);
const three = { daysPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] };
const two = { daysPerWeek: 2, chosenDays: ["Sat", "Sun"] };

test("the talk test has three words", () => {
  assert.deepEqual(Object.values(EFFORT_WORDS).map((e) => e.word), ["Chatting", "Breathing", "Can't talk"]);
  assert.equal(PLAN_VERSION, 2);
});

test("the twelve weeks are as written: three rides each, roles A B C, every one with a done-when line", () => {
  assert.equal(WEEKS_12.length, 12);
  WEEKS_12.forEach((w, i) => {
    assert.equal(w.n, i + 1);
    assert.deepEqual(w.sessions.map((s) => s.role), ["A", "B", "C"]);
    w.sessions.forEach((s) => {
      assert.ok(s.name && s.mins > 0 && s.doneWhen, `week ${w.n} ${s.role}`);
      assert.ok(["low", "med", "high"].includes(s.effort));
    });
  });
  assert.equal(WEEKS_12[7].title, "Repeat week");
  assert.deepEqual(WEEKS_12[7].sessions, WEEKS_12[6].sessions, "week 8 is week 7");
  assert.match(WEEKS_12[7].focus, /the app never adds it for them/);
  assert.deepEqual(names(WEEKS_12[8]), ["Skills", "Intervals", "The long one"]);
  assert.deepEqual(names(WEEKS_12[9]), ["Skills", "Intervals", "Race simulation"]);
  assert.deepEqual(names(WEEKS_12[10]), ["Skills", "Steady", "Course recon"]);
  assert.deepEqual(names(WEEKS_12[11]), ["Easy spin", "Kit check ride", "Graduation ride"]);
});

test("12-week race plan, three days: twelve weeks on the chosen days, Can't talk in weeks 9 and 10, race day at the end", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "race", ...three });
  assert.equal(plan.length, 12);
  assert.deepEqual(plan.map((w) => w.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  plan.forEach((w) => assert.deepEqual(w.sessions.map((s) => s.day), ["Tue", "Thu", "Sat"]));
  assert.equal(plan[8].sessions[1].effort, "high");
  assert.equal(plan[9].sessions[1].effort, "high");
  assert.equal(plan[11].sessions[2].detail, "Race day.");
  assert.equal(plan[11].sessions[2].doneWhen, "you got off the sofa and onto singletrack. That was the deal.");
  assert.equal(plan[7].title, "Repeat week");
  assert.equal(plan[7].sessions[2].mins, 60, "the optional +5 min is never applied");
  assert.equal(plan[0].elev, 8);
  assert.equal(plan[11].elev, 92);
});

test("no-race plan runs weeks 9 and 10 at Breathing with the same names", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "months", ...three });
  for (const i of [8, 9]) {
    assert.deepEqual(names(plan[i]), names(WEEKS_12[i]));
    plan[i].sessions.forEach((s) => assert.notEqual(s.effort, "high", `week ${i + 1} ${s.name}`));
    plan[i].sessions.forEach((s) => assert.doesNotMatch(s.detail, /Can't talk/));
  }
  assert.equal(plan[8].sessions[1].detail, "Five lots of one minute at Breathing, with two minutes Chatting between each. Then easy home.");
  assert.doesNotMatch(plan[8].focus, /Can't-talk/);
  assert.equal(plan[11].sessions[2].detail, "A 45-minute trail ride on your own terms, then the app's graduation card.");
  assert.equal(plan[11].sessions[2].effort, "low");
});

test("two days a week: Ride 1 is B as written, Ride 2 is the skill then C, nothing dropped", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "race", ...two });
  assert.equal(plan.length, 12);
  plan.forEach((w) => assert.deepEqual(w.sessions.map((s) => s.day), ["Sat", "Sun"]));

  const w1 = plan[0];
  assert.deepEqual(w1.sessions[0], { ...WEEKS_12[0].sessions[1], twoDay: 1, day: "Sat" }, "week 1 ride 1 is B as written");
  assert.equal(roleLabel(w1.sessions[0]), "Ride 1");
  const r2 = w1.sessions[1];
  assert.equal(r2.name, "Skill then ride: standing drill");
  assert.equal(r2.role, "C");
  assert.equal(roleLabel(r2), "Ride 2");
  assert.equal(r2.mins, 10 + 30);
  assert.match(r2.detail, /^Standing drill for 10 minutes: Ready position/);
  assert.match(r2.detail, /Then the long one: Flat or gentle, two or three stops to drink\.$/);
  assert.equal(r2.doneWhen, "you can stand and coast for a count of five without wobbling.\nyou got back and your legs feel fine.");

  const w9 = plan[8];
  assert.equal(w9.sessions[0].name, "Intervals", "week 9 ride 1 is B intervals");
  assert.equal(w9.sessions[0].effort, "high");
  assert.equal(w9.sessions[1].name, "Skill then ride: line choice");
  assert.equal(w9.sessions[1].mins, 65);
  assert.equal(w9.sessions[1].effortNote, "Chatting with a Breathing middle 15 minutes");

  const w10 = plan[9];
  assert.equal(w10.sessions[0].name, "Intervals");
  assert.equal(w10.sessions[1].name, "Skill then ride: six starts");
  assert.match(w10.sessions[1].detail, /Then race simulation: Ride a loop at Breathing all the way/);
  assert.equal(w10.sessions[1].mins, 60);

  const w11 = plan[10];
  assert.equal(w11.sessions[0].name, "Steady");
  assert.equal(w11.sessions[1].name, "Skill then ride: M-check");
  assert.match(w11.sessions[1].detail, /^M-check first: The M-check in the app/);

  const w12 = plan[11];
  assert.deepEqual(names(w12), ["Kit check ride", "Graduation ride"]);
  assert.equal(w12.sessions[1].detail, "Race day.");

  const w7 = plan[6];
  assert.equal(w7.sessions[1].name, "Skill then ride: standing climbs");
  assert.equal(w7.sessions[1].mins, 70);
  assert.match(w7.sessions[1].detail, /^Standing climbs first: /);
});

test("two-day no-race plan: intervals at Breathing, graduation ride on your own terms", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "months", ...two });
  assert.equal(plan[8].sessions[0].name, "Intervals");
  assert.equal(plan[8].sessions[0].effort, "med");
  assert.equal(plan[9].sessions[0].effort, "med");
  assert.match(plan[11].sessions[1].detail, /on your own terms/);
});

test("the 4-week Taster: weeks 1, 2, 4, then its own graduation week", () => {
  const plan = buildAdultPlan({ lengthWeeks: 4, planType: "months", ...three });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((w) => w.fullWeek), [1, 2, 4, null]);
  assert.deepEqual(plan.map((w) => w.title), ["Off the sofa", "Stopping", "Cornering", "Graduation week"]);
  const g = plan[3];
  assert.deepEqual(names(g), ["Skills", "Easy spin", "Graduation ride"]);
  assert.equal(g.sessions[0].detail, "The M-check in the app, then a short ride to test it.");
  assert.equal(g.sessions[1].mins, 30);
  assert.equal(g.sessions[2].mins, 40);
  assert.match(g.sessions[2].detail, /40-minute trail ride, then the graduation card/);
  const race = buildAdultPlan({ lengthWeeks: 4, planType: "race", ...three });
  assert.equal(race[3].sessions[2].detail, "Race day.");
  const taster2 = buildAdultPlan({ lengthWeeks: 4, planType: "months", ...two });
  assert.deepEqual(names(taster2[3]), ["Easy spin", "Skill then ride: M-check"]);
});

test("the 8-week plan: 1,2,3,4,6,7 then 9 (no race) or 10 (race), then 12", () => {
  const noRace = buildAdultPlan({ lengthWeeks: 8, planType: "months", ...three });
  assert.equal(noRace.length, 8);
  assert.deepEqual(noRace.map((w) => w.fullWeek), [1, 2, 3, 4, 6, 7, 9, 12]);
  assert.deepEqual(noRace.map((w) => w.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(noRace[6].sessions[1].name, "Intervals");
  assert.equal(noRace[6].sessions[1].effort, "med", "no-race week 9 at Breathing");
  const race = buildAdultPlan({ lengthWeeks: 8, planType: "race", ...three });
  assert.deepEqual(race.map((w) => w.fullWeek), [1, 2, 3, 4, 6, 7, 10, 12]);
  assert.equal(race[6].sessions[2].name, "Race simulation");
  assert.equal(race[7].sessions[2].detail, "Race day.");
});

test("carrying on: weeks 8 to 11 of the full plan, or the 8-week plan from week 5, as a programme of its own", () => {
  const more = buildContinuationPlan({ lengthWeeks: 12, fromWeek: 8, toWeek: 11, planType: "months", ...three });
  assert.deepEqual(more.map((w) => w.n), [1, 2, 3, 4]);
  assert.deepEqual(more.map((w) => w.fullWeek), [8, 9, 10, 11]);
  assert.deepEqual(more.map((w) => w.title), ["Repeat week", "Short, hard, fun", "Race pace, if you fancy it", "The real thing, slowly"]);
  more.forEach((w) => assert.deepEqual(w.sessions.map((s) => s.day), ["Tue", "Thu", "Sat"]));
  assert.equal(more[0].elev, 8);
  const after = buildContinuationPlan({ lengthWeeks: 8, fromWeek: 5, toWeek: 8, planType: "months", ...two });
  assert.deepEqual(after.map((w) => w.fullWeek), [6, 7, 9, 12]);
  assert.equal(after[0].sessions[1].name, "Skill then ride: descents");
});

test("Race ready: week 11 with the six starts added to Ride A, then week 12; three weeks adds week 11 as written between", () => {
  const twoWeeks = buildRaceReadyPlan({ weeksToRace: 2, ...three });
  assert.equal(twoWeeks.length, 2);
  assert.deepEqual(twoWeeks.map((w) => w.fullWeek), [11, 12]);
  const a = twoWeeks[0].sessions[0];
  assert.equal(a.name, "Skills");
  assert.equal(a.mins, 30 + 20);
  assert.match(a.detail, /^The M-check in the app, then a short ride to test it\. Starts: six practice starts/);
  assert.equal(a.doneWhen, "every point on the M checked and nothing fell off.\nsix starts without a missed pedal.");
  assert.deepEqual(names(twoWeeks[0]), ["Skills", "Steady", "Course recon"]);
  assert.deepEqual(names(twoWeeks[1]), ["Easy spin", "Kit check ride", "Graduation ride"]);
  assert.equal(twoWeeks[1].sessions[2].detail, "Race day.");

  const threeWeeks = buildRaceReadyPlan({ weeksToRace: 3, ...three });
  assert.equal(threeWeeks.length, 3);
  assert.deepEqual(threeWeeks.map((w) => w.fullWeek), [11, 11, 12]);
  assert.equal(threeWeeks[1].sessions[0].mins, 30, "the middle week is week 11 as written");

  const twoDay = buildRaceReadyPlan({ weeksToRace: 2, ...two });
  assert.equal(twoDay[0].sessions[1].name, "Skill then ride: M-check");
  assert.match(twoDay[0].sessions[1].detail, /six practice starts/);
  assert.equal(twoDay[0].sessions[1].effort, "med", "the starts are Breathing, so the combined ride is Breathing, not Chatting");
  assert.deepEqual(names(twoDay[1]), ["Kit check ride", "Graduation ride"]);
});

test("Race ready with one week to go: week 12 alone, the six starts folded into Ride A (the kit check ride on two days)", () => {
  const oneWeek = buildRaceReadyPlan({ weeksToRace: 1, ...three });
  assert.equal(oneWeek.length, 1);
  assert.deepEqual(oneWeek.map((w) => w.fullWeek), [12]);
  assert.deepEqual(names(oneWeek[0]), ["Easy spin", "Kit check ride", "Graduation ride"]);
  const a = oneWeek[0].sessions[0];
  assert.equal(a.mins, 20 + 20);
  assert.equal(a.effort, "med");
  assert.match(a.detail, /^Starts: six practice starts/);
  assert.equal(a.doneWhen, "you wanted to go further and did not.\nsix starts without a missed pedal.");
  assert.equal(oneWeek[0].sessions[1].mins, 15, "the kit check ride is as written");
  assert.equal(oneWeek[0].sessions[2].detail, "Race day.");
  assert.deepEqual(oneWeek[0].sessions.map((s) => s.day), ["Tue", "Thu", "Sat"]);
  assert.deepEqual(buildRaceReadyPlan({ weeksToRace: 0, ...three }).map((w) => w.fullWeek), [12], "0 weeks is the same block");

  const twoDay = buildRaceReadyPlan({ weeksToRace: 1, ...two });
  assert.equal(twoDay.length, 1);
  assert.deepEqual(names(twoDay[0]), ["Kit check ride", "Graduation ride"]);
  assert.equal(twoDay[0].sessions[0].mins, 15 + 20, "the starts ride with the kit check");
  assert.equal(twoDay[0].sessions[0].effort, "med");
  assert.match(twoDay[0].sessions[0].detail, /^Test tyre pressure, brakes and the clothes you will wear\. Starts: six practice starts/);
  assert.equal(twoDay[0].sessions[1].name, "Graduation ride");
  assert.equal(twoDay[0].sessions[1].mins, 45, "race day takes nothing extra");
  assert.equal(twoDay[0].sessions[1].detail, "Race day.");
});

test("two days a week: the combined ride takes the harder of the two efforts", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "race", ...two });
  assert.equal(plan[9].sessions[1].name, "Skill then ride: six starts");
  assert.equal(plan[9].sessions[1].effort, "high", "week 10: Can't-talk starts then a Breathing race simulation");
  assert.equal(plan[0].sessions[1].effort, "low", "week 1: both Chatting");
  assert.equal(plan[2].sessions[1].effort, "med", "week 3: a Chatting drill then Breathing climbs");
  const noRace = buildAdultPlan({ lengthWeeks: 12, planType: "months", ...two });
  assert.equal(noRace[9].sessions[1].effort, "med", "no-race week 10 is Breathing all through");
});

test("two-day Taster on the race plan: race day is just the graduation ride, no M-check folded in and no extra minutes", () => {
  const race = buildAdultPlan({ lengthWeeks: 4, planType: "race", ...two });
  assert.deepEqual(names(race[3]), ["Easy spin", "Graduation ride"]);
  const g = race[3].sessions[1];
  assert.equal(g.detail, "Race day.");
  assert.equal(g.mins, 45);
  assert.equal(g.effort, "med");
  assert.equal(g.combined, undefined);
  assert.equal(g.doneWhen, "you got off the sofa and onto singletrack. That was the deal.");
  const noRace = buildAdultPlan({ lengthWeeks: 4, planType: "months", ...two });
  assert.equal(noRace[3].sessions[1].name, "Skill then ride: M-check", "the no-race Taster still folds the M-check into the graduation ride");
  assert.equal(noRace[3].sessions[1].mins, 50);
});

test("picking a race: under four weeks is Race ready, otherwise the longest plan that fits, held back so it ends in race week", () => {
  assert.deepEqual(planForRace(0), { kind: "raceReady", weeksToRace: 1 }, "race this week: the taper week only");
  assert.deepEqual(planForRace(1), { kind: "raceReady", weeksToRace: 1 }, "race next week: never a 2-week block that ends after it");
  assert.deepEqual(planForRace(2), { kind: "raceReady", weeksToRace: 2 });
  assert.deepEqual(planForRace(3), { kind: "raceReady", weeksToRace: 3 });
  assert.deepEqual(planForRace(4), { kind: "plan", lengthWeeks: 4, delayWeeks: 0 });
  assert.deepEqual(planForRace(6), { kind: "plan", lengthWeeks: 4, delayWeeks: 2 });
  assert.deepEqual(planForRace(8), { kind: "plan", lengthWeeks: 8, delayWeeks: 0 });
  assert.deepEqual(planForRace(10), { kind: "plan", lengthWeeks: 8, delayWeeks: 2 });
  assert.deepEqual(planForRace(12), { kind: "plan", lengthWeeks: 12, delayWeeks: 0 });
  assert.deepEqual(planForRace(14), { kind: "plan", lengthWeeks: 12, delayWeeks: 2 });
  assert.deepEqual(planForRace(20), { kind: "plan", lengthWeeks: 12, delayWeeks: 0 }, "too far off to wait: start now");
  const now = new Date(2026, 9, 15);
  assert.equal(weeksUntil("2026-11-05", now), 3);
  assert.equal(weeksUntil("2027-03-14", new Date(2026, 10, 1)), 19, "1 Nov to 14 Mar is 133 days");
  assert.equal(weeksUntil("2026-10-01", now), 0);
});

test("Juniors: eight weeks, two sessions, every one a game with where, child, grown-up and a badge, Chatting or Breathing only", () => {
  const plan = buildJuniorPlan({ chosenDays: ["Wed", "Sat"] });
  assert.equal(plan.length, 8);
  const sessions = plan.flatMap((w) => w.sessions);
  assert.equal(sessions.length, 16);
  sessions.forEach((s) => {
    assert.ok(isJuniorSession(s));
    assert.ok(s.name && s.child && s.grownUp && s.badge && s.doneWhen, s.name);
    assert.ok(typeof s.where === "string");
    assert.ok(s.mins >= 15 && s.mins <= 35, `${s.name} ${s.mins}`);
    assert.ok(["low", "med"].includes(s.effort), `${s.name} is never Can't talk`);
    assert.ok(["Badger", "Squirrel"].includes(s.helper));
  });
  plan.forEach((w) => assert.deepEqual(w.sessions.map((s) => s.day), ["Wed", "Sat"]));
  assert.deepEqual(JUNIOR_BADGES, [
    "Standing Badger", "Tree Spotter", "Marshal's Whistle", "Puddle Pilot", "Squirrel Sprinter", "Gear Changer",
    "Slalom Squirrel", "Line Follower", "Stick Jumper", "Root Counter", "Slope Slider", "Snack Stopper",
    "Lap Counter", "Starter", "Bike Checker", "Sofa to Singletrack Junior",
  ]);
  assert.equal(new Set(JUNIOR_BADGES).size, 16, "badges are unique");
  assert.deepEqual(plan.map((w) => w.title), ["Badger Basics", "The Marshal's Whistle", "Squirrel Sprints", "Cornering with the cones", "Bumps and roots", "Up and down", "Laps", "Graduation"]);
  assert.equal(sessions[15].minsText, "20 to 35 min");
  assert.equal(roleLabel(sessions[0]), "Session 1");
  assert.equal(roleLabel(sessions[1]), "Session 2");
  assert.equal(roleLabel(WEEKS_12[0].sessions[0]), "Ride A");
  assert.equal(JUNIOR_WEEKS.length, 8);
  assert.equal(buildJuniorPlan({}).length, 8, "defaults to Sat/Sun");
});

test("a saved programme keeps its weeks verbatim whatever version built it", () => {
  const old = { weeks: [{ n: 1, title: "Off the sofa", sessions: [{ name: "Easy spin", mins: 20, effort: "low", detail: "{mins} min", day: "Tue" }] }] };
  assert.equal(planVersionOf(old), 1);
  assert.deepEqual(weeksFromSaved(old), old.weeks);
  const fresh = { planVersion: 2, weeks: buildAdultPlan({ lengthWeeks: 4, ...three }) };
  assert.equal(planVersionOf(fresh), 2);
  assert.equal(weeksFromSaved(fresh), fresh.weeks);
  assert.equal(weeksFromSaved({ weeks: [] }), null);
  assert.equal(weeksFromSaved(null), null);
});

test("changing days keeps the programme and moves the sessions; a trimmed week 1 keeps the last of the new days", () => {
  const plan = trimWeekOne(buildAdultPlan({ lengthWeeks: 4, ...three }), new Date(2026, 9, 15)); // a Thursday: Tue dropped
  assert.equal(plan[0].sessions.length, 2);
  const moved = reassignDays(plan, ["Mon", "Wed", "Fri"]);
  assert.deepEqual(moved[0].sessions.map((s) => s.day), ["Wed", "Fri"]);
  assert.deepEqual(moved[1].sessions.map((s) => s.day), ["Mon", "Wed", "Fri"]);
  assert.equal(moved[1].sessions[0].name, plan[1].sessions[0].name, "sessions untouched");
});

// ---- Added in the audit against the signed-off document ------------------------------------------

import { readFileSync } from "node:fs";

test("the twelve weeks carry the document's titles and focus lines", () => {
  assert.deepEqual(WEEKS_12.map((w) => w.title), [
    "Off the sofa", "Stopping", "Gears and the first hill", "Cornering", "Rolling terrain", "The long one gets long",
    "Your first hour", "Repeat week", "Short, hard, fun", "Race pace, if you fancy it", "The real thing, slowly", "Taper and graduation",
  ]);
  assert.equal(WEEKS_12[0].focus, "Get on, ride, get off, smile.");
  assert.equal(WEEKS_12[3].focus, "Look where you want to go. The bike follows your eyes.");
  assert.equal(WEEKS_12[7].focus, "Same as week 7. Couch to 5K does this on purpose: the second time is when it feels normal. Riders who found week 7 easy can add five minutes to each ride; the app never adds it for them.");
  assert.deepEqual(WEEKS_12.map((w) => w.sessions.map((s) => s.mins)), [
    [20, 20, 30], [25, 25, 35], [25, 25, 40], [25, 30, 40], [25, 35, 45], [25, 35, 50], [25, 35, 60], [25, 35, 60],
    [25, 35, 55], [20, 35, 50], [30, 30, 40], [20, 15, 45],
  ]);
  const all = WEEKS_12.flatMap((w) => w.sessions);
  all.forEach((s) => {
    assert.doesNotMatch(s.detail, /\{mins\}/, "no placeholders in the signed-off copy");
    assert.doesNotMatch(s.doneWhen, /^Done when/i, "doneWhen holds the line itself, the card adds the label");
  });
});

test("the two-day table, week by week: Ride 1 is B, Ride 2 is the skill then C, with the 10 minutes where the table says", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "race", ...two });
  const expectRide2 = [
    ["standing drill", true], ["braking line", true], ["five rises", false], ["figure-of-eights", true], ["roll-overs", true],
    ["descents", true], ["standing climbs", false], ["standing climbs", false], ["line choice", false], ["six starts", false], ["M-check", false],
  ];
  expectRide2.forEach(([skill, tenMin], i) => {
    const [r1, r2] = plan[i].sessions;
    assert.equal(plan[i].sessions.length, 2, `week ${i + 1} has two rides`);
    assert.equal(r1.name, WEEKS_12[i].sessions[1].name, `week ${i + 1} ride 1 is B`);
    assert.equal(r1.detail, WEEKS_12[i].sessions[1].detail);
    assert.equal(r2.name, `Skill then ride: ${skill}`, `week ${i + 1} ride 2`);
    assert.equal(r2.combined, true);
    assert.equal(r2.mins, 10 + WEEKS_12[i].sessions[2].mins, `week ${i + 1} ride 2 is 10 + C`);
    const order = { low: 0, med: 1, high: 2 };
    const harder = [WEEKS_12[i].sessions[0].effort, WEEKS_12[i].sessions[2].effort].sort((x, y) => order[y] - order[x])[0];
    assert.equal(r2.effort, harder, `week ${i + 1} ride 2 is the harder of A and C`);
    assert.ok(r2.detail.startsWith(tenMin ? `${skill[0].toUpperCase()}${skill.slice(1)} for 10 minutes: ` : `${skill[0].toUpperCase()}${skill.slice(1)} first: `), `week ${i + 1}: ${r2.detail}`);
    assert.ok(r2.detail.includes(WEEKS_12[i].sessions[0].detail), "A's drill is in the text");
    assert.ok(r2.doneWhen.startsWith(WEEKS_12[i].sessions[0].doneWhen), "A's done-when first");
    assert.ok(r2.doneWhen.endsWith(WEEKS_12[i].sessions[2].doneWhen), "C's done-when second");
  });
  assert.match(plan[5].sessions[1].detail, /Then the long one: Eat something at 20 minutes/, "week 6: C with the snack");
  assert.match(plan[6].sessions[1].detail, /Then the long one: Mixed terrain\. First ride over an hour\./, "week 7: then the hour");
  assert.deepEqual(plan[11].sessions.map((s) => s.name), ["Kit check ride", "Graduation ride"]);
  assert.equal(plan[11].sessions[0].mins, 15);
});

test("no-race week 10: the six starts and the intervals drop to Breathing, the race simulation stays at Breathing", () => {
  const plan = buildAdultPlan({ lengthWeeks: 12, planType: "months", ...three });
  assert.deepEqual(plan[9].sessions.map((s) => s.effort), ["med", "med", "med"]);
  assert.equal(plan[9].sessions[0].detail, WEEKS_12[9].sessions[0].detail, "the starts drill reads the same");
  assert.equal(plan[9].sessions[1].detail, "Five lots of two minutes at Breathing, two minutes Chatting between.");
  const race = buildAdultPlan({ lengthWeeks: 12, planType: "race", ...three });
  assert.deepEqual(race[9].sessions.map((s) => s.effort), ["high", "high", "med"]);
  assert.equal(race[7].sessions[1].effort, "low", "week 8 (and 7) stay at Chatting on both plans");
});

test("the Taster on the race plan ends on race day; the carry-on from it is the 8-week plan's weeks 5 to 8", () => {
  const race = buildAdultPlan({ lengthWeeks: 4, planType: "race", ...three });
  assert.equal(race[3].title, "Graduation week");
  assert.equal(race[3].sessions[2].name, "Graduation ride");
  assert.equal(race[3].sessions[2].detail, "Race day.");
  assert.equal(race[3].sessions[2].doneWhen, "you got off the sofa and onto singletrack. That was the deal.");
  const after = buildContinuationPlan({ lengthWeeks: 8, fromWeek: 5, toWeek: 8, planType: "months", ...three });
  assert.deepEqual(after.map((w) => w.title), ["The long one gets long", "Your first hour", "Short, hard, fun", "Taper and graduation"]);
  assert.deepEqual(after.map((w) => w.n), [1, 2, 3, 4]);
  assert.equal(after[3].sessions[2].detail, "A 45-minute trail ride on your own terms, then the app's graduation card.");
});

test("Juniors: the document's games, places, grown-up jobs and badges, word for word", () => {
  const s = JUNIOR_WEEKS.flatMap((w) => w.sessions);
  assert.deepEqual(s.map((x) => x.name), [
    "Badger stands up", "Look where the squirrel went", "Whistle stops", "Puddle Pilot", "Squirrel sprints", "Gear for the hill",
    "Bottle slalom", "Follow the leader", "Stick jumps", "Badger's bumpy trail", "Slope slider", "The snack stop",
    "Lap the park", "Start line", "M-check with a grown-up", "Graduation lap",
  ]);
  assert.deepEqual(s.map((x) => x.mins), [15, 15, 20, 20, 20, 20, 25, 25, 25, 30, 25, 30, 30, 25, 20, 35]);
  assert.deepEqual(s.slice(0, 4).map((x) => x.where), ["park path", "field", "flat path", "somewhere with puddles (a dry day works too: a chalk circle)"]);
  assert.equal(s[0].child, "Every time the grown-up says \"badger!\", stand on the pedals and coast for a count of three.");
  assert.equal(s[0].grownUp, "Counts out loud, says it about ten times.");
  assert.equal(s[2].grownUp, "Starts gentle, gets sneakier.");
  assert.equal(s[3].grownUp, "Counts puddles, accepts splashing.");
  assert.equal(s[5].grownUp, "Checks the gear change happened before the slope.");
  assert.equal(s[9].grownUp, "Counts too; the higher number wins.");
  assert.equal(s[15].where, "A real MTB east kids' course (U7 is about 400 m a lap, U9 about 900 m, U12 just over a kilometre) or the park loop.");
  assert.equal(s[15].doneWhen, "you did it, and the grown-up has a photo.");
  s.forEach((x) => {
    assert.doesNotMatch(`${x.child} ${x.grownUp} ${x.doneWhen}`, /Can't[ -]talk effort/, x.name);
    assert.ok(!x.detail, "a Juniors session has no adult 'detail': the card shows the game instead");
  });
  assert.equal(roleLabel({ name: "Easy spin", mins: 20 }), "", "a session saved before planVersion 2 has no role and no label");
  assert.equal(isJuniorSession({ name: "Easy spin" }), false);
});

test("every session and game name has an icon in the app (nothing falls back to the generic one)", () => {
  const src = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("const SESSION_ICONS = {"), src.indexOf("};", src.indexOf("const SESSION_ICONS = {")));
  const iconNames = new Set([...block.matchAll(/"([^"]+)":/g)].map((m) => m[1]));
  const names = new Set([
    ...WEEKS_12.flatMap((w) => w.sessions.map((s) => s.name)),
    ...JUNIOR_WEEKS.flatMap((w) => w.sessions.map((s) => s.name)),
    ...buildAdultPlan({ lengthWeeks: 4, ...three })[3].sessions.map((s) => s.name),
    ...buildRaceReadyPlan({ weeksToRace: 2, ...three }).flatMap((w) => w.sessions.map((s) => s.name)),
  ]);
  for (const n of names) assert.ok(iconNames.has(n), `no icon for "${n}"`);
  // Two-day sessions are named "Skill then ride: <skill>" and share one icon via their prefix.
  assert.ok(iconNames.has("Skill then ride"));
  buildAdultPlan({ lengthWeeks: 12, ...two }).flatMap((w) => w.sessions).forEach((s) => {
    assert.ok(iconNames.has(s.name) || s.name.startsWith("Skill then ride"), `no icon for "${s.name}"`);
  });
});
