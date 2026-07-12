# Police Auction Vehicle Viewer — Implementation Plan

Spec for building `police-auction.html`. All data preparation is **done** — do not
re-parse the PDF. Build only the single HTML page described below.

## Goal

A public page for browsing the Montgomery County Police public auction
(July 25, 2026, Gaithersburg MD). The source notice lists case #, year, make code,
body code, VIN, and sometimes mileage — but **no model**. The page must identify each
vehicle's model from its VIN, and also let a visitor paste any arbitrary VIN to
identify it.

## Deliverable

One file: **`police-auction.html`** at the repository root (a GitHub Pages site —
static hosting only, no server code). Follow the existing `tax-liens.html` pattern:
fully self-contained page with inline `<style>` and `<script>`, no external JS/CSS
dependencies, no build step. Reuse the same CSS custom-property palette and visual
language as `tax-liens.html` (`--blue: #1a6fc4`, gray scale, `--radius: 8px`,
card/sidebar/stats-bar layout) so the two tools feel like siblings.

## Data (already prepared — just fetch it)

`police-auction/data/auction-2026-07.json`:

```jsonc
{
  "source": "…",
  "auction": {            // event metadata — render in the page header
    "date": "2026-07-25", "gatesOpen": "7:30 AM", "auctionStarts": "9:00 AM",
    "lastAdmittance": "8:45 AM", "location": "305 Metropolitan Grove Road, Gaithersburg, Maryland 20878",
    "phone": "240-773-6411", "email": "abandoned.vehicle@montgomerycountymd.gov",
    "minimumBid": 50, "payment": "…", "terms": "…"
  },
  "vehicles": [           // 281 records
    { "case": "26-2506", "year": 2020, "makeCode": "JEEP",
      "vin": "1C4HJXDN8LW122914", "body": "SUV",
      "mileage": 66949,          // null for most records
      "vinComplete": true }      // false ⇒ VIN missing/partial (9 records) — do NOT send to decoder
  ]
}
```

Fetch with a relative path (`police-auction/data/auction-2026-07.json`). Handle
fetch failure with a visible error state.

## VIN decoding — NHTSA vPIC API (free, keyless, CORS-enabled)

⚠️ This dev environment's network policy **blocks vpic.nhtsa.dot.gov**, so you
cannot call the API from here. Code it per the contract below (it is verified and
stable); it runs fine from a visitor's browser.

**Batch (page load):** decode all `vinComplete: true` vehicles.

```js
// ≤ 50 VINs per request → 272 VINs = 6 requests, fired sequentially
const body = new URLSearchParams({
  format: "json",
  data: chunk.map(v => `${v.vin},${v.year ?? ""}`).join(";"),
});
const res = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/",
                        { method: "POST", body });
const { Results } = await res.json();
// Each result: { VIN, Make, Model, ModelYear, Trim, Series, BodyClass,
//                DisplacementL, FuelTypePrimary, DriveType, ErrorCode, … }
```

**Single (lookup tool):** `GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`
(+ `&modelyear=YYYY` when known). Response shape: `Results[0]` with the same fields.

Decode handling rules:
- Keep only useful fields per VIN: `{ make, model, trim, series, bodyClass, fuel, drive, displacement, errorCode }`. Empty strings → omit.
- `ErrorCode` `"0"` = clean; codes like `"1"`/`"8"` still usually return make/model — show results with a small "check digit failed" warning badge only when Make or Model came back empty.
- **Cache**: persist decoded results in `localStorage` under key `paVinCache:2026-07`
  (single JSON object keyed by VIN). On load: try cache first, then also try
  `fetch("police-auction/data/decoded-vins.json")` — an *optional* prebuilt cache with
  the same VIN-keyed shape that may not exist (404 ⇒ ignore silently) — then batch-decode
  only VINs still missing. Save merged results back to localStorage. Wrap localStorage
  access in try/catch (private browsing).
- Render progressively: show the table immediately from the static JSON, fill in
  Model cells as batches resolve (spinner/“decoding…” placeholder), update a
  “N of 272 decoded” counter in the stats bar.
- If the API is unreachable, the page must remain fully usable with the static fields;
  show a dismissible notice.

## Reference maps (embed as JS constants)

Make codes (NCIC-style abbreviations used in the notice):

```
HOND Honda · TOYT Toyota · NISS Nissan · CHEV Chevrolet · FORD Ford · ACUR Acura
HYUN Hyundai · SUBA Subaru · BMW BMW · MERZ/MERC Mercedes-Benz · JEEP Jeep
DODG Dodge · CHRY Chrysler · VOLK Volkswagen · VOLV Volvo · LEXS Lexus
INFI Infiniti · CADI Cadillac · LINC Lincoln · GMC GMC · KIA Kia · MAZD Mazda
MITS Mitsubishi · AUDI Audi · SCIO Scion · TESL Tesla · FIAT Fiat · SAAB Saab
JAGU Jaguar · LAND Land Rover · YAMA Yamaha · KAWK Kawasaki · HD Harley-Davidson
SUZI Suzuki · ZHNG Zhongneng · KAUF Kaufman (trailer) · HOMD Homemade · AIRM Airman
TRAN/BRIM/HZ misc. import scooters/trailers
```

Unknown/missing `makeCode` ⇒ show “—” until the VIN decode supplies the real make
(the decoded make/model always wins over the abbreviation).

Body codes: `4DR` Sedan · `2DR` Coupe · `SUV` SUV (`SUB` is a typo for SUV) · `VAN` Van ·
`TRK` Pickup/Truck · `TRL` Trailer · `TRC` Truck Cab · `M/C`+`MC` Motorcycle ·
`SCO` Scooter/Moped · `BIK` Bike · `CAM` Camper · `LIM` Limousine · `MB` Mini-bike.

## Page structure (top to bottom)

1. **Site header** — gradient banner like `tax-liens.html`: title “Police Auto Auction
   Browser”, subtitle “Montgomery County, MD — Public Auction · July 25, 2026”,
   badges for date, gates 7:30 AM / start 9:00 AM, min bid $50. Link back to `index.html`.
2. **Collapsible info panel** — auction location, payment methods, admittance cutoff,
   “as is, where they sit” terms, contact phone/email from `auction` metadata,
   plus a short “what is this?” blurb and a disclaimer that data comes from the county
   notice and NHTSA decoding is best-effort.
3. **VIN lookup tool** — prominent card: text input (uppercase, strip spaces/`I O Q`
   warning, accept 11–17 chars; validate 17-char check digit client-side is *not*
   required) + “Identify vehicle” button. Result card shows Year Make Model Trim,
   body class, fuel, drive, engine. If the VIN matches an auction vehicle, say so
   (“In this auction — case 26-2506”) and scroll-highlight that row on click.
4. **Stats bar** — total vehicles (281), decoded counter (live), distinct makes,
   year range, count with recorded mileage.
5. **Main layout: sidebar + table** (sidebar collapses above table on ≤900px):
   - Filters: free-text search (case #, VIN, make, decoded model), make dropdown
     (decoded make preferred, fallback expanded makeCode), body-type dropdown
     (use the friendly names), year min/max, checkbox “only vehicles with VIN”.
     Reset button. Live count of matches.
   - Table columns: Case · Year · Make · **Model (decoded)** · Body · VIN
     (monospace; partial VINs get an amber “partial” badge, missing get gray “no VIN”) ·
     Mileage (formatted, “—” if null). Sortable by every column (click header,
     asc/desc). Model column may include trim/series on a subline.
   - Row click → detail drawer/modal with all decoded fields for that vehicle.
6. **Footer** — source-notice provenance line, NHTSA vPIC attribution, “not affiliated
   with Montgomery County” disclaimer, © David Chen 2026.

Mobile: single-column, table degrades to card list or horizontally scrollable table.

## Acceptance checklist

- [ ] `police-auction.html` renders standalone from repo root with no console errors
      even when the vPIC API is blocked (graceful degradation).
- [ ] All 281 rows render; 272 get decoded models when the API is reachable;
      the 9 `vinComplete: false` rows are never sent to the decoder.
- [ ] Second visit performs **zero** batch API calls (localStorage cache hit).
- [ ] Lookup tool identifies an arbitrary pasted VIN and cross-references the inventory.
- [ ] Filters, sort, and search compose correctly; reset restores all 281 rows.
- [ ] No external network dependencies except `vpic.nhtsa.dot.gov`.
- [ ] Optional stretch (only if trivial): add a portfolio card linking to the page in
      `index.html` alongside the existing entries.

## Out of scope

Do not touch `caa-jobs/`, `tax-liens.html`, the parser script, or the JSON data.
Do not add a build step, framework, or GitHub Action.
