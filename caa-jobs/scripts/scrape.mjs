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
 * Be a good citizen: this crawls the CAA search results (all pages, capped at
 * 30) plus one small detail page per listing, identifies itself via
 * User-Agent, rate-limits to one request every 2s by default, and never
 * retries more than 3 times. Listings remain the property of their
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

const MAX_PAGES = 30; // hard cap on search-result pages, whatever pagination style

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal cookie jar — ASP.NET postback pagination needs the session cookie
// from the first GET echoed back on subsequent requests.
const jar = new Map();
function storeCookies(res) {
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of setCookies) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) jar.set(m[1].trim(), m[2]);
  }
}
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function fetchPage(url, cacheName, { method = "GET", body = null } = {}) {
  const cachePath = join(cacheDir, cacheName);
  mkdirSync(cacheDir, { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const headers = { "User-Agent": UA, Accept: "text/html" };
      if (jar.size) headers.Cookie = cookieHeader();
      if (body != null) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        headers.Referer = SEARCH_URL;
        headers.Origin = BASE;
      }
      const res = await fetch(url, { method, headers, body, redirect: "follow" });
      storeCookies(res);
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

const decodeAttr = (s) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** All hidden form fields (__VIEWSTATE and friends) on an ASP.NET page. */
function hiddenFields(html) {
  const fields = {};
  for (const tag of html.match(/<input[^>]*type=["']hidden["'][^>]*>/gi) || []) {
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    fields[name] = decodeAttr(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "");
  }
  return fields;
}

/** __doPostBack pager targets on a page: Map of pageNumber → {target, arg}. */
function pagerTargets(html) {
  const out = new Map();
  const re = /__doPostBack\((?:&#39;|')([^'&]+)(?:&#39;|')\s*,\s*(?:&#39;|')(Page\$([0-9]+|Next|Last))(?:&#39;|')\)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const key = /^\d+$/.test(m[3]) ? parseInt(m[3], 10) : m[3];
    if (!out.has(key)) out.set(key, { target: m[1], arg: m[2] });
  }
  return out;
}

/** href-style pagination links pointing back into the same search, absolutized. */
function searchPageLinks(html) {
  const links = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeAttr(m[1]);
    if (/^(javascript:|#|mailto:)/i.test(href)) continue;
    if (!/anesthesiologist-assistants/i.test(href) && !/[?&]page=\d+/i.test(href)) continue;
    try {
      const abs = new URL(href, BASE).toString();
      if (abs !== SEARCH_URL && abs !== SEARCH_URL + "/") links.add(abs);
    } catch { /* ignore malformed */ }
  }
  return [...links];
}

/**
 * Discover every search-results page and return the set of post refs found.
 * Tries, in order: (A) plain href pagination links, (B) ASP.NET __VIEWSTATE
 * postback paging, (C) blind URL patterns (/2, ?page=2). Each strategy stops
 * as soon as a page contributes zero new refs; MAX_PAGES caps everything.
 */
async function discoverAllRefs(firstHtml) {
  const refs = new Set(parseSearchPage(firstHtml).map((r) => r.ref));
  console.log(`  page 1: ${refs.size} refs`);
  const countM = firstHtml.match(/([\d,]+)\s*(?:results?|records?|posts?|listings?|jobs?|matches)/i);
  if (countM) console.log(`  (page reports a total of ${countM[1]})`);
  let pageNo = 1;
  const addRefs = (html) => {
    let added = 0;
    for (const r of parseSearchPage(html)) if (!refs.has(r.ref)) { refs.add(r.ref); added++; }
    return added;
  };

  // Strategy A: real href links to further pages.
  const hrefLinks = searchPageLinks(firstHtml);
  if (hrefLinks.length) {
    console.log(`  pagination: found ${hrefLinks.length} candidate href links, e.g. ${hrefLinks.slice(0, 3).join(" | ")}`);
    const visited = new Set([SEARCH_URL, SEARCH_URL + "/"]);
    const queue = [...hrefLinks];
    let emptyStreak = 0;
    while (queue.length && pageNo < MAX_PAGES) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      pageNo++;
      await sleep(DELAY_MS);
      try {
        const html = await fetchPage(url, `search-p${pageNo}.html`);
        const added = addRefs(html);
        console.log(`  page ${pageNo} (${url}): +${added} new refs (total ${refs.size})`);
        for (const l of searchPageLinks(html)) if (!visited.has(l) && !queue.includes(l)) queue.push(l);
        emptyStreak = added === 0 ? emptyStreak + 1 : 0;
        if (emptyStreak >= 2) { console.log("  two consecutive pages added nothing — stopping href pagination."); break; }
      } catch (err) {
        console.warn(`  ⚠ ${url} failed: ${err.message}`);
      }
    }
    if (pageNo > 1) return [...refs];
  }

  // Strategy B: ASP.NET __VIEWSTATE postback paging.
  if (/__VIEWSTATE/.test(firstHtml)) {
    let html = firstHtml;
    let targets = pagerTargets(html);
    if (targets.size) {
      console.log(`  pagination: __VIEWSTATE postback pager detected (args: ${[...targets.keys()].slice(0, 12).join(", ")})`);
      for (let page = 2; page <= MAX_PAGES; page++) {
        let entry = targets.get(page);
        if (!entry) {
          // pager windows (1…10 then "...") — take the smallest numeric target above current
          const nums = [...targets.keys()].filter((k) => typeof k === "number" && k >= page).sort((a, b) => a - b);
          entry = nums.length ? targets.get(nums[0]) : targets.get("Next");
          if (!entry) { console.log(`  no postback target for page ${page} — assuming last page reached.`); break; }
        }
        const fields = hiddenFields(html);
        if (!fields.__VIEWSTATE) { console.warn("  ⚠ postback page lost __VIEWSTATE — stopping."); break; }
        const body = new URLSearchParams({ ...fields, __EVENTTARGET: entry.target, __EVENTARGUMENT: entry.arg }).toString();
        await sleep(DELAY_MS);
        try {
          html = await fetchPage(SEARCH_URL, `search-p${page}.html`, { method: "POST", body });
        } catch (err) {
          console.warn(`  ⚠ postback for page ${page} failed: ${err.message} — stopping.`);
          break;
        }
        const added = addRefs(html);
        console.log(`  page ${page} (postback ${entry.arg}): +${added} new refs (total ${refs.size})`);
        if (added === 0) { console.log("  postback page added nothing — stopping."); break; }
        targets = pagerTargets(html);
      }
      return [...refs];
    }
    console.log("  __VIEWSTATE present but no Page$ postback targets found on page 1.");
  }

  // Strategy C: blind URL patterns.
  for (const make of [(n) => `${SEARCH_URL}/${n}`, (n) => `${SEARCH_URL}?page=${n}`, (n) => `${SEARCH_URL}?Page=${n}`]) {
    await sleep(DELAY_MS);
    let html;
    try { html = await fetchPage(make(2), "search-p2-candidate.html"); } catch { continue; }
    const added = addRefs(html);
    console.log(`  blind candidate ${make(2)}: +${added} new refs`);
    if (added === 0) continue; // same content as page 1 → pattern ignored by server
    for (let n = 3; n <= MAX_PAGES; n++) {
      await sleep(DELAY_MS);
      try {
        const h = await fetchPage(make(n), `search-p${n}.html`);
        const a = addRefs(h);
        console.log(`  page ${n} (${make(n)}): +${a} new refs (total ${refs.size})`);
        if (a === 0) break;
      } catch (err) { console.warn(`  ⚠ ${make(n)} failed: ${err.message}`); break; }
    }
    return [...refs];
  }

  console.log("  no working pagination strategy found — page 1 refs only. See debug excerpts / raw-html artifact.");
  return [...refs];
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
        const found = await discoverAllRefs(html);
        console.log(`  discovered ${found.length} unique post references across all pages`);
        refs.push(...found);
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
      // Seed records keep their richer hand-checked fields; live-parsed values
      // only overwrite when the page actually stated something. Records with
      // no seed keep the full parsed shape (nulls and empty arrays included —
      // the app expects every key, e.g. comp/tags arrays, to exist).
      const rec = seedRec
        ? { ...seedRec, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))) }
        : parsed;
      records.push(rec);
      live++;
    } else if (seedRec) {
      records.push(seedRec);
      carried++;
    }
  }
  console.log(`Records: ${live} refreshed live, ${carried} carried from seed, ${dropped} dropped (no longer listed).`);

  const scrapedAt = flag("--from-cache") ? (newestCacheDir()?.split("/").pop() ?? today) : today;

  // The app sorts/filters by posted date; a null would crash nothing now but
  // would render as "—" and sort last. When a page didn't state a date we
  // honestly mark the record as approximately dated at the scrape snapshot.
  for (const r of records) {
    if (r.posted == null) { r.posted = scrapedAt; r.postedApprox = true; }
    if (r.updated == null) r.updated = r.posted;
  }
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
