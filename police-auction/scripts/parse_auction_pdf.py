#!/usr/bin/env python3
"""Parse a Montgomery County Police vehicle-auction notice PDF into JSON.

The auction table rows extract as text like:
    26-1083 95 ACUR JH4KA827XSC002515 2055922DR
    26-2506 20 JEEP 1C4HJXDN8LW122914 66949SUV
    25-2138 SUZI M/C
The VIN, mileage, and body code run together, so the parser strips a known
body-code suffix off the last token, then splits VIN vs. mileage.

Usage: python3 parse_auction_pdf.py <input.pdf> <output.json>
Requires: pypdf
"""
import json
import re
import sys

from pypdf import PdfReader

# Known body codes, longest first so e.g. "4DR" wins over "DR".
BODY_CODES = [
    "M/C", "4DR", "2DR", "SUV", "SUB", "VAN", "TRK", "TRL", "TRC",
    "SCO", "BIK", "CAM", "LIM", "MC", "MB",
]

CASE_RE = re.compile(r"^\d{2}-\d{4}$")
YEAR_RE = re.compile(r"^\d{2}$")
MAKE_RE = re.compile(r"^[A-Z]{2,4}$")


def expand_year(yy: int) -> int:
    # Listings run up to the current model year (2026).
    return 2000 + yy if yy <= 26 else 1900 + yy


def strip_body(token: str):
    """Return (rest, body_code) if token ends with a known body code."""
    upper = token.upper()
    for code in BODY_CODES:
        if upper.endswith(code):
            return token[: len(token) - len(code)], code
    return token, None


def parse_line(line: str):
    tokens = line.split()
    if not tokens or not CASE_RE.match(tokens[0]):
        return None
    rec = {
        "case": tokens[0],
        "year": None,
        "makeCode": None,
        "vin": None,
        "body": None,
        "mileage": None,
    }
    rest = tokens[1:]
    if rest and YEAR_RE.match(rest[0]):
        rec["year"] = expand_year(int(rest.pop(0)))
    if not rest:
        return rec

    last, body = strip_body(rest.pop())
    rec["body"] = body

    if last:
        if last.isdigit() and rest:
            # "<VIN> <mileage><BODY>" split across two tokens
            rec["mileage"] = int(last)
            rec["vin"] = rest.pop()
        else:
            rec["vin"] = last

    # Whatever remains between year and VIN is the make abbreviation.
    if rest and MAKE_RE.match(rest[0]):
        rec["makeCode"] = rest.pop(0)
    if rest:
        print(f"WARN {rec['case']}: unparsed tokens {rest}", file=sys.stderr)
    return rec


def main(pdf_path: str, out_path: str):
    reader = PdfReader(pdf_path)
    records = []
    for page in reader.pages:
        for line in (page.extract_text() or "").splitlines():
            rec = parse_line(line.strip())
            if rec:
                records.append(rec)

    for rec in records:
        vin = rec["vin"]
        rec["vinComplete"] = bool(vin) and len(vin) == 17

    doc = {
        "source": "Montgomery County Department of Police — Notice: Public Auction (JULY_COURT_POST_2026.pdf)",
        "auction": {
            "date": "2026-07-25",
            "gatesOpen": "7:30 AM",
            "auctionStarts": "9:00 AM",
            "lastAdmittance": "8:45 AM",
            "location": "305 Metropolitan Grove Road, Gaithersburg, Maryland 20878",
            "phone": "240-773-6411",
            "email": "abandoned.vehicle@montgomerycountymd.gov",
            "minimumBid": 50,
            "payment": "Cash, Visa, Master Card, American Express, and Discover",
            "terms": "All sales are final. Vehicles are purchased “as is, where they sit.”",
        },
        "vehicles": records,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=1)
    complete = sum(1 for r in records if r["vinComplete"])
    print(f"{len(records)} vehicles ({complete} with full 17-char VINs) -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
