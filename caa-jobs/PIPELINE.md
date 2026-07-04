# Waveform data pipeline

Turns GasWork listings into structured, actionable data instead of hand-transcribed summaries.

```
gaswork.com ──fetch──▶ data/raw/<date>/*.html ──parse──▶ raw records ──extract──▶ src/data/jobs.json
                        (cached, gitignored)   gaswork.mjs              extract.mjs      + meta.json
data/seed/listings.json ─────────────────────────────────┘ (fallback / fixture)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run data:scrape` | Full refresh from gaswork.com: search page → post refs → detail pages → parse → extract → write `src/data/`. Caches every fetched page under `data/raw/<date>/`. |
| `npm run data:scrape -- --from-cache` | Re-parse the newest cached pages with **no network** — use while tuning parsers. |
| `npm run data:scrape -- --refs-only` | Skip the search page; re-fetch only posts already known from the seed. |
| `npm run data:scrape -- --dry-run` | Fetch + parse but print instead of writing. |
| `npm run data:seed` | Regenerate `src/data/` from the checked-in seed snapshot (no network). Run after changing the extractor. |
| `npm run data:test` | Extraction regression tests (26 assertions against known listings). |

## The three stages

1. **Fetch** (`scripts/scrape.mjs`) — rate-limited (2s/request, `--delay` to slow), 3 retries with backoff, identifies itself with a honest User-Agent, and caches raw HTML so re-runs don't re-hit the site. GasWork's pagination beyond page 1 needs an ASP.NET postback session, so the scraper also re-checks every ref it already knows from the seed — a listing that 404s or reads "no longer available" is dropped, not carried forward.

2. **Parse** (`scripts/lib/gaswork.mjs`) — tolerant HTML→record parsers. They anchor on the one stable thing (numeric post ids in `/post/{ref}` links) and pull labelled fields from the surrounding text, so cosmetic markup changes don't break the run. When GasWork's markup does drift, tune the regexes here and re-run `--from-cache`.

3. **Extract** (`scripts/lib/extract.mjs`) — pure functions that turn listing text into the actionable `x` block on every job:

   | Field | Example |
   | --- | --- |
   | `x.base` | `{min: 230000, max: null, source: "stated", newGrad: 230000, experienced: 260000}` |
   | `x.package` | total-comp quotes kept separate from base (`$270K–$327K package` ≠ base salary) |
   | `x.signOn` | `{amount: 75000, offered: true, label: "$75k sign-on bonus"}` — start-date bonuses and upfront "transition support funds" count as sign-on-equivalents |
   | `x.loanRepayment` | amount + `alternativeToSignOn` when the listing says "bonus **or** loan repayment" |
   | `x.annualBonus`, `x.incentives` | recurring vs one-time money, kept apart |
   | `x.schedule` | `noCall / noNights / noWeekends / noHolidays / weekendOnly / shifts ["8s","10s"] / fte / guaranteedHours` |
   | `x.timeOff` | weeks of PTO/vacation, incl. word numbers ("six weeks") and ranges ("8–10 weeks") |
   | `x.newGrad`, `x.relocation`, `x.employmentOptions` | boolean facets driving the "What matters" filters |
   | `x.firstYear` | estimated year-one cash: base + sign-on + annual bonus + incentives, with an itemized `parts` list. Either/or bonuses are **not** double-counted. |
   | `x.daysPosted / daysUpdated / longRunning` | freshness relative to the snapshot; >180 days flags an evergreen/hard-to-fill listing |

   Ground rules: a field is `null` when the listing doesn't state it — the extractor never guesses; classification only trusts words immediately adjacent to a dollar amount, because wide context windows cross-contaminate ("…$260K with annual increases, plus a $20k annual bonus…").

## Honesty & etiquette

- Listings remain GasWork's / their posters' content. The app is an unofficial reorganization; every record links back to `gaswork.com/post/{ref}` and the UI tells users to confirm there.
- The scraper fetches a few dozen small pages per run, at most weekly, rate-limited. Don't crank it.
- If a run can't parse anything (markup change, network block), it falls back to known data and says so — it never fabricates records to pad the count.

## Automation

`.github/workflows/refresh-caa-jobs-data.yml` (repo root) runs the tests, scrapes, verifies the app still builds, and commits `src/data/` when the snapshot changed. Weekly by schedule, or on demand via *Run workflow*.
