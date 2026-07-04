/**
 * extract.mjs — turns raw GasWork listing text into structured, actionable data.
 *
 * Pure functions, no I/O. Works on whatever text is available for a listing:
 * the short search-results snippet, the paraphrased summary, tags, and (when
 * the scraper fetched it) the full detail-page description. Everything is
 * best-effort: a field is null when the listing doesn't state it — never
 * guessed.
 */

const WORD_NUMS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** "$230K", "$260,000", "230k" → integer dollars. Returns null if unparseable. */
export function parseMoney(str) {
  if (str == null) return null;
  const m = String(str).match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (Number.isNaN(n)) return null;
  const val = m[2] ? n * 1000 : n;
  // Annual salaries/bonuses under $1,000 are almost certainly parse noise
  // (e.g. a stray "5×8s"); treat amounts under $1k as amounts only when the
  // raw string had a $ sign.
  if (val < 1000 && !/\$/.test(str)) return null;
  return Math.round(val);
}

/** All money mentions in a text with surrounding context windows. */
function moneyMentions(text) {
  const out = [];
  const re = /\$\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const amount = parseMoney(m[0]);
    if (amount == null) continue;
    out.push({
      amount,
      raw: m[0].trim(),
      index: m.index,
      before: text.slice(Math.max(0, m.index - 60), m.index).toLowerCase(),
      after: text.slice(m.index + m[0].length, m.index + m[0].length + 60).toLowerCase(),
    });
  }
  return out;
}

const test = (re, text) => re.test(text);

/**
 * Categorize each money mention by nearby keywords.
 * Categories: base | package | signOn | loanRepayment | annualBonus | incentive | timeoffFunds | unknown
 */
function classifyMention(men) {
  // Only trust words immediately adjacent to the amount: the qualifier noun
  // phrase either follows it ("$75k sign-on bonus") or precedes it as a label
  // ("Sign-on bonus: $75k"). Wide windows cross-contaminate neighbouring
  // amounts in dense sentences.
  const nearAfter = men.after.slice(0, 28);
  const nearBefore = men.before.slice(-42);
  if (/^\s*(?:in\s+)?(?:student[- ]loan|loan)\s*(?:repayment|forgiveness)/.test(nearAfter) ||
      /(?:student[- ]loan|loan)\s*(?:repayment|forgiveness)[^$a-z]{0,6}$/.test(nearBefore)) return "loanRepayment";
  if (/^\s*annual bonus/.test(nearAfter) || /annual bonus[^$a-z]{0,6}$/.test(nearBefore)) return "annualBonus";
  if (/^\s*(?:in\s+)?(?:sign[- ]?on|signing|start[- ]?date|commencement)\s+bonus/.test(nearAfter) ||
      /(?:sign[- ]?on|signing|start[- ]?date|commencement)\s+bonus[^$a-z]{0,6}$/.test(nearBefore)) return "signOn";
  if (/^\s*(?:in\s+)?(?:upfront\s+)?transition(?:al)?\s+support(?:\s+funds)?/.test(nearAfter) ||
      /(?:transition(?:al)?\s+)?support funds[^$a-z]{0,6}$/.test(nearBefore)) return "signOn"; // upfront cash, sign-on-equivalent
  if (/^\s*(?:site\s+)?incentive/.test(nearAfter) || /(?:site\s+)?incentive[^$a-z]{0,6}$/.test(nearBefore)) return "incentive";
  if (/(?:total\s+)?package/.test(nearBefore) || /^\s*(?:total\s+)?package/.test(nearAfter)) return "package";
  if (/(base\b|salar(?:y|ies)|income|pays?\b|paying|starting at|starts? at|per year|annually|new grads?|experienced)[^$]{0,20}$/.test(nearBefore)) return "base";
  return "unknown";
}

/** Extract a "no call / no nights / no weekends / no holidays" schedule from text. */
export function extractNegations(text) {
  const t = text.toLowerCase();
  const found = { noCall: false, noNights: false, noWeekends: false, noHolidays: false };
  // Segments that start with a negation and run to the end of the clause,
  // e.g. "no call, nights, weekends, or holidays", "no nights, weekends, or call".
  const re = /\b(?:no|without|free of)[ -]((?:call|nights?|weekends?|holidays?)(?:[ ,/]|or |and |s\b)*(?:call|nights?|weekends?|holidays?)?(?:[ ,/]|or |and )*(?:call|nights?|weekends?|holidays?)?(?:[ ,/]|or |and )*(?:call|nights?|weekends?|holidays?)?)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const seg = m[1];
    if (/\bcall\b/.test(seg)) found.noCall = true;
    if (/\bnights?\b/.test(seg)) found.noNights = true;
    if (/\bweekends?\b/.test(seg)) found.noWeekends = true;
    if (/\bholidays?\b/.test(seg)) found.noHolidays = true;
  }
  if (/\bno[- ]call\b/.test(t)) found.noCall = true;
  return found;
}

/** Shift lengths mentioned: "10- and 12-hour", "8/10/12-hour", "5×8s", "10s & 12s", "8s/10s/12s". */
export function extractShifts(text) {
  const t = text.toLowerCase();
  const shifts = new Set();
  let m;
  const hourRe = /\b(8|10|12|16|24)(?=(?:s\b|[-\s]?(?:hour|hr)|\/|[-\s]*(?:&|and)\s*(?:8|10|12)))/g;
  while ((m = hourRe.exec(t)) !== null) {
    // avoid matching times like "7a–7p" or dates; the lookahead already keeps this narrow
    shifts.add(`${m[1]}s`);
  }
  return [...shifts].sort((a, b) => parseInt(a) - parseInt(b));
}

/** Weeks of PTO / vacation / time off. Handles digits, ranges, and number words. */
export function extractTimeOff(text) {
  const t = text.toLowerCase();
  const wordNum = Object.keys(WORD_NUMS).join("|");
  const re = new RegExp(
    `(?:up to |minimum of |at least )?(\\d{1,2}|${wordNum})(?:\\s*[–\\-—]\\s*(\\d{1,2}))?\\+?\\s*(?:\\+\\s*)?weeks?(?:\\s+of)?\\s*(?:of\\s+)?(vacation|pto|time off|off|pto\\/holidays\\/cme|pto, holidays,? (?:and |& )?cme)`,
    "i"
  );
  const m = t.match(re);
  if (!m) return { weeksMin: null, weeksMax: null, label: null };
  const toN = (s) => (s in WORD_NUMS ? WORD_NUMS[s] : parseInt(s, 10));
  const a = toN(m[1]);
  const b = m[2] ? toN(m[2]) : null;
  const upTo = /up to/i.test(m[0]);
  return {
    weeksMin: upTo ? null : a,
    weeksMax: b ?? (upTo ? a : null),
    label: m[0].replace(/\s+/g, " ").trim(),
  };
}

/** 0.6–1.0 FTE style ranges. */
export function extractFte(text) {
  const m = text.match(/(\d(?:\.\d+)?)\s*[–\-]\s*(\d(?:\.\d+)?)\s*fte/i);
  if (!m) return null;
  return { min: parseFloat(m[1]), max: parseFloat(m[2]) };
}

/**
 * Main entry: enrich one raw listing record into the actionable schema.
 * `raw` is a seed/scraped record; `scrapedAt` is the ISO snapshot date.
 * Optional `fullText` (detail-page description) is appended to the text pool.
 */
export function extractListing(raw, scrapedAt, fullText = "") {
  const compText = (raw.comp || []).map((c) => `${c.k}: ${c.v}.`).join(" ");
  const tagText = (raw.tags || []).join(". ");
  const text = [raw.role, raw.summary, compText, tagText, raw.bonus || "", fullText].join("\n");
  const t = text.toLowerCase();

  const mentions = moneyMentions(text).map((m) => ({ ...m, cat: classifyMention(m) }));
  const byCat = (cat) => mentions.filter((m) => m.cat === cat);

  // --- base salary -----------------------------------------------------------
  // Stated payMin/payMax (transcribed from the posting) always win; text-parsed
  // values only fill gaps and are labelled as such.
  const baseMentions = byCat("base").filter((m) => m.amount >= 100000);
  let base = {
    min: raw.payMin ?? null,
    max: raw.payMax ?? null,
    source: raw.payMin != null || raw.payMax != null ? "stated" : null,
    newGrad: null,
    experienced: null,
  };
  for (const m of baseMentions) {
    const tail = m.before.slice(-25); // qualifier must sit right before the amount
    if (/new[- ]grads?/.test(tail)) base.newGrad = m.amount;
    if (/experienced/.test(tail)) base.experienced = m.amount;
  }
  if (base.min == null && base.max == null && baseMentions.length > 0) {
    const amts = baseMentions.map((m) => m.amount);
    base.min = Math.min(...amts);
    base.max = amts.length > 1 ? Math.max(...amts) : null;
    if (base.max === base.min) base.max = null;
    base.source = "parsed";
  }

  // --- total package (base + everything), when quoted as such ---------------
  const pkgMentions = byCat("package").filter((m) => m.amount >= 100000);
  const pkg = pkgMentions.length
    ? { min: Math.min(...pkgMentions.map((m) => m.amount)), max: pkgMentions.length > 1 ? Math.max(...pkgMentions.map((m) => m.amount)) : null }
    : null;

  // --- bonuses & incentives --------------------------------------------------
  const signOnM = byCat("signOn");
  const signOnOffered =
    signOnM.length > 0 ||
    /(sign[- ]?on|signing|start[- ]?date|commencement)\s+bonus/.test(t) ||
    /(transition(al)? support funds)/.test(t);
  const signOn = {
    amount: signOnM.length ? Math.max(...signOnM.map((m) => m.amount)) : null,
    offered: signOnOffered,
    label: raw.bonus || (signOnM[0]?.raw ?? (signOnOffered ? "Offered (amount not stated)" : null)),
  };

  const loanM = byCat("loanRepayment");
  const loanRepayment = {
    amount: loanM.length ? Math.max(...loanM.map((m) => m.amount)) : null,
    offered: loanM.length > 0 || /student[- ]loan/.test(t),
  };
  // "…a choice of a $50K sign-on bonus OR $75K in student-loan repayment"
  const bonusIsAlternative = /bonus or \$|or \$\d+k? in student[- ]loan/i.test(text);

  const annualBonusM = byCat("annualBonus");
  const annualBonus = annualBonusM.length ? Math.max(...annualBonusM.map((m) => m.amount)) : null;

  const incentives = byCat("incentive").map((m) => ({
    amount: m.amount,
    label: (m.after.match(/^\s*(site incentive|incentive)/) || [null, "incentive"])[1],
  }));

  // --- schedule ----------------------------------------------------------------
  const neg = extractNegations(text);
  const weekendOnly = /weekend (caa )?(position|coverage|shifts?)|\(fri(day)?\s*[–\-]\s*sun(day)?\)|friday\s*[–\-]\s*sunday/i.test(t);
  const schedule = {
    ...neg,
    weekendOnly,
    shifts: extractShifts(text),
    fte: extractFte(text),
    partTimeOption: /full[- ]?\s*or part[- ]?time/i.test(t),
    guaranteedHours: /guaranteed (scheduled )?hours/i.test(t),
  };

  // --- everything else ---------------------------------------------------------
  const timeOff = extractTimeOff(text);
  const newGrad = /new grads?|grads? welcome|20\d{2}(?: and 20\d{2})? grad/i.test(t);
  const relocation = /reloc/i.test(t);
  const employmentOptions = /w-?2 or 1099|1099 or w-?2/i.test(t)
    ? ["W-2", "1099"]
    : raw.w2
      ? [raw.w2]
      : null;

  // --- derived: estimated first-year cash value --------------------------------
  // base (min stated/parsed, else package min) + sign-on + annual bonus + incentives.
  // Loan repayment excluded when it's an either/or with the sign-on bonus.
  const parts = [];
  const baseForValue = base.min ?? pkg?.min ?? null;
  if (baseForValue != null) parts.push({ label: base.min != null ? "Base salary" : "Total package (floor)", amount: baseForValue });
  if (signOn.amount != null) parts.push({ label: "Sign-on / start bonus", amount: signOn.amount });
  if (annualBonus != null) parts.push({ label: "Annual bonus", amount: annualBonus });
  for (const inc of incentives) parts.push({ label: inc.label === "site incentive" ? "Site incentive" : "Incentive", amount: inc.amount });
  if (loanRepayment.amount != null && !bonusIsAlternative) parts.push({ label: "Student-loan repayment", amount: loanRepayment.amount });
  const firstYear = baseForValue != null
    ? { min: parts.reduce((s, p) => s + p.amount, 0), parts, note: bonusIsAlternative ? "Sign-on bonus and loan repayment are an either/or choice; the larger applies to year one only once." : null }
    : { min: null, parts, note: null };

  // --- freshness ----------------------------------------------------------------
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const daysPosted = raw.posted ? days(raw.posted, scrapedAt) : null;
  const daysUpdated = raw.updated ? days(raw.updated, scrapedAt) : null;

  return {
    ...raw,
    x: {
      base,
      package: pkg,
      signOn,
      loanRepayment: { ...loanRepayment, alternativeToSignOn: bonusIsAlternative },
      annualBonus,
      incentives,
      relocation,
      schedule,
      timeOff,
      newGrad,
      employmentOptions,
      firstYear,
      daysPosted,
      daysUpdated,
      longRunning: daysPosted != null && daysPosted > 180,
    },
  };
}

/** Enrich a whole set of listings and compute dataset-level stats.
 *  Records may carry a `fullText` field (detail-page text) — it feeds the
 *  extractor but is stripped from the output to keep jobs.json lean. */
export function buildDataset(rawListings, scrapedAt, source) {
  const jobs = rawListings.map(({ fullText, ...r }) => extractListing(r, scrapedAt, fullText || ""));
  const paid = jobs.filter((j) => j.payMin != null || j.payMax != null);
  const bases = paid.map((j) => j.payMax ?? j.payMin).sort((a, b) => a - b);
  const median = bases.length ? bases[Math.floor(bases.length / 2)] : null;
  return {
    jobs,
    meta: {
      scrapedAt,
      source,
      total: jobs.length,
      withPay: paid.length,
      withSignOn: jobs.filter((j) => j.x.signOn.offered).length,
      noCall: jobs.filter((j) => j.x.schedule.noCall).length,
      medianBase: median,
      states: [...new Set(jobs.map((j) => j.state))].sort(),
    },
  };
}
