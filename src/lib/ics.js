// The whole programme as one calendar file (RFC 5545): an all-day event for every session not yet logged.
// Pure, so it can be tested with node:test; App.jsx only wraps the text in a Blob for download.

import { sessionDate, isJuniorSession } from "./plan.js";

export const ICS_PRODID = "-//MTB East//Sofa to Singletrack//EN";

/** Text as it goes in a property value: backslashes, semicolons, commas and newlines escaped. */
export function icsEscape(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const utf8Length = (ch) => {
  const cp = ch.codePointAt(0);
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
};

/**
 * One content line folded so no line is over 75 octets: a continuation line starts with a single space, which
 * counts towards its 75. Never splits inside a character (folding is by code point, measured in UTF-8 bytes).
 */
export function foldLine(line) {
  const out = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of String(line)) {
    const n = utf8Length(ch);
    if (bytes + n > limit) {
      out.push(cur);
      cur = " ";
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out;
}

/** yyyymmdd for an all-day DATE value, in the rider's local calendar. */
export function icsDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** UTC timestamp for DTSTAMP. */
export function icsStamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

const fillMins = (text, mins) => String(text || "").replace(/\{mins\}/g, mins);

/** The one-line title: "Sofa to Singletrack: Steady (25 min)", or for a Juniors game "... (15 min, with a grown-up)". */
export function icsSummary(session) {
  const mins = session.minsText || `${session.mins} min`;
  return isJuniorSession(session)
    ? `Sofa to Singletrack: ${session.name} (${mins}, with a grown-up)`
    : `Sofa to Singletrack: ${session.name} (${mins})`;
}

/** The description: the week, the session detail (a Juniors game's where / child / grown-up / badge) and the "Done when" lines. */
export function icsDescription(session, week, totalWeeks) {
  const lines = [`Week ${week.n} of ${totalWeeks}${week.title ? `: ${week.title}` : ""}`];
  if (isJuniorSession(session)) {
    if (session.where) lines.push(`Where: ${session.where}`);
    if (session.child) lines.push(`What the child does: ${session.child}`);
    if (session.grownUp) lines.push(`What the grown-up does: ${session.grownUp}`);
    if (session.badge) lines.push(`Badge: ${session.badge}`);
  } else if (session.detail) {
    lines.push(fillMins(session.detail, session.mins));
  }
  for (const d of String(session.doneWhen || "").split("\n").filter(Boolean)) lines.push(`Done when: ${d}`);
  return lines.join("\n");
}

/**
 * The programme's remaining sessions as one VCALENDAR: every session without a log entry becomes an all-day event
 * on the date the app shows for it (sessionDate), with a stable UID "<riderId>-<weekN>-<idx>@mtbeast.co.uk" so a
 * file downloaded again updates the same events rather than doubling them. Lines are CRLF, folded at 75 octets.
 */
export function programmeIcs(weeks, programStart, sessionLog, riderId, now = new Date()) {
  const log = sessionLog && typeof sessionLog === "object" ? sessionLog : {};
  const list = Array.isArray(weeks) ? weeks : [];
  const stamp = icsStamp(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${ICS_PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const w of list) {
    (w.sessions || []).forEach((s, i) => {
      const key = `${w.n}-${i}`;
      if (key in log) return;
      const start = sessionDate(programStart, w.n, s.day);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${riderId}-${key}@mtbeast.co.uk`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(start)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsEscape(icsSummary(s))}`,
        `DESCRIPTION:${icsEscape(icsDescription(s, w, list.length))}`,
        "END:VEVENT",
      );
    });
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}
