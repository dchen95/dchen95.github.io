# Waveform — CAA Anesthesia Jobs

A single-page job board that reimagines [GasWork.com](https://www.gaswork.com) for **Certified Anesthesiologist Assistant (CAA)** positions only — with instant search, rich filtering, a scannable detail view, saved jobs, and side-by-side compare.

Built with React + Vite + Tailwind, `lucide-react` icons, and no runtime dependencies on any backend. All listing data is embedded at build time.

## The data

Listings come from a real scraping pipeline (see **[PIPELINE.md](PIPELINE.md)**), not hand transcription:

- Source: `https://www.gaswork.com/search/Anesthesiologist-Assistants/Job/All`, plus each listing's `gaswork.com/post/{ref}` detail page.
- `npm run data:scrape` refreshes the snapshot; `npm run data:seed` rebuilds from the checked-in seed; `npm run data:test` runs 26 extraction regression tests. A GitHub Actions workflow (`refresh-caa-jobs-data.yml`) can do the refresh weekly.
- Every listing in `src/data/jobs.json` carries its raw fields **plus an extracted `x` block** of actionable data: parsed base salary (new-grad vs experienced where stated), sign-on/start bonuses, student-loan repayment (including either/or choices), annual bonuses and incentives, call/nights/weekends/holidays flags, shift lengths, FTE ranges, weeks of time off, new-grad friendliness, relocation, W-2/1099 options, an itemized **estimated first-year cash value**, and freshness (days on market, long-running flag).
- Factual fields are kept **exactly as posted**; extraction only restructures the listing's own wording. Missing fields are `null` / "Not specified" — never guessed.
- Pagination beyond page 1 requires a JS session on GasWork's side, so a snapshot covers the listings actually retrieved — nothing is fabricated to pad the count.

This is an **unofficial demo**, not affiliated with GasWork. Always confirm current details on the original posting.

## Run locally

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # production build → dist/
npm run preview  # preview the production build
```

Requires Node.js 18+.

## Push to GitHub

From this folder:

```bash
git init
git add -A
git commit -m "Waveform: CAA job board (real GasWork data)"
git branch -M main
```

Create an empty repo on GitHub (no README/license), then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Deploy

### GitHub Pages (this repo)

The board is published at **https://dchen95.github.io/caa-jobs/** by `.github/workflows/deploy-pages.yml` (repo root). On every push to `master` (or a manual *Run workflow*) it:

1. `npm ci` and runs the extraction tests,
2. builds with `BASE_PATH=/caa-jobs/ npm run build` so assets resolve under the subpath,
3. assembles `_site/` — the root user-site static files plus the built app copied to `_site/caa-jobs` — and deploys it with `actions/deploy-pages`.

**One-time manual step (owner):** repo **Settings → Pages → Source → "GitHub Actions"**. The workflow deploys from `master`, so it only takes effect once this branch is merged there.

`vite.config.js` reads `base` from `BASE_PATH` (default `/`), so the same build serves at root on Vercel/Netlify and under `/caa-jobs/` on Pages.

### Other hosts

- **Vercel / Netlify** — import the repo; build command `npm run build`, output dir `dist` (root-relative assets, no `BASE_PATH` needed).

## Project structure

```
caa-jobs/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── scripts/
│   ├── scrape.mjs           ← fetch + refresh data from gaswork.com
│   ├── seed.mjs             ← rebuild data from the checked-in seed snapshot
│   ├── test-extract.mjs     ← extraction regression tests
│   └── lib/
│       ├── gaswork.mjs      ← tolerant HTML parsers
│       └── extract.mjs      ← text → structured actionable fields
├── data/
│   ├── seed/listings.json   ← raw snapshot (fixture + offline fallback)
│   └── raw/                 ← cached scraped HTML (gitignored)
└── src/
    ├── main.jsx
    ├── index.css
    ├── data/jobs.json       ← generated: listings + extracted `x` block
    ├── data/meta.json       ← generated: snapshot date + dataset stats
    └── App.jsx              ← the UI
```

## Features

- **Search** across title, employer, city, state, and summary
- **Filters:** "what matters" facets from extracted data (no call, no weekends, sign-on/start bonus, new-grad friendly, student-loan repayment, relocation, 6+ weeks off), state (multi-select), position type, direct vs. agency, salary range slider, "has salary" toggle, date posted
- **Shareable searches:** query, states, and facets sync to the URL
- Active filters as removable chips, live result count, empty state
- **Sort:** newest, highest pay, estimated first-year value, biggest sign-on bonus, state A–Z
- **Detail panel:** quick-facts strip, compensation highlight, itemized **estimated first-year cash value**, **market position** (how the base compares to every other listing with stated pay), extracted schedule/time-off facts, and **listing activity** (days on market, long-running warning)
- **Saved jobs** (persisted in localStorage) and **compare** 2–3 side by side, including first-year value, call, weekends, and time off rows
- CAA-practice-state indicator, agency badges, and urgency signals from the source data
- Mobile-first, keyboard-navigable, reduced-motion aware
