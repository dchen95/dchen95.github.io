/**
 * test-diff.mjs — regression tests for the snapshot differ.
 * `npm run data:test:diff` (also chained into `npm run data:test`)
 */
import assert from "node:assert/strict";
import { diffSnapshots, emptyChanges, dateFromName } from "./diff-snapshots.mjs";

let n = 0;
const t = (name, fn) => { n++; try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } };

const job = (ref, payMin = null, payMax = null) => ({ ref, payMin, payMax });

// new ref
t("new ref appears in newRefs", () => {
  const prev = [job(1), job(2)];
  const curr = [job(1), job(2), job(3)];
  const d = diffSnapshots(prev, curr, "2026-01-01");
  assert.deepEqual(d.newRefs, [3]);
  assert.deepEqual(d.removedRefs, []);
  assert.deepEqual(d.payChanged, []);
  assert.equal(d.since, "2026-01-01");
});

// removed ref
t("removed ref appears in removedRefs", () => {
  const prev = [job(1), job(2)];
  const curr = [job(1)];
  const d = diffSnapshots(prev, curr, "2026-01-01");
  assert.deepEqual(d.removedRefs, [2]);
  assert.deepEqual(d.newRefs, []);
});

// pay change
t("stated pay change is reported from/to", () => {
  const prev = [job(1, 230000, null)];
  const curr = [job(1, 250000, 280000)];
  const d = diffSnapshots(prev, curr, "2026-01-01");
  assert.deepEqual(d.payChanged, [{ ref: 1, from: { min: 230000, max: null }, to: { min: 250000, max: 280000 } }]);
});

// unchanged pay is not reported
t("unchanged pay produces no payChanged entry", () => {
  const prev = [job(1, 230000, null)];
  const curr = [job(1, 230000, null)];
  assert.deepEqual(diffSnapshots(prev, curr, "2026-01-01").payChanged, []);
});

// no-history case
t("no prior snapshot yields empty structure with since null", () => {
  assert.deepEqual(diffSnapshots(null, [job(1), job(2)]), emptyChanges());
});
t("emptyChanges shape", () => {
  assert.deepEqual(emptyChanges(), { since: null, newRefs: [], removedRefs: [], payChanged: [] });
});

// combined + date parsing helper
t("combined new/removed/pay in one diff", () => {
  const prev = [job(1, 200000), job(2, 210000)];
  const curr = [job(1, 220000), job(3)];
  const d = diffSnapshots(prev, curr, "2026-06-01");
  assert.deepEqual(d.newRefs, [3]);
  assert.deepEqual(d.removedRefs, [2]);
  assert.deepEqual(d.payChanged, [{ ref: 1, from: { min: 200000, max: null }, to: { min: 220000, max: null } }]);
});
t("dateFromName extracts ISO date", () => {
  assert.equal(dateFromName("/x/data/history/2026-03-14.json"), "2026-03-14");
  assert.equal(dateFromName("jobs.json"), null);
});

console.log(`✓ ${n} diff tests passed`);
