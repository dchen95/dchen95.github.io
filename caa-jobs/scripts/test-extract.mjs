/**
 * test-extract.mjs — regression tests for the extraction engine, run against
 * the checked-in seed snapshot. `npm run data:test`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractListing, parseMoney, extractNegations, extractShifts, extractTimeOff } from "./lib/extract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(join(root, "data/seed/listings.json"), "utf8"));
const byRef = Object.fromEntries(seed.listings.map((l) => [l.ref, extractListing(l, seed.retrievedAt)]));

let n = 0;
const t = (name, fn) => { n++; try { fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } };

// --- unit: money parsing ------------------------------------------------------
t("parseMoney $150k", () => assert.equal(parseMoney("$150k"), 150000));
t("parseMoney $260,000", () => assert.equal(parseMoney("$260,000"), 260000));
t("parseMoney 230K", () => assert.equal(parseMoney("230K"), 230000));
t("parseMoney garbage", () => assert.equal(parseMoney("competitive"), null));

// --- unit: schedule negations --------------------------------------------------
t("no nights, weekends, or call", () => {
  const r = extractNegations("competitive pay and no nights, weekends, or call.");
  assert.deepEqual([r.noCall, r.noNights, r.noWeekends], [true, true, true]);
});
t("no call, nights, weekends, or holidays", () => {
  const r = extractNegations("with $100K upfront and no call, nights, weekends, or holidays.");
  assert.deepEqual([r.noCall, r.noNights, r.noWeekends, r.noHolidays], [true, true, true, true]);
});
t("call pay is not no-call", () => {
  const r = extractNegations("plus productivity, incentive, and call pay.");
  assert.equal(r.noCall, false);
});

// --- unit: shifts & time off ---------------------------------------------------
t("10- and 12-hour scheduling", () => assert.deepEqual(extractShifts("10- and 12-hour scheduling options"), ["10s", "12s"]));
t("8/10/12-hour shift options", () => assert.deepEqual(extractShifts("8/10/12-hour shift options"), ["8s", "10s", "12s"]));
t("minimum of six weeks of vacation", () => {
  const r = extractTimeOff("with a minimum of six weeks of vacation");
  assert.equal(r.weeksMin, 6);
});
t("up to 22 weeks off", () => {
  const r = extractTimeOff("schedules offering up to 22 weeks off");
  assert.equal(r.weeksMax, 22);
});
t("8–10 weeks of PTO", () => {
  const r = extractTimeOff("a $30k sign-on bonus, 8–10 weeks of PTO/holidays/CME");
  assert.deepEqual([r.weeksMin, r.weeksMax], [8, 10]);
});

// --- integration: real listings from the seed snapshot -------------------------
t("577267 Envision Broward: $150k start bonus, relocation, 10s/12s", () => {
  const j = byRef[577267];
  assert.equal(j.x.signOn.amount, 150000);
  assert.equal(j.x.relocation, true);
  assert.deepEqual(j.x.schedule.shifts, ["10s", "12s"]);
});
t("580531 Temple TX: new-grad vs experienced base, $75k sign-on, $20k annual", () => {
  const j = byRef[580531];
  assert.equal(j.x.base.newGrad, 230000);
  assert.equal(j.x.base.experienced, 260000);
  assert.equal(j.x.signOn.amount, 75000);
  assert.equal(j.x.annualBonus, 20000);
  assert.equal(j.x.newGrad, true);
  assert.equal(j.x.firstYear.min, 230000 + 75000 + 20000);
});
t("566421 OrthoMed: no call/nights/weekends, no pay stated", () => {
  const j = byRef[566421];
  assert.equal(j.x.schedule.noCall, true);
  assert.equal(j.x.schedule.noWeekends, true);
  assert.equal(j.x.base.min, null);
  assert.equal(j.x.firstYear.min, null);
});
t("564579 MAK weekend role: weekend-only + 6 weeks vacation", () => {
  const j = byRef[564579];
  assert.equal(j.x.schedule.weekendOnly, true);
  assert.equal(j.x.timeOff.weeksMin, 6);
});
t("548049 Orlando Health: $100k support funds as sign-on-equivalent, 22 wks", () => {
  const j = byRef[548049];
  assert.equal(j.x.signOn.amount, 100000);
  assert.equal(j.x.timeOff.weeksMax, 22);
});
t("574572 UC flexible FTE 0.6–1.0", () => {
  const j = byRef[574572];
  assert.deepEqual(j.x.schedule.fte, { min: 0.6, max: 1.0 });
});
t("553515 Phoebe Putney: $260k base + $30k sign-on, 8–10 wks, has call (call pay)", () => {
  const j = byRef[553515];
  assert.equal(j.x.base.min, 260000);
  assert.equal(j.x.signOn.amount, 30000);
  assert.deepEqual([j.x.timeOff.weeksMin, j.x.timeOff.weeksMax], [8, 10]);
  assert.equal(j.x.schedule.noCall, false);
  assert.equal(j.x.relocation, true);
  assert.equal(j.x.firstYear.min, 290000);
});
t("541522 Columbus: total package $270K–$327K, not base", () => {
  const j = byRef[541522];
  assert.equal(j.x.base.min, null);
  assert.deepEqual(j.x.package, { min: 270000, max: 327000 });
  assert.equal(j.x.schedule.partTimeOption, true);
  assert.equal(j.x.schedule.guaranteedHours, true);
  assert.equal(j.x.firstYear.min, 270000); // package floor
});
t("554261 USAP San Antonio: $50K sign-on OR $75K loans (either/or)", () => {
  const j = byRef[554261];
  assert.equal(j.x.signOn.amount, 50000);
  assert.equal(j.x.loanRepayment.amount, 75000);
  assert.equal(j.x.loanRepayment.alternativeToSignOn, true);
  assert.equal(j.x.schedule.noCall, true);
  // either/or: loans not double-counted in first-year value
  assert.equal(j.x.firstYear.min, 250000 + 50000);
});
t("557786 MUSC: $50K commencement + $15K site incentive, 8s/10s/12s", () => {
  const j = byRef[557786];
  assert.equal(j.x.signOn.amount, 50000);
  assert.equal(j.x.incentives[0]?.amount, 15000);
  assert.deepEqual(j.x.schedule.shifts, ["8s", "10s", "12s"]);
});
t("575448 CompHealth Indiana: W-2 or 1099 options", () => {
  const j = byRef[575448];
  assert.deepEqual(j.x.employmentOptions, ["W-2", "1099"]);
});
t("531057 Tenet El Paso: new grads welcome, long-running", () => {
  const j = byRef[531057];
  assert.equal(j.x.newGrad, true);
  assert.equal(j.x.longRunning, true);
  assert.equal(j.x.base.min, 270000);
});
t("580464 Brevard: sign-on offered but amount unknown", () => {
  const j = byRef[580464];
  assert.equal(j.x.signOn.offered, true);
  assert.equal(j.x.signOn.amount, null);
});
t("freshness math: 577267 posted 46d before snapshot", () => {
  assert.equal(byRef[577267].x.daysPosted, 46);
});

console.log(`✓ ${n} extraction tests passed`);
