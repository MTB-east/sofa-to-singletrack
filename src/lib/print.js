// The programme laid out for paper: one table per week. Pure, so it can be tested with node:test; the print view in
// App.jsx only draws what this returns.

import { sessionDate, EFFORT_WORDS, isJuniorSession } from "./plan.js";

const fillMins = (text, mins) => String(text || "").replace(/\{mins\}/g, mins);

/** "Tue 20 Oct" for a row's date column. */
export const printDate = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/**
 * Rows for the print view, week by week. An adult row is day, date, session name, minutes, the effort word (plus any
 * note), and the "Done when" lines; a Juniors row is day, date, game, minutes, where, what the child does, what the
 * grown-up does, badge. Dates follow the app's own sessionDate rule.
 */
export function printRows(weeks, programStart, junior) {
  const list = Array.isArray(weeks) ? weeks : [];
  return list.map((w) => ({
    n: w.n,
    title: w.title || "",
    focus: w.focus || "",
    rows: (w.sessions || []).map((s, i) => {
      const date = sessionDate(programStart, w.n, s.day);
      const isJ = junior || isJuniorSession(s);
      const effort = EFFORT_WORDS[s.effort] ? EFFORT_WORDS[s.effort].word : "";
      const row = { key: `${w.n}-${i}`, day: s.day || "", date, dateText: printDate(date), name: s.name || "", mins: s.minsText || `${s.mins} min`, effort, effortNote: s.effortNote || "" };
      if (isJ) return { ...row, where: s.where || "", child: s.child || "", grownUp: s.grownUp || "", badge: s.badge || "" };
      return { ...row, detail: fillMins(s.detail, s.mins), doneWhen: String(s.doneWhen || "").split("\n").filter(Boolean) };
    }),
  }));
}

/** What to call the plan at the top of the page: "The 12-week plan", "The 4-week Taster", "Sofa to Singletrack Juniors", "Race ready (2 weeks)". */
export function planLabel(profile, weeks) {
  const p = profile || {};
  const n = Array.isArray(weeks) ? weeks.length : 0;
  if (p.junior) return "Sofa to Singletrack Juniors";
  if (p.raceReady) return `Race ready (${n} week${n === 1 ? "" : "s"})`;
  if (p.continuation && p.continuation.fromWeek) return `Weeks ${p.continuation.fromWeek} to ${p.continuation.toWeek} of the ${p.continuation.lengthWeeks}-week plan`;
  if (n === 12) return "The 12-week plan";
  if (n === 8) return "The 8-week plan";
  if (n === 4) return "The 4-week Taster";
  return `The ${n}-week plan`;
}
