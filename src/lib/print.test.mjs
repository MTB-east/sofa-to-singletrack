import { test } from "node:test";
import assert from "node:assert/strict";
import { printRows, planLabel } from "./print.js";
import { buildAdultPlan, buildJuniorPlan, sessionDate } from "./plan.js";

const THURSDAY = new Date(2026, 9, 15, 10, 8); // Thu 15 Oct 2026, local time

test("printRows gives one table per week with the app's dates, minutes, effort word and Done when lines", () => {
  const weeks = buildAdultPlan({ lengthWeeks: 8, daysPerWeek: 2, chosenDays: ["Sat", "Sun"] });
  const tables = printRows(weeks, THURSDAY, false);
  assert.equal(tables.length, 8);
  assert.equal(tables[0].title, "Off the sofa");
  assert.equal(tables[0].rows.length, 2, "two days a week");
  const r = tables[0].rows[1];
  assert.equal(r.day, "Sun");
  assert.equal(r.date.getTime(), sessionDate(THURSDAY, 1, "Sun").getTime());
  assert.equal(r.dateText, "Sun 18 Oct");
  assert.ok(r.name.startsWith("Skill then ride"));
  assert.equal(r.mins, "40 min");
  assert.equal(r.effort, "Chatting");
  assert.equal(r.doneWhen.length, 2, "a two-day ride carries both Done when lines");
  assert.equal(tables[2].rows[1].effort, "Breathing", "week 3's long one is Breathing on the climbs");
  assert.equal(tables[2].rows[1].effortNote, "Breathing on the climbs");
});

test("printRows for Juniors gives the game, where, what the child and grown-up do, and the badge", () => {
  const tables = printRows(buildJuniorPlan({ chosenDays: ["Sat", "Sun"] }), THURSDAY, true);
  assert.equal(tables.length, 8);
  const r = tables[0].rows[0];
  assert.equal(r.name, "Badger stands up");
  assert.equal(r.where, "park path");
  assert.ok(r.child.includes("stand on the pedals"));
  assert.equal(r.grownUp, "Counts out loud, says it about ten times.");
  assert.equal(r.badge, "Standing Badger");
  assert.equal(r.mins, "15 min");
  assert.equal(tables[7].rows[1].mins, "20 to 35 min", "the graduation lap keeps its range");
});

test("planLabel names the plan", () => {
  const twelve = buildAdultPlan({ lengthWeeks: 12 });
  assert.equal(planLabel({ junior: false }, twelve), "The 12-week plan");
  assert.equal(planLabel({ junior: false }, buildAdultPlan({ lengthWeeks: 4 })), "The 4-week Taster");
  assert.equal(planLabel({ junior: true }, []), "Sofa to Singletrack Juniors");
  assert.equal(planLabel({ raceReady: true }, [1, 2]), "Race ready (2 weeks)");
  assert.equal(planLabel({ continuation: { lengthWeeks: 12, fromWeek: 8, toWeek: 11 } }, [1, 2, 3, 4]), "Weeks 8 to 11 of the 12-week plan");
});
