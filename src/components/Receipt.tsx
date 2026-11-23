"use client";

import type { ReactNode } from "react";
import type { Bill } from "@/lib/schema";
import type { Finding, Verdict } from "@/lib/verify";

type Target = NonNullable<Finding["target"]>["kind"];

/**
 * The clean digital receipt: the bill as BillSahi read it, with flagged lines
 * highlighted and a margin note showing the right number. In edit mode every
 * number becomes an input, and the parent re-runs the checks on each change.
 */
export function Receipt({
  bill,
  verdict,
  editing,
  onChange,
}: {
  bill: Bill;
  verdict: Verdict;
  editing: boolean;
  onChange: (b: Bill) => void;
}) {
  const flagged = verdict.findings.filter((f) => f.severity !== "info");
  const flagsFor = (kind: Target, index?: number) =>
    flagged.filter((f) => f.target?.kind === kind && (index === undefined || f.target.index === index));

  const hasMrp = bill.items.some((i) => i.mrp != null);
  const cols = hasMrp
    ? "grid-cols-[minmax(0,1fr)_3.5ch_7.5ch_7.5ch_8.5ch]"
    : "grid-cols-[minmax(0,1fr)_3.5ch_8ch_9ch]";

  const setTop = <K extends keyof Bill>(key: K, value: Bill[K]) => onChange({ ...bill, [key]: value });
  const setItem = (i: number, key: "quantity" | "unitPrice" | "mrp" | "amount", v: number | null) =>
    onChange({ ...bill, items: bill.items.map((it, j) => (j === i ? { ...it, [key]: v } : it)) });
  const setCharge = (i: number, v: number | null) =>
    onChange({ ...bill, charges: bill.charges.map((c, j) => (j === i ? { ...c, amount: v } : c)) });
  const setDiscount = (i: number, v: number | null) =>
    onChange({ ...bill, discounts: bill.discounts.map((d, j) => (j === i ? { ...d, amount: v } : d)) });
  const setTax = (i: number, v: number | null) =>
    onChange({ ...bill, taxes: bill.taxes.map((t, j) => (j === i ? { ...t, amount: v } : t)) });

  const gstinFlag = flagsFor("gstin")[0];

  return (
    <div className="paper-wrap">
      <article className="paper font-mono text-[13.5px] leading-[1.55]" aria-label="Digital receipt">
        <header className="text-center">
          <p className="font-sans text-[20px] font-bold leading-tight">{bill.merchantName ?? "Unknown shop"}</p>
          {bill.merchantAddress && <p className="mt-1 text-ink-soft">{bill.merchantAddress}</p>}
          {bill.gstin && (
            <p className={`mt-1 inline-block px-1 ${gstinFlag ? "marked" : ""}`}>
              GSTIN {verdict.gstin?.normalized ?? bill.gstin}
              {verdict.gstin?.valid && <span className="text-sahi"> ✓</span>}
            </p>
          )}
          {gstinFlag?.note && <Note>{gstinFlag.note}</Note>}
          {verdict.gstin?.valid && verdict.gstin.state && (
            <p className="text-[12px] text-ink-faint">Registered in {verdict.gstin.state}</p>
          )}
        </header>

        <hr className="dashed-rule" />
        <div className="flex justify-between gap-3">
          <span>{bill.billNumber ? `No. ${bill.billNumber}` : ""}</span>
          <span className={flagsFor("date").length ? "marked px-1" : ""}>{bill.billDate ? indianDate(bill.billDate) : ""}</span>
        </div>
        <hr className="dashed-rule" />

        <div className={`grid ${cols} gap-x-2 font-semibold`}>
          <span>Item</span>
          <span className="text-right">Qty</span>
          {hasMrp && <span className="text-right">MRP</span>}
          <span className="text-right">Rate</span>
          <span className="text-right">Amount</span>
        </div>
        <hr className="dashed-rule" />

        {bill.items.length === 0 && <p className="text-ink-faint">No items found.</p>}
        {bill.items.map((it, i) => {
          const flags = flagsFor("item", i);
          return (
            <div key={i} className="py-[1px]">
              <div className={`grid ${cols} items-baseline gap-x-2 ${flags.length ? "marked" : ""}`}>
                <span className="break-words">
                  {it.name || `Line ${i + 1}`}
                  {it.confidence === "low" && <span className="font-sans text-dekho"> (unsure)</span>}
                </span>
                <Num editing={editing} value={it.quantity} onChange={(v) => setItem(i, "quantity", v)} label={`${it.name} quantity`} plain />
                {hasMrp && <Num editing={editing} value={it.mrp} onChange={(v) => setItem(i, "mrp", v)} label={`${it.name} MRP`} />}
                <Num editing={editing} value={it.unitPrice} onChange={(v) => setItem(i, "unitPrice", v)} label={`${it.name} rate`} />
                <Num editing={editing} value={it.amount} onChange={(v) => setItem(i, "amount", v)} label={`${it.name} amount`} />
              </div>
              {flags.map((f) => f.note && <Note key={f.id}>{f.note}</Note>)}
            </div>
          );
        })}

        <hr className="dashed-rule" />

        {bill.subtotal != null || editing ? (
          <Line label="Subtotal" flags={flagsFor("subtotal")}>
            <Num editing={editing} value={bill.subtotal} onChange={(v) => setTop("subtotal", v)} label="Subtotal" />
          </Line>
        ) : null}
        {bill.charges.map((c, i) => (
          <Line key={`c${i}`} label={c.label || "Charge"} flags={flagsFor("charge", i)}>
            <Num editing={editing} value={c.amount} onChange={(v) => setCharge(i, v)} label={c.label} />
          </Line>
        ))}
        {bill.discounts.map((d, i) => (
          <Line key={`d${i}`} label={d.label || "Discount"} flags={[]}>
            <Num editing={editing} value={d.amount} onChange={(v) => setDiscount(i, v)} label={d.label} prefix="−" />
          </Line>
        ))}
        {bill.taxes.map((t, i) => (
          <Line
            key={`t${i}`}
            label={`${t.label || t.kind}${verdict.computed.taxMode === "inclusive" ? " (incl.)" : ""}`}
            flags={flagsFor("tax", i)}
          >
            <Num editing={editing} value={t.amount} onChange={(v) => setTax(i, v)} label={t.label} />
          </Line>
        ))}
        {(bill.roundOff != null || editing) && (
          <Line label="Round off" flags={flagsFor("roundoff")}>
            <Num editing={editing} value={bill.roundOff} onChange={(v) => setTop("roundOff", v)} label="Round off" signed />
          </Line>
        )}

        <div className="my-2 border-t-[3px] border-double border-ink/60" />
        <Line label="Total" flags={flagsFor("total")} strong>
          <Num editing={editing} value={bill.grandTotal} onChange={(v) => setTop("grandTotal", v)} label="Grand total" />
        </Line>
        <div className="mt-2 border-t-[3px] border-double border-ink/60" />

        <p className="mt-4 text-center font-sans text-[13px] text-ink-faint">
          Checked by BillSahi on {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </article>
    </div>
  );
}

function Line({ label, flags, strong, children }: { label: string; flags: Finding[]; strong?: boolean; children: ReactNode }) {
  return (
    <div className="py-[1px]">
      <div className={`flex items-baseline justify-between gap-3 ${strong ? "text-[16px] font-semibold" : ""} ${flags.length ? "marked" : ""}`}>
        <span>{label}</span>
        <span className="w-[10ch] text-right">{children}</span>
      </div>
      {flags.map((f) => f.note && <Note key={f.id}>{f.note}</Note>)}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="font-sans text-[14px] font-semibold leading-tight text-gadbad">↳ {children}</p>;
}

function Num({
  value,
  onChange,
  editing,
  label,
  plain,
  signed,
  prefix,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  editing: boolean;
  label: string;
  plain?: boolean;
  signed?: boolean;
  prefix?: string;
}) {
  if (editing) {
    return (
      <input
        type="number"
        inputMode="decimal"
        step="any"
        aria-label={label}
        defaultValue={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          const n = raw === "" ? null : Number(raw);
          onChange(n == null || Number.isFinite(n) ? n : null);
        }}
        className="w-full rounded-[3px] bg-marker/35 px-1 text-right font-mono text-ink outline-none ring-1 ring-ink/20 focus:ring-2 focus:ring-ink"
      />
    );
  }
  if (value == null) return <span className="block text-right text-ink-faint">–</span>;
  const text = plain
    ? Number.isInteger(value)
      ? String(value)
      : String(Math.round(value * 1000) / 1000)
    : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}`;
  return (
    <span className="block text-right tabular-nums">
      {prefix}
      {text}
    </span>
  );
}

function indianDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
