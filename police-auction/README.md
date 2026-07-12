# Police Auction Vehicle Viewer

Data and design docs for the police auto-auction browser page
(`/police-auction.html`, built per [PLAN.md](PLAN.md)).

- `data/JULY_COURT_POST_2026.pdf` — source notice: Montgomery County Department of
  Police public auction, July 25, 2026.
- `data/auction-2026-07.json` — the notice parsed into structured records
  (281 vehicles: case #, year, make code, body code, VIN, mileage where listed).
- `data/decoded-vins.json` — *optional* prebuilt NHTSA decode cache (VIN-keyed).
  The page works without it; regenerate from any machine with access to
  `vpic.nhtsa.dot.gov` if desired.
- `scripts/parse_auction_pdf.py` — regenerates the JSON from a notice PDF
  (`python3 parse_auction_pdf.py <in.pdf> <out.json>`, needs `pypdf`). Reusable for
  future monthly auction notices.
- `PLAN.md` — full implementation spec for the website.

VIN → model identification uses the free NHTSA vPIC API
(`https://vpic.nhtsa.dot.gov/api/`), called client-side from the visitor's browser.
