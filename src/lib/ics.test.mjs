import { test } from "node:test";
import assert from "node:assert/strict";
import { icsEscape, foldLine, programmeIcs, icsSummary, icsDescription, ICS_PRODID } from "./ics.js";
import { buildAdultPlan, buildJuniorPlan, sessionDate } from "./plan.js";

const THURSDAY = new Date(2026, 9, 15, 10, 8); // Thu 15 Oct 2026, local time
const NOW = new Date(Date.UTC(2026, 9, 16, 9, 30, 0));

const utf8 = (s) => new TextEncoder().encode(s).length;
const unfold = (text) => text.replace(/\r\n[ \t]/g, "");
const events = (text) => (unfold(text).match(/BEGIN:VEVENT/g) || []).length;

test("text is escaped for a property value", () => {
  assert.equal(icsEscape("a, b; c\\d\nnext"), "a\\, b\\; c\\\\d\\nnext");
  assert.equal(icsEscape(null), "");
});

test("lines are folded at 75 octets and nothing is lost", () => {
  const long = "DESCRIPTION:" + "Climbing standing up: on a short rise, stand for the last ten metres. ".repeat(4) + "Café ride 🚵 at the end.";
  const folded = foldLine(long);
  assert.ok(folded.length > 1, "a long line is folded");
  for (const l of folded) assert.ok(utf8(l) <= 75, `every piece fits: ${utf8(l)} octets`);
  for (const l of folded.slice(1)) assert.ok(l.startsWith(" "), "continuations start with a space");
  assert.equal(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join(""), long, "unfolding gives the line back");
  assert.deepEqual(foldLine("SUMMARY:short"), ["SUMMARY:short"], "a short line is untouched");
});

test("one all-day event per unlogged session, dated like the app, with a stable UID", () => {
  const weeks = buildAdultPlan({ lengthWeeks: 4, daysPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] });
  const total = weeks.reduce((n, w) => n + w.sessions.length, 0);
  const text = programmeIcs(weeks, THURSDAY, {}, "abc123", NOW);
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:" + ICS_PRODID + "\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.equal(events(text), total, "every session is in");
  assert.ok(!/[^\r]\n/.test(text), "every line break is CRLF");
  for (const l of text.split("\r\n")) assert.ok(utf8(l) <= 75, `folded: ${l}`);
  const flat = unfold(text);
  assert.ok(flat.includes("UID:abc123-1-0@mtbeast.co.uk"));
  assert.ok(flat.includes("DTSTAMP:20261016T093000Z"));
  const firstDate = sessionDate(THURSDAY, 1, weeks[0].sessions[0].day);
  const ymd = `${firstDate.getFullYear()}${String(firstDate.getMonth() + 1).padStart(2, "0")}${String(firstDate.getDate()).padStart(2, "0")}`;
  assert.ok(flat.includes(`DTSTART;VALUE=DATE:${ymd}`), "all-day on the session's date");
  assert.ok(flat.includes("SUMMARY:Sofa to Singletrack: Skills (20 min)"));
  assert.ok(flat.includes("Done when: "), "the Done when line is in the description");
  assert.ok(flat.includes("\\,"), "commas in the detail are escaped");
});

test("a logged session is left out", () => {
  const weeks = buildAdultPlan({ lengthWeeks: 4, daysPerWeek: 3, chosenDays: ["Tue", "Thu", "Sat"] });
  const total = weeks.reduce((n, w) => n + w.sessions.length, 0);
  const text = programmeIcs(weeks, THURSDAY, { "1-0": "About right", "1-1": "Didn't get to it" }, "abc123", NOW);
  assert.equal(events(text), total - 2);
  assert.ok(!unfold(text).includes("UID:abc123-1-0@"));
  assert.ok(unfold(text).includes("UID:abc123-1-2@"));
});

test("a Juniors game says it is with a grown-up and describes the game", () => {
  const weeks = buildJuniorPlan({ chosenDays: ["Sat", "Sun"] });
  const s = weeks[0].sessions[0];
  assert.equal(icsSummary(s), "Sofa to Singletrack: Badger stands up (15 min, with a grown-up)");
  const d = icsDescription(s, weeks[0], weeks.length);
  assert.ok(d.startsWith("Week 1 of 8: Badger Basics\n"));
  assert.ok(d.includes("Where: park path"));
  assert.ok(d.includes("What the grown-up does: "));
  assert.ok(d.includes("Badge: Standing Badger"));
  assert.ok(d.includes("Done when: three clean"));
});
