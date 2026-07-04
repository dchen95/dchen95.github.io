#!/usr/bin/env node
/**
 * scrape.mjs — refresh Waveform's data from gaswork.com.
 *
 * Pipeline: fetch search page → discover post refs → fetch each post's detail
 * page → parse → run the extraction engine → merge with known seed listings →
 * write src/data/jobs.json + meta.json. Every fetched page is cached under
 * data/raw/<date>/ so parsing can be re-run offline while tuning selectors.
 *
 * Usage:
 *   node scripts/scrape.mjs                 # full refresh (network)
 *   node scripts/scrape.mjs --from-cache    # re-parse the newest cached pages, no network
 *   node scripts/scrape.mjs --refs-only     # only re-fetch posts already known from the seed
 *   node scripts/scrape.mjs --delay 3000    # slower crawl (ms between requests, default 2000)
 *   node scripts/scrape.mjs --dry-run       # fetch+parse but don't write src/data
 *
 * Be a good citizen: this fetches at most a few dozen small pages, identifies
 * itself via User-Agent, rate-limits to one request every 2s by default, and
 * never retries more than 3 times. Listings remain the property of their
 * posters/GasWork; the app links every record back to its original posting.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSearchPage, parseDetailPage } from "./lib/gaswork.mjs";
import { buildDataset } from "./lib/extract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);

const BASE = "https://www.gaswork.com";
const SEARCH_URL = `${BASE}/search/Anesthesiologist-Assistants/Job/All`;
const DELAY_MS = parseInt(opt("--delay", "2000"), 10);
const UA = "WaveformCAAJobs/1.0 (personal job-search aggregator; links back to original postings)";
const today = new Date().toISOString().slice(0, 10);
const cacheDir = join(root, "data/raw", today);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, cacheName) {
  const cachePath = join(cacheDir, cacheName);
  mkdirSync(cacheDir, { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      writeFileSync(cachePath, html);
      return html;
    } catch (err) {
      if (attempt === 3) throw new Error(`Failed to fetch ${url}: ${err.message}`);
      await sleep(attempt * 2000);
    }
  }
}

function newestCacheDir() {
  const rawRoot = join(root, "data/raw");
  if (!existsSync(rawRoot)) return null;
  const dirs = readdirSync(rawRoot).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dirs.length ? join(rawRoot, dirs[dirs.length - 1]) : null;
}

async function main() {
  const seed = JSON.parse(readFileSync(join(root, "data/seed/listings.json"), "utf8"));
  const seedByRef = new Map(seed.listings.map((l) => [l.ref, l]));
  let refs = [];
  const detailHtml = new Map();

  if (flag("--from-cache")) {
    const dir = newestCacheDir();
    if (!dir) { console.error("No cached pages under data/raw/. Run without --from-cache first."); process.exit(1); }
    console.log(`Re-parsing cached pages from ${dir} (no network)…`);
    for (const f of readdirSync(dir)) {
      const html = readFileSync(join(dir, f), "utf8");
      if (f.startsWith("search")) refs.push(...parseSearchPage(html).map((r) => r.ref));
      const m = f.match(/^post-(\d+)\.html$/);
      if (m) detailHtml.set(parseInt(m[1], 10), html);
    }
    refs = [...new Set([...refs, ...detailHtml.keys()])];
  } else {
    if (!flag("--refs-only")) {
      console.log(`Fetching search results: ${SEARCH_URL}`);
      try {
        const html = await fetchPage(SEARCH_URL, "search-p1.html");
        const found = parseSearchPage(html);
        console.log(`  found ${found.length} post references on page 1`);
        refs.push(...found.map((r) => r.ref));
        if (found.length === 0) {
          console.warn("  ⚠ 0 refs parsed — GasWork markup may have changed. Page cached at data/raw/ for offline selector tuning (see scripts/lib/gaswork.mjs).");
        }
      } catch (err) {
        console.warn(`  ⚠ search page fetch failed (${err.message}); falling back to known refs from seed.`);
      }
      await sleep(DELAY_MS);
    }
    refs = [...new Set([...refs, ...seedByRef.keys()])];
    console.log(`Fetching ${refs.length} post detail pages (${DELAY_MS}ms apart)…`);
    for (const ref of refs) {
      try {
        detailHtml.set(ref, await fetchPage(`${BASE}/post/${ref}`, `post-${ref}.html`));
        process.stdout.write(`  ✓ ${ref}\n`);
      } catch (err) {
        process.stdout.write(`  ✗ ${ref} (${err.message})\n`);
      }
      await sleep(DELAY_MS);
    }
  }

  // Build raw records: live detail page when we got one (with seed filling gaps
  // like paraphrased summaries), otherwise carry the seed record forward.
  const records = [];
  let live = 0, carried = 0, dropped = 0;
  for (const ref of new Set([...refs, ...seedByRef.keys()])) {
    const seedRec = seedByRef.get(ref);
    const html = detailHtml.get(ref);
    if (html) {
      const parsed = parseDetailPage(html, ref);
      const gone = /no longer (available|active)|position (has been )?filled|listing not found/i.test(parsed.fullText || "");
      if (gone) { dropped++; continue; }
      records.push({ ...seedRec, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))) });
      live++;
    } else if (seedRec) {
      records.push(seedRec);
      carried++;
    }
  }
  console.log(`Records: ${live} refreshed live, ${carried} carried from seed, ${dropped} dropped (no longer listed).`);

  const scrapedAt = flag("--from-cache") ? (newestCacheDir()?.split("/").pop() ?? today) : today;
  const { jobs: finalJobs, meta } = buildDataset(records, scrapedAt, SEARCH_URL);
  meta.method = live > 0 ? "scrape" : "seed-fallback";

  if (flag("--dry-run")) {
    console.log(JSON.stringify({ meta, sample: finalJobs[0] }, null, 2));
    return;
  }
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(join(root, "src/data/jobs.json"), JSON.stringify(finalJobs, null, 2) + "\n");
  writeFileSync(join(root, "src/data/meta.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`Wrote ${finalJobs.length} listings → src/data/jobs.json (snapshot ${scrapedAt})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
