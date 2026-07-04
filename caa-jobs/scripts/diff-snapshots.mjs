/**
 * diff-snapshots.mjs — compare a previous jobs.json snapshot against the
 * current one and write src/data/changes.json describing what moved:
 * new listings, removed listings, and stated-pay changes.
 *
 * Pure Node, no dependencies. Exposes pure functions so the pipeline tests
 * can exercise the diff without touching the filesystem.
 *
 *   node scripts/diff-snapshots.mjs                       # auto: newest data/history/*.json → src/data/changes.json
 *   node scripts/diff-snapshots.mjs --prev <file>         # diff against a specific prior snapshot
 *   node scripts/diff-snapshots.mjs --curr <file> --out <file>
 *
 * Shape of changes.json:
 *   { since: "<ISO date|null>",
 *     newRefs: [ref, …], removedRefs: [ref, …],
 *     payChanged: [{ ref, from:{min,max}, to:{min,max} }] }
 *
 * With no prior snapshot the empty structure is written with since: null.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

/** The empty changes structure — used for fresh checkouts and no-history runs. */
export function emptyChanges() {
  return { since: null, newRefs: [], removedRefs: [], payChanged: [] };
}

/**
 * Diff two arrays of job records. `since` is the ISO date of the previous
 * snapshot (or null). Compares stated pay (payMin/payMax) for listings
 * present in both.
 */
export function diffSnapshots(prevJobs, currJobs, since = null) {
  if (!prevJobs) return { ...emptyChanges(), since: since ?? null };
  const prev = Array.isArray(prevJobs) ? prevJobs : [];
  const curr = Array.isArray(currJobs) ? currJobs : [];
  const prevByRef = new Map(prev.map((j) => [j.ref, j]));
  const currByRef = new Map(curr.map((j) => [j.ref, j]));

  const newRefs = curr.filter((j) => !prevByRef.has(j.ref)).map((j) => j.ref);
  const removedRefs = prev.filter((j) => !currByRef.has(j.ref)).map((j) => j.ref);

  const payChanged = [];
  for (const j of curr) {
    const p = prevByRef.get(j.ref);
    if (!p) continue;
    const from = { min: p.payMin ?? null, max: p.payMax ?? null };
    const to = { min: j.payMin ?? null, max: j.payMax ?? null };
    if (from.min !== to.min || from.max !== to.max) payChanged.push({ ref: j.ref, from, to });
  }
  return { since: since ?? null, newRefs, removedRefs, payChanged };
}

/** Pull an ISO date (YYYY-MM-DD) out of a history filename, else null. */
export function dateFromName(name) {
  const m = basename(name || "").match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/* --------------------------------- CLI ------------------------------------- */
function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

  const currPath = opt("--curr") || join(root, "src/data/jobs.json");
  const outPath = opt("--out") || join(root, "src/data/changes.json");
  const historyDir = join(root, "data/history");

  // Resolve the previous snapshot: explicit --prev, else newest data/history/*.json.
  let prevPath = opt("--prev");
  if (!prevPath && existsSync(historyDir)) {
    const files = readdirSync(historyDir).filter((f) => /\d{4}-\d{2}-\d{2}.*\.json$/.test(f)).sort();
    if (files.length) prevPath = join(historyDir, files[files.length - 1]);
  }

  const curr = JSON.parse(readFileSync(currPath, "utf8"));
  let out;
  if (prevPath && existsSync(prevPath)) {
    const prev = JSON.parse(readFileSync(prevPath, "utf8"));
    out = diffSnapshots(prev, curr, dateFromName(prevPath));
    console.log(`Diffed against ${basename(prevPath)}: ${out.newRefs.length} new · ${out.removedRefs.length} removed · ${out.payChanged.length} pay changes`);
  } else {
    out = emptyChanges();
    console.log("No prior snapshot — wrote empty changes.json (since: null).");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
}
