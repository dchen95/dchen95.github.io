/**
 * seed.mjs — rebuild src/data/jobs.json + meta.json from the checked-in seed
 * snapshot (data/seed/listings.json), running the full extraction pipeline
 * over it. Use this when you want to regenerate the app's data without
 * hitting gaswork.com (e.g. after improving the extractor).
 *
 *   npm run data:seed
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDataset } from "./lib/extract.mjs";
import { emptyChanges } from "./diff-snapshots.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(readFileSync(join(root, "data/seed/listings.json"), "utf8"));

const { jobs, meta } = buildDataset(seed.listings, seed.retrievedAt, seed.source);
meta.method = "seed";

mkdirSync(join(root, "src/data"), { recursive: true });
writeFileSync(join(root, "src/data/jobs.json"), JSON.stringify(jobs, null, 2) + "\n");
writeFileSync(join(root, "src/data/meta.json"), JSON.stringify(meta, null, 2) + "\n");
// A fresh checkout always needs changes.json for the app to import; snapshot
// diffing is empty until the refresh workflow archives history.
writeFileSync(join(root, "src/data/changes.json"), JSON.stringify(emptyChanges(), null, 2) + "\n");

console.log(`Wrote ${jobs.length} enriched listings → src/data/jobs.json`);
console.log(`  with pay: ${meta.withPay} · with sign-on: ${meta.withSignOn} · no-call: ${meta.noCall} · median base: $${meta.medianBase?.toLocaleString()}`);
