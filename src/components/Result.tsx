"use client";

import { useMemo, useRef, useState } from "react";
import type { Bill } from "@/lib/schema";
import { shareText, whatsappLink } from "@/lib/share";
import { rupees, verifyBill, type Finding, type Verdict } from "@/lib/verify";
import { Receipt } from "./Receipt";

export type Meta = { source: "ai" | "saved"; model?: string; ms?: number; shape?: string; note?: string };

const STAMPS: Record<Verdict["status"], { hi: string; en: string; cls: string }> = {
  sahi: { hi: "सही है", en: "all correct", cls: "" },
  check: { hi: "ज़रा देखो", en: "take a look", cls: "stamp--check" },
  gadbad: { hi: "गड़बड़", en: "overcharged", cls: "stamp--gadbad" },
  unreadable: { hi: "पढ़ नहीं पाए", en: "couldn't read", cls: "stamp--unreadable" },
};

export function Result({
  bill,
  original,
  meta,
  preview,
  onChange,
  onReset,
}: {
  bill: Bill;
  original: Bill;
  meta: Meta;
  preview: string | null;
  onChange: (b: Bill) => void;
  onReset: () => void;
}) {
  const verdict = useMemo(() => verifyBill(bill), [bill]);
  const edited = useMemo(() => JSON.stringify(bill) !== JSON.stringify(original), [bill, original]);
  const [editing, setEditing] = useState(false);
  const [receiptKey, setReceiptKey] = useState(0);

  const applicable = verdict.checks.filter((c) => c.status !== "skip");
  const passed = applicable.filter((c) => c.status === "pass").length;
  const stamp = STAMPS[verdict.status];
  const flagged = verdict.findings.filter((f) => f.severity !== "info");
  const notes = verdict.findings.filter((f) => f.severity === "info");

  const headline =
    verdict.status === "gadbad"
      ? `${rupees(verdict.moneyAtStake)} extra on this bill`
      : verdict.status === "check"
        ? verdict.moneyAtStake > 0
          ? `${rupees(verdict.moneyAtStake)} you may not owe`
          : "A few things to look at"
        : verdict.status === "sahi"
          ? "Every number adds up"
          : bill.isBill
            ? "Couldn't find the amounts"
            : "This doesn't look like a bill";

  const sub =
    verdict.status === "unreadable"
      ? (bill.notBillReason ?? "Try a straighter, closer photo in good light, with the whole bill in frame.")
      : `${bill.merchantName ?? "This bill"}${bill.billDate ? `, ${prettyDate(bill.billDate)}` : ""}. ${passed} of ${applicable.length} checks passed.`;

  return (
    <section>
      {meta.source === "saved" && (
        <p className="no-print mb-5 rounded-lg bg-carbon-deep px-4 py-3 text-[14.5px] leading-snug text-white/80">
          {meta.note
            ? `The AI couldn't be reached (${meta.note.replace(/\.$/, "")}), so this is the saved reading of the sample bill.`
            : "This is the saved reading of the sample bill, without an AI call."}{" "}
          The checks below still ran live in your browser.
        </p>
      )}

      <h1 className="text-[36px] font-extrabold leading-[1.02] tracking-tight">{headline}</h1>
      <p className="mt-2 text-[17px] leading-snug text-white/75">{sub}</p>

      <div className="paper-wrap relative mt-9">
        <div key={`${verdict.status}-${verdict.moneyAtStake}`} className={`stamp ${stamp.cls} absolute -top-7 right-4 z-10`}>
          <span lang="hi" className="text-[36px] font-extrabold leading-[1.15]">
            {stamp.hi}
          </span>
          <span className="pb-1 text-[14px] font-bold">{stamp.en}</span>
        </div>
        <div className="paper pt-[80px]">
          {flagged.length === 0 && verdict.status === "sahi" && (
            <p className="text-[17px] leading-snug">
              Nothing to fix. Every line, charge, tax and the total check out.
            </p>
          )}
          {flagged.length === 0 && verdict.status === "unreadable" && (
            <p className="text-[17px] leading-snug">No amounts to check on this one.</p>
          )}
          {flagged.length > 0 && (
            <ul className="pr-1">
              {flagged.map((f, i) => (
                <FindingRow key={f.id} f={f} first={i === 0} />
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <>
              <p className="mt-5 text-[14px] font-semibold text-ink-soft">Good to know</p>
              <ul>
                {notes.map((f, i) => (
                  <FindingRow key={f.id} f={f} first={i === 0} />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {verdict.status !== "unreadable" && <Explain bill={bill} />}

      <div className="no-print mt-8 grid grid-cols-2 gap-3">
        <a
          href={whatsappLink(shareText(bill, verdict, typeof window !== "undefined" ? window.location.origin : ""))}
          target="_blank"
          rel="noreferrer"
          className="btn-paper justify-center"
        >
          Share on WhatsApp
        </a>
        <button onClick={() => window.print()} className="btn-ghost justify-center">
          Save as PDF
        </button>
        <button onClick={onReset} className="btn-ghost col-span-2 justify-center">
          Check another bill
        </button>
      </div>

      <div className="mt-12 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-bold leading-tight">Your bill, as BillSahi read it</h2>
        <div className="no-print flex shrink-0 gap-2">
          {edited && (
            <button
              onClick={() => {
                onChange(original);
                setReceiptKey((k) => k + 1);
              }}
              className="text-[15px] text-white/70 underline underline-offset-4 hover:text-white"
            >
              Undo
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className={editing ? "btn-paper px-3 py-1.5 text-[15px]" : "btn-ghost px-3 py-1.5 text-[15px]"}
            aria-pressed={editing}
          >
            {editing ? "Done" : "Fix a number"}
          </button>
        </div>
      </div>
      <p className="no-print mt-1 text-[15px] leading-snug text-white/65">
        {editing
          ? "Tap any number and type what's on the paper bill. The checks re-run as you type."
          : edited
            ? "Includes your corrections. The verdict above uses them."
            : "Misread something? Fix it and the verdict updates instantly."}
      </p>

      <div className="mt-5">
        <Receipt key={receiptKey} bill={bill} verdict={verdict} editing={editing} onChange={onChange} />
      </div>

      {preview && (
        <details className="no-print mt-6 text-white/80">
          <summary className="cursor-pointer text-[15px] underline-offset-4 hover:underline">Compare with your photo</summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="The bill photo you uploaded" className="mt-3 w-full rounded-[4px]" />
        </details>
      )}

      <section className="mt-12">
        <h2 className="text-[22px] font-bold leading-tight">What BillSahi checked</h2>
        <ul className="mt-3 divide-y divide-white/10">
          {verdict.checks.map((c) => (
            <li key={c.key} className="flex items-center gap-3 py-2.5 text-[16px]">
              <span
                aria-hidden="true"
                className={`w-5 text-center font-mono text-[15px] font-semibold ${
                  c.status === "pass" ? "text-[#7be0a8]" : c.status === "flag" ? "text-marker" : "text-white/35"
                }`}
              >
                {c.status === "pass" ? "✓" : c.status === "flag" ? "!" : "–"}
              </span>
              <span className={c.status === "skip" ? "text-white/45" : "text-white/90"}>{c.label}</span>
              <span className="ml-auto text-[14px] text-white/50">
                {c.status === "pass" ? "passed" : c.status === "flag" ? "flagged" : "doesn't apply"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[14px] leading-snug text-white/50">
          {meta.source === "ai" && meta.model
            ? `Read by ${meta.model}${meta.ms ? ` in ${(meta.ms / 1000).toFixed(1)} s` : ""}. Verdict by BillSahi's own arithmetic, not by the AI.`
            : "Verdict by BillSahi's own arithmetic, not by the AI."}
        </p>
      </section>
    </section>
  );
}

function FindingRow({ f, first }: { f: Finding; first: boolean }) {
  const dot = f.severity === "error" ? "bg-gadbad" : f.severity === "warning" ? "bg-dekho" : "bg-ink-faint";
  return (
    <li className={`py-3 ${first ? "" : "border-t-[1.5px] border-dashed border-ink-faint/60"}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={`mt-[9px] h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[17px] font-bold leading-snug">{f.title}</h3>
            {f.impact > 0 && (
              <span className="whitespace-nowrap pt-0.5 font-mono text-[15px] font-semibold text-gadbad">
                {rupees(f.impact)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[15px] leading-snug text-ink-soft">{f.detail}</p>
        </div>
      </div>
    </li>
  );
}

const LANGS = [
  { k: "en", label: "English" },
  { k: "hi", label: "हिंदी" },
  { k: "mr", label: "मराठी" },
] as const;

type Explanation = { summary: string; points: string[]; askMessage: string | null };

function Explain({ bill }: { bill: Bill }) {
  const [lang, setLang] = useState<(typeof LANGS)[number]["k"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Explanation | null>(null);
  const [copied, setCopied] = useState(false);
  const cache = useRef(new Map<string, Explanation>());

  async function pick(k: (typeof LANGS)[number]["k"]) {
    setLang(k);
    setError(null);
    setCopied(false);
    const cacheKey = `${k}:${JSON.stringify(bill)}`;
    const hit = cache.current.get(cacheKey);
    if (hit) return setData(hit);
    setData(null);
    setLoading(true);
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bill, lang: k }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't explain this bill right now.");
      cache.current.set(cacheKey, json);
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="no-print mt-9">
      <h2 className="text-[20px] font-bold leading-tight">Explain it simply</h2>
      <div role="tablist" aria-label="Language" className="mt-3 inline-flex rounded-full bg-carbon-deep p-1">
        {LANGS.map((l) => (
          <button
            key={l.k}
            role="tab"
            aria-selected={lang === l.k}
            onClick={() => pick(l.k)}
            lang={l.k}
            className={`rounded-full px-4 pb-1 pt-1.5 text-[16px] font-semibold transition-colors ${
              lang === l.k ? "bg-paper text-ink" : "text-white/80 hover:text-white"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-4 text-[16px] text-white/70">Writing it out…</p>}
      {error && <p className="mt-4 text-[16px] text-marker">{error}</p>}
      {data && lang && (
        <div lang={lang} className="mt-4 text-[17.5px] leading-relaxed text-white/90">
          <p>{data.summary}</p>
          {data.points.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {data.points.map((p, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden="true" className="text-marker">
                    ›
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
          {data.askMessage && (
            <div className="mt-5 rounded-xl border-2 border-dashed border-marker/70 px-4 py-3">
              <p className="text-[14px] font-semibold text-marker">Say this at the counter</p>
              <p className="mt-1 text-[18px] leading-snug text-white">“{data.askMessage}”</p>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(data.askMessage ?? "").then(() => setCopied(true));
                }}
                className="mt-2 text-[14.5px] text-white/70 underline underline-offset-4 hover:text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function prettyDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
