import React, { useState, useMemo, useEffect } from "react";
import {
  Search, MapPin, Bookmark, BookmarkCheck, X, SlidersHorizontal, Building2,
  Users, Calendar, ChevronDown, ExternalLink, Zap, Check, Activity, Layers,
  Info, HeartPulse, ArrowLeft, Circle, Trash2, Ban, Sparkles,
} from "lucide-react";

import JOBS from "./data/jobs.json";
import META from "./data/meta.json";
import CHANGES from "./data/changes.json";

/* ============================================================================
   Waveform — a CAA-only job board reimagining GasWork.com
   Data: real Certified Anesthesiologist Assistant listings from gaswork.com,
   produced by the scraping/extraction pipeline in scripts/ (see PIPELINE.md).
   src/data/jobs.json carries each listing's raw fields plus an `x` block of
   extracted, actionable data (parsed pay, bonuses, schedule, time off, …).
   Factual fields are kept exact; every card links back to its original
   posting at gaswork.com/post/{ref}. Refresh with `npm run data:scrape`.
============================================================================ */

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SCRAPE_ISO = META.scrapedAt;
const SCRAPE_LABEL = (() => { const [y, m, d] = SCRAPE_ISO.split("-").map(Number); return `${FULL_MONTHS[m - 1]} ${d}, ${y}`; })();
const SNAP_YEAR = Number(SCRAPE_ISO.slice(0, 4));

const C = {
  bg: "#ECF1EF", panel: "#FFFFFF", panelAlt: "#F6F9F8",
  ink: "#122220", sub: "#566B67", faint: "#869691",
  line: "#DAE3E0", lineStrong: "#C4D2CE",
  teal: "#0B6E5D", tealDeep: "#073A32", tealSoft: "#E4F0EC",
  mint: "#15C39A", amber: "#8A5E0C", amberSoft: "#F5EDD9",
};

/* Snapshot diff (scripts/diff-snapshots.mjs): which listings are new/removed/
   repriced since the previous scrape. Empty until the refresh workflow runs. */
const NEW_REFS = new Set(CHANGES.newRefs);
const CHANGE_COUNT = CHANGES.newRefs.length + CHANGES.removedRefs.length + CHANGES.payChanged.length;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const kFmt = (n) => `$${Math.round(n / 1000)}K`;
const postUrl = (ref) => `https://www.gaswork.com/post/${ref}`;

function payFmt(j) {
  if (j.payMin != null && j.payMax != null) return `${kFmt(j.payMin)}–${kFmt(j.payMax)}`;
  if (j.payMin != null) return `${kFmt(j.payMin)}+`;
  if (j.payMax != null) return `Up to ${kFmt(j.payMax)}`;
  return null;
}
function dateFmt(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${y !== SNAP_YEAR ? `, ${y}` : ""}`;
}
function daysBetween(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / 86400000);
}
const isBonusKey = (k) => /bonus|funds|incentive|repayment|commencement/i.test(k);

/* ---------------------- Actionable facets (from x block) -------------------- */
const FLAG_DEFS = [
  { k: "noCall", label: "No call", test: (j) => j.x.schedule.noCall },
  { k: "noWeekends", label: "No weekends", test: (j) => j.x.schedule.noWeekends },
  { k: "signOn", label: "Sign-on / start bonus", test: (j) => j.x.signOn.offered },
  { k: "newGrad", label: "New-grad friendly", test: (j) => j.x.newGrad },
  { k: "loans", label: "Student-loan repayment", test: (j) => j.x.loanRepayment.offered },
  { k: "reloc", label: "Relocation support", test: (j) => j.x.relocation },
  { k: "pto6", label: "6+ weeks off", test: (j) => (j.x.timeOff.weeksMin ?? 0) >= 6 || (j.x.timeOff.weeksMax ?? 0) >= 6 },
];
const flagLabel = (k) => FLAG_DEFS.find((d) => d.k === k)?.label ?? k;
const passesFlags = (j, flags) => [...flags].every((k) => FLAG_DEFS.find((d) => d.k === k)?.test(j));

/** Up to two extracted highlights for a card — derived data, not raw tags. */
function derivedBadges(j) {
  const x = j.x, out = [];
  if (x.schedule.noCall) out.push("No call");
  if (x.schedule.weekendOnly) out.push("Weekends only");
  if (x.timeOff.weeksMin != null || x.timeOff.weeksMax != null) out.push(`${x.timeOff.weeksMin ?? "up to " + x.timeOff.weeksMax}${x.timeOff.weeksMax && x.timeOff.weeksMin ? "–" + x.timeOff.weeksMax : x.timeOff.weeksMin ? "+" : ""} wks off`);
  if (x.newGrad) out.push("New grads");
  if (x.loanRepayment.offered) out.push("Loan repayment");
  if (x.relocation) out.push("Relocation");
  if (out.length === 0 && j.tags[0]) out.push(j.tags[0]);
  return out.slice(0, 2);
}

/* Market context: where a listing's base sits among all listings with stated pay. */
const MARKET = (() => {
  const bases = JOBS.filter((j) => j.payMin != null || j.payMax != null).map((j) => j.payMax ?? j.payMin).sort((a, b) => a - b);
  return { bases, n: bases.length, min: bases[0], max: bases[bases.length - 1], median: META.medianBase };
})();
function marketPos(j) {
  const base = j.payMax ?? j.payMin;
  if (base == null || MARKET.n < 3) return null;
  const below = MARKET.bases.filter((b) => b < base).length;
  return { base, pct: Math.round((below / (MARKET.n - 1)) * 100) };
}

const STYLE = `
:root{--teal:#0B6E5D;--tealDeep:#073A32;--mint:#15C39A;--ink:#122220;--line:#DAE3E0;--amber:#8A5E0C;}
.wf *{box-sizing:border-box;}
.wf{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
.ecg-scroll{animation:ecg 16s linear infinite;}
@keyframes ecg{from{transform:translateX(0);}to{transform:translateX(-1200px);}}
.jobcard{transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease;}
.jobcard:hover{transform:translateY(-2px);box-shadow:0 12px 26px -14px rgba(7,58,50,.30);border-color:#BCD1CB;}
.tap{cursor:pointer;}
.btnp{background:var(--teal);color:#fff;} .btnp:hover{background:#0A5E51;}
.btns{background:#fff;color:var(--ink);border:1px solid var(--line);} .btns:hover{border-color:#B4C8C2;background:#F4F8F7;}
.btng{background:transparent;color:#4A5C58;} .btng:hover{color:var(--ink);background:#E7EEEC;}
.chipx{transition:background-color .15s ease, border-color .15s ease;}
.chipx:hover{background:#EFF5F3;border-color:#C4D2CE;}
.statechip{transition:all .14s ease;cursor:pointer;}
.statechip:hover{border-color:#B4C8C2;}
input[type=range]{accent-color:var(--teal);height:4px;}
.wf a{color:inherit;}
.wf-focus:focus-visible, .wf button:focus-visible, .wf a:focus-visible, .wf input:focus-visible, .wf select:focus-visible{outline:2px solid var(--teal);outline-offset:2px;border-radius:8px;}
.clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.wf-scroll::-webkit-scrollbar{width:10px;height:10px;}
.wf-scroll::-webkit-scrollbar-thumb{background:#CBD8D3;border-radius:8px;border:2px solid transparent;background-clip:content-box;}
.knob{transition:transform .18s ease;}
.tgl{transition:background-color .18s ease;}
.fadein{animation:fadein .2s ease both;}
@keyframes fadein{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}
.slideover{animation:slideover .22s cubic-bezier(.22,.61,.36,1) both;}
@keyframes slideover{from{transform:translateX(24px);opacity:.6;}to{transform:none;opacity:1;}}
@media (prefers-reduced-motion: reduce){
  .ecg-scroll{animation:none;} .jobcard{transition:none;} .jobcard:hover{transform:none;}
  .fadein,.slideover{animation:none;}
}
`;

/* -------------------------------- Primitives ------------------------------- */
function Pill({ children, tone = "neutral", icon: Icon }) {
  const map = {
    neutral: { bg: C.panelAlt, fg: C.sub, bd: C.line },
    teal: { bg: C.tealSoft, fg: C.teal, bd: "#CDE4DD" },
    amber: { bg: C.amberSoft, fg: C.amber, bd: "#E9DcB8" },
    ink: { bg: "#EAF0EE", fg: C.ink, bd: C.line },
  }[tone];
  return (
    <span className="inline-flex items-center gap-1 rounded-full"
      style={{ background: map.bg, color: map.fg, border: `1px solid ${map.bd}`, padding: "3px 9px", fontSize: 11.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap" }}>
      {Icon && <Icon size={12} strokeWidth={2.4} />}{children}
    </span>
  );
}
function Label({ children, style }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.faint, ...style }}>{children}</div>;
}
function Toggle({ on, onClick, id }) {
  return (
    <button id={id} onClick={onClick} role="switch" aria-checked={on}
      className="tgl wf-focus" style={{ width: 38, height: 22, borderRadius: 999, background: on ? C.teal : "#CBD6D2", position: "relative", flex: "0 0 auto", border: "none", cursor: "pointer" }}>
      <span className="knob" style={{ position: "absolute", top: 2, left: 2, width: 18, height: 18, borderRadius: 999, background: "#fff", transform: on ? "translateX(16px)" : "none", boxShadow: "0 1px 2px rgba(0,0,0,.25)" }} />
    </button>
  );
}
function Checkbox({ on }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center justify-center" style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${on ? C.teal : C.lineStrong}`, background: on ? C.teal : "#fff", flex: "0 0 auto" }}>
      {on && <Check size={13} color="#fff" strokeWidth={3} />}
    </span>
  );
}

/* -------------------------------- Vitals hero ------------------------------ */
function VitalsTrace() {
  const width = 2400, mid = 26, seg = 120;
  let d = `M0 ${mid}`;
  for (let x = 0; x < width; x += seg) {
    d += ` H${x + 42} L${x + 48} ${mid - 3} L${x + 54} ${mid} L${x + 60} ${mid - 17} L${x + 66} ${mid + 20} L${x + 72} ${mid - 5} L${x + 78} ${mid} H${x + seg}`;
  }
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 52, overflow: "hidden", opacity: 0.55 }}>
      <svg width={width} height="52" viewBox={`0 0 ${width} 52`} className="ecg-scroll" style={{ position: "absolute", bottom: 0, left: 0 }}>
        <path d={d} fill="none" stroke={C.mint} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
function Readout({ value, label }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 17, fontWeight: 700, color: "#EAF5F1", letterSpacing: "-.01em", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "#7FB3A6", marginTop: 2, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}
function Hero({ stats }) {
  return (
    <div className="fadein" style={{ position: "relative", overflow: "hidden", background: C.tealDeep, borderRadius: 20, padding: "26px 24px 30px", boxShadow: "0 20px 40px -28px rgba(7,58,50,.55)" }}>
      <VitalsTrace />
      <div style={{ position: "relative" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
          <span className="inline-flex items-center gap-1.5 rounded-full" style={{ border: "1px solid rgba(21,195,154,.4)", color: C.mint, padding: "3px 10px", fontSize: 11, fontWeight: 700, letterSpacing: ".06em" }}>
            <Circle size={7} fill={C.mint} strokeWidth={0} /> SNAPSHOT · {SCRAPE_LABEL.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2.5" style={{ marginBottom: 6 }}>
          <HeartPulse size={26} color={C.mint} strokeWidth={2.2} />
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.03em", color: "#FDFFFE" }}>Waveform</span>
        </div>
        <p style={{ color: "#B9D6CD", fontSize: 15.5, maxWidth: 560, lineHeight: 1.45, margin: 0 }}>
          Every open Certified Anesthesiologist Assistant position — actually searchable. Real listings, sourced from GasWork.
        </p>
        <div className="flex flex-wrap" style={{ gap: "22px 30px", marginTop: 22, alignItems: "flex-end" }}>
          <Readout value={stats.total} label="Open positions" />
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,.14)" }} />
          <Readout value={stats.states} label="CAA-licensed states" />
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,.14)" }} />
          <Readout value={stats.median} label={`Median base (${stats.withPay} listed)`} />
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,.14)" }} />
          <Readout value={stats.range} label="Salary range" />
          <div style={{ width: 1, height: 30, background: "rgba(255,255,255,.14)" }} />
          <Readout value={stats.signOn} label="With sign-on bonus" />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Job card -------------------------------- */
function EmployerBadge({ job }) {
  if (job.etype === "Agency")
    return <Pill tone="neutral" icon={Users}>{job.kind === "Advertising Firm" ? "Via firm" : "Agency / recruiter"}</Pill>;
  return <Pill tone="teal" icon={Building2}>Direct employer</Pill>;
}
function JobCard({ job, saved, onSave, onOpen }) {
  const pay = payFmt(job);
  return (
    <div className="jobcard tap" onClick={() => onOpen(job)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(job); } }}
      style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 11 }}>
      <div className="flex items-start justify-between" style={{ gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          {pay ? (
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 19, fontWeight: 700, color: C.teal, letterSpacing: "-.02em" }}>{pay}<span style={{ fontSize: 11, fontWeight: 600, color: C.faint, marginLeft: 5 }}>/yr</span></div>
          ) : job.bonus ? (
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 15, fontWeight: 700, color: C.amber }}>{job.bonus}</div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: C.faint }}>Compensation not specified</div>
          )}
          {pay && job.bonus && <div style={{ fontSize: 12, color: C.amber, fontWeight: 600, marginTop: 2 }}>+ {job.bonus}</div>}
          {job.x.firstYear.min != null && job.x.firstYear.parts.length > 1 && (
            <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, marginTop: 3 }}>≈ {kFmt(job.x.firstYear.min)} est. first-year total</div>
          )}
        </div>
        <button aria-label={saved ? "Remove saved job" : "Save job"} className="wf-focus"
          onClick={(e) => { e.stopPropagation(); onSave(job.ref); }}
          style={{ border: "none", background: "transparent", cursor: "pointer", padding: 2, color: saved ? C.teal : C.faint, flex: "0 0 auto" }}>
          {saved ? <BookmarkCheck size={20} strokeWidth={2.2} /> : <Bookmark size={20} strokeWidth={2} />}
        </button>
      </div>

      <div>
        <h3 style={{ fontSize: 15.5, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.3, letterSpacing: "-.01em" }}>{job.role}</h3>
        <p className="clamp2" style={{ fontSize: 13, color: C.sub, margin: "5px 0 0", lineHeight: 1.5 }}>{job.summary}</p>
      </div>

      <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
        {NEW_REFS.has(job.ref) && <Pill tone="teal" icon={Sparkles}>New</Pill>}
        {job.immediate && <Pill tone="amber" icon={Zap}>Immediate start</Pill>}
        {!job.immediate && job.urgent && <Pill tone="amber" icon={Zap}>Actively recruiting</Pill>}
        <Pill tone={job.position === "Locum" ? "ink" : "neutral"}>{job.position}</Pill>
        {job.w2 && <Pill tone="neutral">{job.w2}</Pill>}
        {derivedBadges(job).map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}
      </div>

      <div style={{ height: 1, background: C.line }} />

      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-1.5" style={{ color: C.ink, fontSize: 13, fontWeight: 600, minWidth: 0 }}>
            <MapPin size={13} strokeWidth={2.2} color={C.teal} style={{ flex: "0 0 auto" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.city || "Location varies"}, {job.state}</span>
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.employer}</div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <EmployerBadge job={job} />
          <div style={{ fontSize: 11, color: C.faint, marginTop: 5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>Posted {dateFmt(job.posted)}</div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Filters UI ------------------------------- */
function FilterGroup({ title, children }) {
  return (
    <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: `1px solid ${C.line}` }}>
      <Label style={{ marginBottom: 11 }}>{title}</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>
    </div>
  );
}
function CheckRow({ label, count, on, onClick }) {
  return (
    <button onClick={onClick} className="wf-focus" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: "1px 0", textAlign: "left" }}>
      <span className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
        <Checkbox on={on} />
        <span style={{ fontSize: 13.5, color: on ? C.ink : C.sub, fontWeight: on ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </span>
      <span style={{ fontSize: 11.5, color: C.faint, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", flex: "0 0 auto" }}>{count}</span>
    </button>
  );
}
function FiltersPanel({ f, set, counts, onClear, activeCount }) {
  const RECENCY = [{ k: "any", label: "Any time" }, { k: "30", label: "Last 30 days" }, { k: "60", label: "Last 60 days" }, { k: "90", label: "Last 90 days" }];
  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <div className="flex items-center gap-2" style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>
          <SlidersHorizontal size={15} strokeWidth={2.3} color={C.teal} /> Filters
        </div>
        {activeCount > 0 && (
          <button onClick={onClear} className="btng wf-focus" style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "4px 8px", borderRadius: 8 }}>Clear all</button>
        )}
      </div>

      <FilterGroup title="What matters">
        {FLAG_DEFS.map((d) => (
          <CheckRow key={d.k} label={d.label} count={counts.flags[d.k] || 0} on={f.flags.has(d.k)} onClick={() => set.toggleSet("flags", d.k)} />
        ))}
      </FilterGroup>

      <FilterGroup title={`State · ${Object.keys(counts.state).length}`}>
        {Object.entries(counts.state).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
          <CheckRow key={s} label={s} count={n} on={f.states.has(s)} onClick={() => set.toggleSet("states", s)} />
        ))}
      </FilterGroup>

      <FilterGroup title="Position type">
        {["Full-Time", "Locum"].map((p) => (
          <CheckRow key={p} label={p} count={counts.position[p] || 0} on={f.positions.has(p)} onClick={() => set.toggleSet("positions", p)} />
        ))}
      </FilterGroup>

      <FilterGroup title="Employer">
        <CheckRow label="Direct employer" count={counts.etype.Direct || 0} on={f.etypes.has("Direct")} onClick={() => set.toggleSet("etypes", "Direct")} />
        <CheckRow label="Agency / recruiter" count={counts.etype.Agency || 0} on={f.etypes.has("Agency")} onClick={() => set.toggleSet("etypes", "Agency")} />
      </FilterGroup>

      <FilterGroup title="Salary">
        <div className="flex items-center justify-between" style={{ gap: 10 }}>
          <label htmlFor="hasSalary" style={{ fontSize: 13.5, color: C.sub, fontWeight: 500 }}>Only listings with a salary</label>
          <Toggle id="hasSalary" on={f.hasSalary} onClick={() => set.patch({ hasSalary: !f.hasSalary })} />
        </div>
        <div style={{ marginTop: 6 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: C.faint }}>Range</span>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, color: C.teal, fontWeight: 700 }}>{kFmt(f.pay[0])} – {kFmt(f.pay[1])}</span>
          </div>
          <input type="range" min={200000} max={320000} step={5000} value={f.pay[0]} aria-label="Minimum salary"
            onChange={(e) => set.patch({ pay: [Math.min(+e.target.value, f.pay[1] - 5000), f.pay[1]] })} style={{ width: "100%" }} />
          <input type="range" min={200000} max={320000} step={5000} value={f.pay[1]} aria-label="Maximum salary"
            onChange={(e) => set.patch({ pay: [f.pay[0], Math.max(+e.target.value, f.pay[0] + 5000)] })} style={{ width: "100%", marginTop: 4 }} />
          <div style={{ fontSize: 11, color: C.faint, marginTop: 6, lineHeight: 1.4 }}>Applies to the {counts.withPay} listings with a stated annual salary.</div>
        </div>
      </FilterGroup>

      <div>
        <Label style={{ marginBottom: 11 }}>Date posted</Label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {RECENCY.map((r) => (
            <button key={r.k} onClick={() => set.patch({ recency: r.k })} className="wf-focus"
              style={{ display: "flex", alignItems: "center", gap: 9, background: f.recency === r.k ? C.tealSoft : "transparent", border: "none", cursor: "pointer", padding: "7px 9px", borderRadius: 9, textAlign: "left" }}>
              <span aria-hidden="true" style={{ width: 15, height: 15, borderRadius: 999, border: `1.5px solid ${f.recency === r.k ? C.teal : C.lineStrong}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
                {f.recency === r.k && <span style={{ width: 7, height: 7, borderRadius: 999, background: C.teal }} />}
              </span>
              <span style={{ fontSize: 13.5, color: f.recency === r.k ? C.ink : C.sub, fontWeight: f.recency === r.k ? 600 : 500 }}>{r.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Detail panel ------------------------------ */
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 22 }}>
      <Label style={{ marginBottom: 10 }}>{title}</Label>
      {children}
    </div>
  );
}
function KV({ k, v, bonus }) {
  return (
    <div className="flex items-baseline justify-between" style={{ gap: 14, padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 13, color: C.sub }}>{k}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: bonus ? C.amber : C.ink, textAlign: "right", fontFamily: bonus ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit" }}>{v}</span>
    </div>
  );
}
function QuickFact({ label, value, tone }) {
  return (
    <div style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 11, padding: "9px 11px", minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: ".07em", textTransform: "uppercase", color: C.faint, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: tone || C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}
function DetailPanel({ job, saved, onSave, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [onClose]);
  const pay = payFmt(job);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50 }} role="dialog" aria-modal="true" aria-label={`${job.role} details`}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(9,26,22,.42)", backdropFilter: "blur(2px)" }} />
      <div className="slideover wf-scroll" style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "min(500px, 100%)", background: C.panel, boxShadow: "-24px 0 60px -30px rgba(0,0,0,.4)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ position: "sticky", top: 0, background: C.panel, borderBottom: `1px solid ${C.line}`, padding: "16px 20px", zIndex: 2 }}>
          <div className="flex items-start justify-between" style={{ gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="flex items-center flex-wrap" style={{ gap: 6, marginBottom: 8 }}>
                <EmployerBadge job={job} />
                {job.immediate && <Pill tone="amber" icon={Zap}>Immediate start</Pill>}
                {!job.immediate && job.urgent && <Pill tone="amber" icon={Zap}>Actively recruiting</Pill>}
              </div>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.25, letterSpacing: "-.01em" }}>{job.role}</h2>
              <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>{job.employer}</div>
            </div>
            <button aria-label="Close" onClick={onClose} className="btns wf-focus" style={{ borderRadius: 10, padding: 7, cursor: "pointer", flex: "0 0 auto" }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: "18px 20px 8px" }}>
          {/* quick facts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <QuickFact label="Pay" value={pay ? `${pay}/yr` : (job.bonus || "Not specified")} tone={pay ? C.teal : (job.bonus ? C.amber : C.ink)} />
            <QuickFact label="Position" value={job.position} />
            <QuickFact label="Location" value={`${job.city ? job.city + ", " : ""}${job.state}`} />
            <QuickFact label="Posted" value={dateFmt(job.posted)} />
          </div>

          {/* comp highlight */}
          {(pay || job.comp.length > 0 || job.bonus) && (
            <div style={{ marginTop: 16, background: `linear-gradient(180deg, ${C.tealSoft}, #EEF6F3)`, border: "1px solid #CDE4DD", borderRadius: 14, padding: 16 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: pay ? 8 : 0 }}>
                <Sparkles size={15} color={C.teal} strokeWidth={2.3} />
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: C.teal }}>Compensation</span>
              </div>
              {pay && <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 26, fontWeight: 800, color: C.tealDeep, letterSpacing: "-.02em" }}>{pay}<span style={{ fontSize: 13, color: C.sub, fontWeight: 600, marginLeft: 6 }}>per year</span></div>}
              {job.bonus && <div style={{ marginTop: pay ? 6 : 0, fontSize: 14, fontWeight: 700, color: C.amber, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{job.bonus}</div>}
            </div>
          )}

          <p style={{ marginTop: 16, fontSize: 14, color: "#2E3F3B", lineHeight: 1.6 }}>{job.summary}</p>

          {job.comp.length > 0 && (
            <Section title="Compensation detail">
              <div>{job.comp.map((c, i) => <KV key={i} k={c.k} v={c.v} bonus={isBonusKey(c.k)} />)}</div>
            </Section>
          )}

          {job.x.firstYear.parts.length > 0 && (
            <Section title="Estimated first-year value">
              <div>
                {job.x.firstYear.parts.map((p, i) => <KV key={i} k={p.label} v={kFmt(p.amount)} bonus={!/^(Base salary|Total package)/.test(p.label)} />)}
                {job.x.firstYear.min != null && (
                  <div className="flex items-baseline justify-between" style={{ gap: 14, padding: "9px 0" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Est. year-one cash total</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: C.tealDeep, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{kFmt(job.x.firstYear.min)}{job.x.base.max != null ? "+" : ""}</span>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, margin: "6px 0 0" }}>
                {job.x.firstYear.note ? job.x.firstYear.note + " " : ""}Totals use only amounts stated in the listing — benefits, overtime, and productivity pay excluded. Confirm on the original posting.
              </p>
            </Section>
          )}

          {(() => {
            const mp = marketPos(job);
            if (!mp) return null;
            const posPct = Math.max(0, Math.min(100, ((mp.base - MARKET.min) / (MARKET.max - MARKET.min)) * 100));
            return (
              <Section title="Market position">
                <div style={{ background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px" }}>
                  <div style={{ position: "relative", height: 6, borderRadius: 999, background: `linear-gradient(90deg, ${C.line}, ${C.teal})`, margin: "6px 2px 8px" }}>
                    <span aria-hidden="true" style={{ position: "absolute", left: `${posPct}%`, top: "50%", transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: 999, background: C.tealDeep, border: "2.5px solid #fff", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }} />
                  </div>
                  <div className="flex items-center justify-between" style={{ fontSize: 11, color: C.faint, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom: 8 }}>
                    <span>{kFmt(MARKET.min)}</span><span>median {kFmt(MARKET.median)}</span><span>{kFmt(MARKET.max)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
                    This base ({kFmt(mp.base)}) is higher than <strong style={{ color: C.ink }}>{mp.pct}%</strong> of the {MARKET.n} current CAA listings with stated pay.
                  </div>
                </div>
              </Section>
            );
          })()}

          <Section title="Position details">
            <div>
              <KV k="Position type" v={job.position} />
              <KV k="Employment" v={job.x.employmentOptions ? job.x.employmentOptions.join(" or ") : (job.w2 || "Not specified")} />
              <KV k="Call" v={job.x.schedule.noCall ? "None" : "Not specified"} />
              <KV k="Weekends" v={job.x.schedule.weekendOnly ? "Weekend-only role" : job.x.schedule.noWeekends ? "None" : "Not specified"} />
              {job.x.schedule.shifts.length > 0 && <KV k="Shift lengths" v={job.x.schedule.shifts.join(" / ")} />}
              {job.x.schedule.fte && <KV k="FTE" v={`${job.x.schedule.fte.min}–${job.x.schedule.fte.max}`} />}
              {job.x.schedule.guaranteedHours && <KV k="Hours" v="Guaranteed" />}
              {(job.x.timeOff.weeksMin != null || job.x.timeOff.weeksMax != null) && (
                <KV k="Time off" v={job.x.timeOff.weeksMin != null && job.x.timeOff.weeksMax != null ? `${job.x.timeOff.weeksMin}–${job.x.timeOff.weeksMax} weeks` : job.x.timeOff.weeksMin != null ? `${job.x.timeOff.weeksMin}+ weeks` : `Up to ${job.x.timeOff.weeksMax} weeks`} />
              )}
              <KV k="New grads" v={job.x.newGrad ? "Welcome" : "Not specified"} />
              <KV k="Relocation" v={job.x.relocation ? "Support offered" : "Not specified"} />
              {job.tags.length > 0 && (
                <div style={{ padding: "10px 0 2px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {job.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}
                </div>
              )}
            </div>
          </Section>

          <Section title="Employer">
            <div>
              <KV k="Name" v={job.employer} />
              <KV k="Listing source" v={job.kind} />
              <KV k="Type" v={job.etype === "Direct" ? "Direct employer" : "Agency / third-party"} />
            </div>
          </Section>

          <Section title="Location">
            <div>
              <KV k="City" v={job.city || "Not specified"} />
              <KV k="State" v={job.state} />
            </div>
            <div className="flex items-start gap-2" style={{ marginTop: 10, background: C.panelAlt, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px" }}>
              <Info size={14} color={C.teal} strokeWidth={2.2} style={{ marginTop: 1, flex: "0 0 auto" }} />
              <span style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{job.state} is a state where CAAs are licensed to practice.</span>
            </div>
          </Section>

          <Section title="Listing activity">
            <div>
              <KV k="Posted" v={`${dateFmt(job.posted)}${job.x.daysPosted != null ? ` · ${job.x.daysPosted}d before snapshot` : ""}`} />
              <KV k="Last updated" v={`${dateFmt(job.updated)}${job.x.daysUpdated != null ? ` · ${job.x.daysUpdated}d before snapshot` : ""}`} />
            </div>
            {job.x.longRunning && (
              <div className="flex items-start gap-2" style={{ marginTop: 10, background: C.amberSoft, border: "1px solid #E9DCB8", borderRadius: 10, padding: "9px 11px" }}>
                <Info size={14} color={C.amber} strokeWidth={2.2} style={{ marginTop: 1, flex: "0 0 auto" }} />
                <span style={{ fontSize: 12, color: C.amber, lineHeight: 1.5 }}>Open for {Math.round(job.x.daysPosted / 30)}+ months and still being renewed — could be an ongoing hiring need, or worth asking why it hasn't filled.</span>
              </div>
            )}
          </Section>

          <div style={{ marginTop: 18, fontSize: 11.5, color: C.faint, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            Ref #{job.ref} · Snapshot {SCRAPE_LABEL}
          </div>
        </div>

        {/* sticky actions */}
        <div style={{ position: "sticky", bottom: 0, background: C.panel, borderTop: `1px solid ${C.line}`, padding: "12px 20px", display: "flex", gap: 10, marginTop: "auto" }}>
          <a href={postUrl(job.ref)} target="_blank" rel="noopener noreferrer" className="btnp wf-focus"
            style={{ flex: 1, textDecoration: "none", borderRadius: 11, padding: "11px 14px", fontWeight: 700, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            View original posting <ExternalLink size={15} strokeWidth={2.3} />
          </a>
          <button onClick={() => onSave(job.ref)} className="btns wf-focus" style={{ borderRadius: 11, padding: "11px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, color: saved ? C.teal : C.ink }}>
            {saved ? <BookmarkCheck size={16} strokeWidth={2.3} /> : <Bookmark size={16} strokeWidth={2.2} />}{saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Compare modal ------------------------------ */
function CompareModal({ jobs, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const rows = [
    ["Salary", (j) => payFmt(j) ? `${payFmt(j)}/yr` : "—"],
    ["Bonus / incentive", (j) => j.bonus || "—"],
    ["Est. 1st-year value", (j) => j.x.firstYear.min != null ? kFmt(j.x.firstYear.min) : "—"],
    ["Call", (j) => j.x.schedule.noCall ? "None" : "Not specified"],
    ["Weekends", (j) => j.x.schedule.weekendOnly ? "Weekend-only" : j.x.schedule.noWeekends ? "None" : "Not specified"],
    ["Time off", (j) => j.x.timeOff.label || "—"],
    ["New grads", (j) => j.x.newGrad ? "Welcome" : "—"],
    ["Position", (j) => j.position],
    ["Employment", (j) => j.w2 || "—"],
    ["Employer", (j) => j.employer],
    ["Source", (j) => j.etype === "Direct" ? "Direct" : "Agency"],
    ["Location", (j) => `${j.city ? j.city + ", " : ""}${j.state}`],
    ["Posted", (j) => dateFmt(j.posted)],
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }} role="dialog" aria-modal="true" aria-label="Compare positions">
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(9,26,22,.5)", backdropFilter: "blur(2px)" }} />
      <div className="fadein wf-scroll" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(760px, 94vw)", maxHeight: "88vh", overflow: "auto", background: C.panel, borderRadius: 18, boxShadow: "0 40px 80px -30px rgba(0,0,0,.5)" }}>
        <div style={{ position: "sticky", top: 0, background: C.panel, borderBottom: `1px solid ${C.line}`, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 800, fontSize: 16, color: C.ink }}><Layers size={17} color={C.teal} strokeWidth={2.3} /> Compare positions</div>
          <button aria-label="Close" onClick={onClose} className="btns wf-focus" style={{ borderRadius: 10, padding: 7, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ padding: 8, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: C.faint, fontWeight: 700, width: 150 }}>Attribute</th>
                {jobs.map((j) => (
                  <th key={j.ref} style={{ textAlign: "left", padding: "10px 12px", verticalAlign: "top", borderLeft: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, lineHeight: 1.3 }}>{j.role}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn], ri) => (
                <tr key={label} style={{ background: ri % 2 ? C.panelAlt : "transparent" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12.5, color: C.sub, fontWeight: 600 }}>{label}</td>
                  {jobs.map((j) => {
                    const val = fn(j);
                    const isPay = label === "Salary" && val !== "—";
                    const isBonus = label === "Bonus / incentive" && val !== "—";
                    return <td key={j.ref} style={{ padding: "10px 12px", fontSize: 13, fontWeight: isPay || isBonus ? 700 : 500, color: isPay ? C.teal : isBonus ? C.amber : C.ink, borderLeft: `1px solid ${C.line}`, fontFamily: isPay || isBonus ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit" }}>{val}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Chips ---------------------------------- */
function ActiveChips({ f, set, onClear }) {
  const chips = [];
  f.states.forEach((s) => chips.push({ k: "state:" + s, label: s, fn: () => set.toggleSet("states", s) }));
  f.positions.forEach((p) => chips.push({ k: "pos:" + p, label: p, fn: () => set.toggleSet("positions", p) }));
  f.etypes.forEach((e) => chips.push({ k: "et:" + e, label: e === "Direct" ? "Direct employer" : "Agency", fn: () => set.toggleSet("etypes", e) }));
  f.flags.forEach((k) => chips.push({ k: "flag:" + k, label: flagLabel(k), fn: () => set.toggleSet("flags", k) }));
  if (f.hasSalary) chips.push({ k: "sal", label: "Has salary", fn: () => set.patch({ hasSalary: false }) });
  if (f.pay[0] !== 200000 || f.pay[1] !== 320000) chips.push({ k: "pay", label: `${kFmt(f.pay[0])}–${kFmt(f.pay[1])}`, fn: () => set.patch({ pay: [200000, 320000] }) });
  if (f.recency !== "any") chips.push({ k: "rec", label: "Last " + f.recency + " days", fn: () => set.patch({ recency: "any" }) });
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap" style={{ gap: 7 }}>
      {chips.map((c) => (
        <button key={c.k} onClick={c.fn} className="chipx wf-focus" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.panel, border: `1px solid ${C.lineStrong}`, borderRadius: 999, padding: "4px 6px 4px 11px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" }}>
          {c.label}<span style={{ display: "inline-flex" }}><X size={13} color={C.faint} /></span>
        </button>
      ))}
      <button onClick={onClear} className="btng wf-focus" style={{ border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "5px 9px", borderRadius: 8 }}>Clear all</button>
    </div>
  );
}

/* ------------------------------- Saved view -------------------------------- */
function SavedView({ jobs, savedIds, onSave, onOpen, compareIds, toggleCompare, onCompare, onBrowse }) {
  if (jobs.length === 0) {
    return (
      <div className="fadein" style={{ textAlign: "center", padding: "70px 20px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, marginTop: 24 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: C.tealSoft, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}><Bookmark size={24} color={C.teal} /></div>
        <h3 style={{ fontSize: 18, fontWeight: 800, color: C.ink, margin: 0 }}>No saved positions yet</h3>
        <p style={{ fontSize: 14, color: C.sub, margin: "8px auto 20px", maxWidth: 360, lineHeight: 1.55 }}>Tap the bookmark on any listing to keep it here, then line up two or three to compare side by side.</p>
        <button onClick={onBrowse} className="btnp wf-focus" style={{ border: "none", cursor: "pointer", borderRadius: 11, padding: "10px 18px", fontWeight: 700, fontSize: 14 }}>Browse positions</button>
      </div>
    );
  }
  const canCompare = compareIds.size >= 2 && compareIds.size <= 3;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="flex items-center justify-between flex-wrap" style={{ gap: 12, marginBottom: 6 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.ink, margin: 0 }}>Saved positions</h2>
          <p style={{ fontSize: 13.5, color: C.sub, margin: "3px 0 0" }}>Select 2–3 to compare pay, location, and terms side by side.</p>
        </div>
      </div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: 16 }}>
        {jobs.map((job) => {
          const inC = compareIds.has(job.ref);
          const disabled = !inC && compareIds.size >= 3;
          return (
            <div key={job.ref} style={{ position: "relative" }}>
              <button onClick={() => !disabled && toggleCompare(job.ref)} className="wf-focus" aria-pressed={inC}
                style={{ position: "absolute", top: 12, left: 12, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 6, background: inC ? C.teal : "rgba(255,255,255,.94)", color: inC ? "#fff" : (disabled ? C.faint : C.sub), border: `1px solid ${inC ? C.teal : C.lineStrong}`, borderRadius: 999, padding: "3px 9px 3px 6px", fontSize: 11.5, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer" }}>
                <Checkbox on={inC} />{inC ? "Comparing" : "Compare"}
              </button>
              <JobCard job={job} saved={savedIds.has(job.ref)} onSave={onSave} onOpen={onOpen} />
            </div>
          );
        })}
      </div>
      {compareIds.size > 0 && (
        <div className="fadein" style={{ position: "sticky", bottom: 16, marginTop: 20, display: "flex", justifyContent: "center", zIndex: 20 }}>
          <div className="flex items-center gap-3" style={{ background: C.ink, color: "#fff", borderRadius: 999, padding: "8px 8px 8px 18px", boxShadow: "0 16px 30px -12px rgba(0,0,0,.5)" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{compareIds.size} selected{compareIds.size < 2 ? " · pick 1 more" : compareIds.size === 3 ? " · max" : ""}</span>
            <button disabled={!canCompare} onClick={onCompare} className="wf-focus" style={{ border: "none", cursor: canCompare ? "pointer" : "not-allowed", background: canCompare ? C.mint : "#3A4C48", color: canCompare ? C.tealDeep : "#8AA29C", borderRadius: 999, padding: "8px 16px", fontWeight: 800, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Layers size={15} strokeWidth={2.4} /> Compare
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- App ------------------------------------ */
export default function App() {
  const [query, setQuery] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("q") || ""; } catch { return ""; }
  });
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState("browse");
  const [savedIds, setSavedIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("wf-saved") || "[]");
      return new Set(stored.filter((ref) => JOBS.some((j) => j.ref === ref)));
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem("wf-saved", JSON.stringify([...savedIds])); } catch { /* private mode */ }
  }, [savedIds]);
  const [compareIds, setCompareIds] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [f, setF] = useState(() => {
    // Filters are shareable: read initial state from the URL query string.
    const base = { states: new Set(), positions: new Set(), etypes: new Set(), flags: new Set(), hasSalary: false, pay: [200000, 320000], recency: "any" };
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("states")) base.states = new Set(p.get("states").split(",").filter(Boolean));
      if (p.get("flags")) base.flags = new Set(p.get("flags").split(",").filter((k) => FLAG_DEFS.some((d) => d.k === k)));
    } catch { /* SSR / test env */ }
    return base;
  });
  useEffect(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (f.states.size) p.set("states", [...f.states].join(","));
    if (f.flags.size) p.set("flags", [...f.flags].join(","));
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [query, f.states, f.flags]);

  const set = useMemo(() => ({
    patch: (p) => setF((prev) => ({ ...prev, ...p })),
    toggleSet: (key, val) => setF((prev) => { const n = new Set(prev[key]); n.has(val) ? n.delete(val) : n.add(val); return { ...prev, [key]: n }; }),
  }), []);

  const clearAll = () => setF({ states: new Set(), positions: new Set(), etypes: new Set(), flags: new Set(), hasSalary: false, pay: [200000, 320000], recency: "any" });
  const activeCount = f.states.size + f.positions.size + f.etypes.size + f.flags.size + (f.hasSalary ? 1 : 0) + (f.pay[0] !== 200000 || f.pay[1] !== 320000 ? 1 : 0) + (f.recency !== "any" ? 1 : 0);

  const stats = useMemo(() => {
    const withPay = JOBS.filter((j) => j.payMin != null || j.payMax != null);
    const mins = JOBS.filter((j) => j.payMin != null).map((j) => j.payMin);
    const maxs = JOBS.filter((j) => j.payMax != null).map((j) => j.payMax);
    const lo = Math.min(...mins), hi = Math.max(...maxs, ...mins);
    return {
      total: JOBS.length, states: new Set(JOBS.map((j) => j.state)).size, withPay: withPay.length,
      range: `${kFmt(lo)}–${kFmt(hi)}`,
      median: META.medianBase != null ? kFmt(META.medianBase) : "—",
      signOn: META.withSignOn,
    };
  }, []);

  const counts = useMemo(() => {
    const state = {}, position = {}, etype = {}, flags = {};
    JOBS.forEach((j) => { state[j.state] = (state[j.state] || 0) + 1; position[j.position] = (position[j.position] || 0) + 1; etype[j.etype] = (etype[j.etype] || 0) + 1; });
    FLAG_DEFS.forEach((d) => { flags[d.k] = JOBS.filter(d.test).length; });
    return { state, position, etype, flags, withPay: JOBS.filter((j) => j.payMin != null || j.payMax != null).length };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = JOBS.filter((j) => {
      if (q && !(`${j.role} ${j.employer} ${j.city || ""} ${j.state} ${j.summary}`.toLowerCase().includes(q))) return false;
      if (f.states.size && !f.states.has(j.state)) return false;
      if (f.positions.size && !f.positions.has(j.position)) return false;
      if (f.etypes.size && !f.etypes.has(j.etype)) return false;
      const hasPay = j.payMin != null || j.payMax != null;
      if (f.hasSalary && !hasPay) return false;
      if (hasPay) { const lo = j.payMin ?? j.payMax, hi = j.payMax ?? j.payMin; if (hi < f.pay[0] || lo > f.pay[1]) return false; }
      if (f.recency !== "any" && daysBetween(j.posted, SCRAPE_ISO) > +f.recency) return false;
      if (f.flags.size && !passesFlags(j, f.flags)) return false;
      return true;
    });
    const payVal = (j) => j.payMax ?? j.payMin ?? j.x.package?.max ?? j.x.package?.min ?? -1;
    out.sort((a, b) => {
      if (sort === "newest") return b.posted.localeCompare(a.posted);
      if (sort === "pay") return payVal(b) - payVal(a);
      if (sort === "bonus") return (b.x.signOn.amount ?? -1) - (a.x.signOn.amount ?? -1);
      if (sort === "value") return (b.x.firstYear.min ?? payVal(b)) - (a.x.firstYear.min ?? payVal(a));
      if (sort === "state") return a.state.localeCompare(b.state) || (a.city || "").localeCompare(b.city || "");
      return 0;
    });
    return out;
  }, [query, f, sort]);

  const toggleSave = (ref) => setSavedIds((prev) => { const n = new Set(prev); if (n.has(ref)) { n.delete(ref); setCompareIds((c) => { const cc = new Set(c); cc.delete(ref); return cc; }); } else n.add(ref); return n; });
  const toggleCompare = (ref) => setCompareIds((prev) => { const n = new Set(prev); n.has(ref) ? n.delete(ref) : (n.size < 3 && n.add(ref)); return n; });

  const savedJobs = JOBS.filter((j) => savedIds.has(j.ref));
  const compareJobs = JOBS.filter((j) => compareIds.has(j.ref));

  const sortSelect = (
    <div style={{ position: "relative" }}>
      <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort listings"
        style={{ appearance: "none", WebkitAppearance: "none", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 32px 8px 12px", fontSize: 13, fontWeight: 600, color: C.ink, cursor: "pointer" }}>
        <option value="newest">Newest</option>
        <option value="pay">Highest pay</option>
        <option value="value">Est. first-year value</option>
        <option value="bonus">Biggest sign-on bonus</option>
        <option value="state">State A–Z</option>
      </select>
      <ChevronDown size={15} color={C.faint} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
    </div>
  );

  return (
    <div className="wf wf-scroll" style={{ background: C.bg, minHeight: "100vh", color: C.ink, fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <style>{STYLE}</style>

      {/* top bar */}
      <header style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(236,241,239,.86)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between" style={{ padding: "11px 16px" }}>
          <button onClick={() => setView("browse")} className="flex items-center gap-2 wf-focus" style={{ background: "transparent", border: "none", cursor: "pointer" }}>
            <HeartPulse size={20} color={C.teal} strokeWidth={2.4} />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.02em", color: C.ink }}>Waveform</span>
            <span style={{ fontSize: 11, color: C.faint, fontWeight: 600, marginTop: 2 }}>CAA jobs</span>
          </button>
          <div className="flex items-center" style={{ gap: 6 }}>
            <button onClick={() => setView("browse")} className="wf-focus" style={{ background: view === "browse" ? C.panel : "transparent", border: `1px solid ${view === "browse" ? C.line : "transparent"}`, borderRadius: 10, padding: "7px 13px", fontSize: 13.5, fontWeight: 700, color: view === "browse" ? C.ink : C.sub, cursor: "pointer" }}>Browse</button>
            <button onClick={() => setView("saved")} className="wf-focus flex items-center gap-1.5" style={{ background: view === "saved" ? C.panel : "transparent", border: `1px solid ${view === "saved" ? C.line : "transparent"}`, borderRadius: 10, padding: "7px 13px", fontSize: 13.5, fontWeight: 700, color: view === "saved" ? C.ink : C.sub, cursor: "pointer" }}>
              <Bookmark size={14} strokeWidth={2.3} />Saved
              {savedIds.size > 0 && <span style={{ background: C.teal, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "0 6px", minWidth: 18, textAlign: "center", fontFamily: "ui-monospace, monospace" }}>{savedIds.size}</span>}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto" style={{ padding: "20px 16px 90px" }}>
        {view === "browse" ? (
          <>
            <Hero stats={stats} />

            {CHANGES.since && CHANGE_COUNT > 0 && (
              <div className="flex items-center gap-1.5" style={{ marginTop: 10, fontSize: 12.5, color: C.sub, fontWeight: 600 }}>
                <Sparkles size={13} color={C.teal} strokeWidth={2.2} />
                Since {CHANGES.since}: {CHANGES.newRefs.length} new · {CHANGES.removedRefs.length} removed · {CHANGES.payChanged.length} pay {CHANGES.payChanged.length === 1 ? "change" : "changes"}
              </div>
            )}

            {/* search */}
            <div style={{ position: "relative", marginTop: 18 }}>
              <Search size={19} color={C.faint} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, employer, or city…" aria-label="Search positions"
                style={{ width: "100%", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 13, padding: "14px 44px 14px 46px", fontSize: 15, color: C.ink, outline: "none", boxShadow: "0 2px 8px -6px rgba(7,58,50,.25)" }} />
              {query && <button aria-label="Clear search" onClick={() => setQuery("")} className="btng wf-focus" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", borderRadius: 8, padding: 6, cursor: "pointer" }}><X size={16} /></button>}
            </div>

            {/* state summary strip */}
            <div className="wf-scroll" style={{ marginTop: 14, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
              <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto", color: C.faint, fontSize: 12, fontWeight: 600, paddingRight: 4 }} title="CAAs can practice only in states that license them">
                <Info size={13} /> CAA states:
              </div>
              {Object.entries(counts.state).sort((a, b) => b[1] - a[1]).map(([s, n]) => {
                const on = f.states.has(s);
                return (
                  <button key={s} onClick={() => set.toggleSet("states", s)} className="statechip wf-focus" style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 7, background: on ? C.teal : C.panel, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.teal : C.line}`, borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    {s}<span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: on ? "rgba(255,255,255,.8)" : C.faint }}>{n}</span>
                  </button>
                );
              })}
            </div>

            {/* controls */}
            <div className="flex items-center justify-between" style={{ gap: 12, marginTop: 20, marginBottom: 14, flexWrap: "wrap" }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setDrawer(true)} className="btns wf-focus flex items-center gap-2 lg:hidden" style={{ borderRadius: 10, padding: "8px 13px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                  <SlidersHorizontal size={15} strokeWidth={2.3} />Filters{activeCount > 0 && <span style={{ background: C.teal, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 800, padding: "0 6px" }}>{activeCount}</span>}
                </button>
                <span style={{ fontSize: 13.5, color: C.sub }}><strong style={{ color: C.ink, fontFamily: "ui-monospace, monospace" }}>{results.length}</strong> {results.length === 1 ? "position" : "positions"}</span>
              </div>
              {sortSelect}
            </div>

            {activeCount > 0 ? (
              <div style={{ marginBottom: 16 }}><ActiveChips f={f} set={set} onClear={clearAll} /></div>
            ) : null}

            {/* two column */}
            <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
              <aside className="hidden lg:block" style={{ width: 268, flex: "0 0 268px", position: "sticky", top: 76 }}>
                <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
                  <FiltersPanel f={f} set={set} counts={counts} onClear={clearAll} activeCount={activeCount} />
                </div>
              </aside>

              <div style={{ flex: 1, minWidth: 0 }}>
                {results.length === 0 ? (
                  <div className="fadein" style={{ textAlign: "center", padding: "60px 20px", background: C.panel, border: `1px dashed ${C.lineStrong}`, borderRadius: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: C.panelAlt, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}><Ban size={22} color={C.faint} /></div>
                    <h3 style={{ fontSize: 17, fontWeight: 800, color: C.ink, margin: 0 }}>No positions match these filters</h3>
                    <p style={{ fontSize: 14, color: C.sub, margin: "8px auto 18px", maxWidth: 340, lineHeight: 1.5 }}>Try widening the salary range, clearing a state, or removing the date filter.</p>
                    <button onClick={clearAll} className="btnp wf-focus" style={{ border: "none", cursor: "pointer", borderRadius: 11, padding: "10px 18px", fontWeight: 700, fontSize: 14 }}>Clear all filters</button>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))" }}>
                    {results.map((job) => <JobCard key={job.ref} job={job} saved={savedIds.has(job.ref)} onSave={toggleSave} onOpen={setSelected} />)}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <SavedView jobs={savedJobs} savedIds={savedIds} onSave={toggleSave} onOpen={setSelected}
            compareIds={compareIds} toggleCompare={toggleCompare} onCompare={() => setShowCompare(true)} onBrowse={() => setView("browse")} />
        )}
      </main>

      {/* footer */}
      <footer style={{ borderTop: `1px solid ${C.line}`, background: C.panel }}>
        <div className="max-w-6xl mx-auto" style={{ padding: "22px 16px 30px" }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <HeartPulse size={16} color={C.teal} strokeWidth={2.3} />
            <span style={{ fontWeight: 800, color: C.ink, letterSpacing: "-.02em" }}>Waveform</span>
          </div>
          <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.6, maxWidth: 640, margin: 0 }}>
            Data retrieved from GasWork.com on {SCRAPE_LABEL}. An unofficial demo that reorganizes {JOBS.length} publicly posted Certified Anesthesiologist Assistant listings for easier searching. Factual fields are kept as posted; descriptions are condensed, and structured fields (pay, bonuses, schedule, time off) are extracted from each listing's own wording — nothing is guessed, and "Not specified" means the posting didn't say. Estimated first-year totals sum only stated cash amounts. Each listing links to its original posting — always confirm current details there.
          </p>
        </div>
      </footer>

      {selected && <DetailPanel job={selected} saved={savedIds.has(selected.ref)} onSave={toggleSave} onClose={() => setSelected(null)} />}
      {showCompare && compareJobs.length >= 2 && <CompareModal jobs={compareJobs} onClose={() => setShowCompare(false)} />}

      {/* mobile filter drawer */}
      {drawer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50 }} className="lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div onClick={() => setDrawer(false)} style={{ position: "absolute", inset: 0, background: "rgba(9,26,22,.42)" }} />
          <div className="slideover wf-scroll" style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "min(340px, 88%)", background: C.panel, overflowY: "auto", padding: 20 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <button onClick={() => setDrawer(false)} className="btng wf-focus flex items-center gap-1.5" style={{ border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, padding: "6px 8px", borderRadius: 8 }}><ArrowLeft size={16} /> Done</button>
            </div>
            <FiltersPanel f={f} set={set} counts={counts} onClear={clearAll} activeCount={activeCount} />
          </div>
        </div>
      )}
    </div>
  );
}
