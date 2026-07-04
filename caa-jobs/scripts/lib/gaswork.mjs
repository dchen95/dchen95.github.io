/**
 * gaswork.mjs — best-effort parsers for gaswork.com HTML.
 *
 * GasWork's results page is server-rendered ASP.NET; markup can change and
 * pagination beyond page 1 requires a __VIEWSTATE postback. These parsers are
 * therefore deliberately tolerant: they anchor on the one thing that is
 * stable — links / references to a numeric post id — and hoover up labelled
 * fields around it. The scraper caches every fetched page under data/raw/ so
 * that when the markup does drift, you can re-run parsing offline
 * (`node scripts/scrape.mjs --from-cache`) while you adjust the regexes here.
 */

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Find every post reference on a search-results page, with its surrounding block of text. */
export function parseSearchPage(html) {
  const results = new Map();
  // Post ids appear as /post/123456 links and as PostID=123456 / ShowPost query params.
  const refRe = /(?:\/post\/|PostID=|PostId=|postid=)(\d{4,7})/g;
  let m;
  while ((m = refRe.exec(html)) !== null) {
    const ref = parseInt(m[1], 10);
    if (results.has(ref)) continue;
    // Grab a window of markup around the match and strip it to text — enough
    // to recover title/employer/location lines regardless of exact structure.
    const start = Math.max(0, m.index - 3000);
    const block = decode(html.slice(start, m.index + 3000));
    results.set(ref, { ref, blockText: block });
  }
  return [...results.values()];
}

const FIELD_LABELS = {
  employer: /(?:Employer|Company|Group Name|Practice)\s*:?\s*/i,
  city: /City\s*:?\s*/i,
  state: /State\s*:?\s*/i,
  position: /(?:Position(?:\s*Type)?|Job Type)\s*:?\s*/i,
  posted: /(?:Posted|Post(?:ed)? Date|Date Posted)\s*:?\s*/i,
  updated: /(?:Updated|Last Updated|Renewed)\s*:?\s*/i,
  reference: /(?:Reference|Ref(?:erence)?\s*#|Post\s*#)\s*:?\s*/i,
};

function grabField(text, label) {
  const re = new RegExp(label.source + "([^\\n:]{1,80}?)(?=\\s{2,}|$|[A-Z][a-z]+\\s*:)", label.flags);
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseDateLoose(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a post detail page into a raw listing record (the same shape as the
 * seed records). Fields the page doesn't state come back null — the
 * extractor treats null as "not specified", never a guess.
 */
export function parseDetailPage(html, ref) {
  const text = decode(html);
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, null])[1];

  const record = {
    ref,
    role: title ? decode(title).replace(/\s*[-|–]\s*GasWork.*$/i, "") : null,
    employer: grabField(text, FIELD_LABELS.employer),
    kind: null,
    etype: null,
    city: grabField(text, FIELD_LABELS.city),
    state: grabField(text, FIELD_LABELS.state),
    position: grabField(text, FIELD_LABELS.position),
    w2: /\bW-?2\b/i.test(text) ? "W-2" : /\b1099\b/.test(text) ? "1099" : null,
    payMin: null,
    payMax: null,
    summary: null,
    comp: [],
    bonus: null,
    tags: [],
    immediate: /immediate(ly)? (start|opening|need)/i.test(text),
    urgent: /urgent|actively recruiting/i.test(text),
    posted: parseDateLoose(grabField(text, FIELD_LABELS.posted)),
    updated: parseDateLoose(grabField(text, FIELD_LABELS.updated)),
    fullText: text,
  };

  // Recruitment agencies vs direct employers: GasWork labels the poster type.
  const kindMatch = text.match(/(Group: [A-Za-z ]+Practice|Facility: [A-Za-z ]+|Recruitment Agency|Advertising Firm|Locum Agency)/);
  if (kindMatch) {
    record.kind = kindMatch[1].trim();
    record.etype = /Agency|Firm/i.test(record.kind) ? "Agency" : "Direct";
  }
  if (/locum/i.test(record.position || "") || /\blocum tenens\b/i.test(text)) record.position = "Locum";
  else if (!record.position) record.position = /part[- ]time/i.test(text) ? "Part-Time" : "Full-Time";

  return record;
}
