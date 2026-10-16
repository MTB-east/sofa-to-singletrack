import { test } from "node:test";
import assert from "node:assert/strict";
import { riderChoices, profileFromAccountRider, normaliseSaved, normaliseRiderIndex } from "./plan.js";

const OLLIE = { id: "11111111-1111-4111-8111-111111111111", firstName: "Ollie", ageBand: "under14", junior: true };
const DAN = { id: "22222222-2222-4222-8222-222222222222", firstName: "Dan", ageBand: "14plus", junior: false };

test("riderChoices says which account riders are free and which are already set up on this device", () => {
  const choices = riderChoices([OLLIE, DAN, { id: "", firstName: "Nobody" }, "junk", { id: "x" }], [{ id: "main", name: "Dan", riderProfileId: DAN.id }, { id: "ab12cd", name: "" }]);
  assert.deepEqual(choices.map((c) => c.firstName), ["Ollie", "Dan"], "malformed entries are dropped");
  assert.equal(choices[0].linkedTo, null, "Ollie is free");
  assert.equal(choices[1].linkedTo, "main", "Dan is already the main rider here");
  assert.equal(choices[0].junior, true);
  assert.equal(choices[1].ageBand, "14plus");
  assert.deepEqual(riderChoices(undefined, undefined), [], "no riders on the old server");
});

test("profileFromAccountRider fills the name, the link and the age band", () => {
  assert.deepEqual(profileFromAccountRider(OLLIE), { name: "Ollie", riderProfileId: OLLIE.id, ageBand: "under14", junior: true });
  assert.deepEqual(profileFromAccountRider(DAN), { name: "Dan", riderProfileId: DAN.id, ageBand: "14plus", junior: false });
  assert.equal(profileFromAccountRider({ id: "a", firstName: "Sam", ageBand: "under14" }).junior, true, "junior follows the age band when the flag is missing");
  assert.equal(profileFromAccountRider({ id: "a", firstName: "Sam", ageBand: "nonsense" }).ageBand, "14plus");
});

test("riderProfileId survives a saved copy as a string or null, and stays on the rider index", () => {
  const blank = { profile: { name: "", junior: false, sessionsPerWeek: 3, chosenDays: ["Tue"], raceReady: false, delayWeeks: 0 } };
  assert.equal(normaliseSaved({ profile: { name: "Ollie", riderProfileId: OLLIE.id } }, blank).profile.riderProfileId, OLLIE.id);
  assert.equal(normaliseSaved({ profile: { name: "Ollie", riderProfileId: 42 } }, blank).profile.riderProfileId, null);
  assert.equal(normaliseSaved({ profile: { name: "Ollie" } }, blank).profile.riderProfileId, null);
  const index = normaliseRiderIndex({ active: "main", riders: [{ id: "main", name: "Dan", riderProfileId: DAN.id }, { id: "ab12cd", name: "Ollie", riderProfileId: "" }] });
  assert.equal(index.riders[0].riderProfileId, DAN.id);
  assert.equal("riderProfileId" in index.riders[1], false, "an empty link is not kept");
});
