import type { Bill } from "./schema";
import { checkGstin } from "./gstin";

/**
 * The verdict engine. Pure, deterministic TypeScript.
 *
 * The AI only *reads* the bill. Everything in this file is plain arithmetic,
 * so the same bill always gets the same verdict, and every finding can show
 * its working. It runs on the server and again in the browser whenever the
 * user corrects a number the AI misread.
 */

export type Severity = "error" | "warning" | "info";
export type CheckStatus = "pass" | "flag" | "skip";
export type VerdictStatus = "sahi" | "check" | "gadbad" | "unreadable";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Rupees the customer may have overpaid because of this finding. */
  impact: number;
  /** Short margin note shown next to the flagged line on the receipt. */
  note?: string;
  target?: { kind: "item" | "charge" | "tax" | "total" | "subtotal" | "gstin" | "date" | "roundoff"; index?: number };
}

export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
}

export interface Verdict {
  status: VerdictStatus;
  moneyAtStake: number;
  findings: Finding[];
  checks: Check[];
  computed: {
    itemsTotal: number;
    chargesTotal: number;
    discountTotal: number;
    taxTotal: number;
    expectedTotal: number | null;
    taxMode: "exclusive" | "inclusive" | "none" | "unknown";
  };
  gstin: { normalized: string; valid: boolean; state?: string } | null;
}

const TOL = 1; // rupees: absorbs paise rounding on printed bills

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function rupees(n: number): string {
  const v = r2(n);
  const whole = Number.isInteger(v);
  return (
    (v < 0 ? "−₹" : "₹") +
    Math.abs(v).toLocaleString("en-IN", {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : String(r2(q * 1000) / 1000));
const total = (xs: Array<number | null | undefined>) => r2(xs.reduce<number>((a, b) => a + (b ?? 0), 0));
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, "");
const itemName = (name: string, i: number) => (name.trim() ? name.trim() : `Line ${i + 1}`);

const CHECK_LABELS: Record<string, string> = {
  line: "Each line: quantity × rate",
  mrp: "No price above MRP",
  subtotal: "Items add up to the subtotal",
  dupes: "No repeated lines",
  chargeRate: "Charges match their %",
  service: "Service charge",
  taxRate: "Tax amounts match their %",
  gstSplit: "CGST equals SGST",
  total: "Grand total adds up",
  roundoff: "Round-off under ₹1",
  gstin: "GSTIN passes the official check",
  date: "Bill date makes sense",
};

const RANK: Record<CheckStatus, number> = { skip: 0, pass: 1, flag: 2 };

export function verifyBill(bill: Bill, now: Date = new Date()): Verdict {
  const findings: Finding[] = [];
  const checks = new Map<string, CheckStatus>();
  const mark = (key: string, status: CheckStatus) => {
    const prev = checks.get(key);
    if (!prev || RANK[status] > RANK[prev]) checks.set(key, status);
  };
  const add = (f: Finding, checkKey?: string) => {
    findings.push({ ...f, impact: r2(Math.max(0, f.impact)) });
    if (checkKey && f.severity !== "info") mark(checkKey, "flag");
  };

  const items = bill.items;
  const itemAmounts = items.map((i) => i.amount);
  const allAmountsKnown = items.length > 0 && itemAmounts.every((a) => a != null);
  const itemsTotal = total(itemAmounts);
  const chargesTotal = total(bill.charges.map((c) => c.amount));
  const taxableCharges = total(bill.charges.filter((c) => c.kind !== "tip").map((c) => c.amount));
  const discountTotal = total(bill.discounts.map((d) => d.amount));
  const taxTotal = total(bill.taxes.map((t) => t.amount));
  const base: number | null = bill.subtotal ?? (items.length ? itemsTotal : null);

  // ── 1. Each line: quantity × rate ───────────────────────────────────
  items.forEach((it, i) => {
    if (it.quantity == null || it.unitPrice == null || it.amount == null) return;
    mark("line", "pass");
    const expected = r2(it.quantity * it.unitPrice);
    const diff = r2(it.amount - expected);
    const name = itemName(it.name, i);
    if (diff > TOL) {
      add(
        {
          id: `line-${i}`,
          severity: "error",
          title: `${name}: line total is ${rupees(diff)} too high`,
          detail: `${qtyText(it.quantity)} × ${rupees(it.unitPrice)} = ${rupees(expected)}, but the bill says ${rupees(it.amount)}.`,
          impact: diff,
          note: `${qtyText(it.quantity)} × ${rupees(it.unitPrice)} = ${rupees(expected)}`,
          target: { kind: "item", index: i },
        },
        "line",
      );
    } else if (diff < -TOL) {
      add({
        id: `line-${i}`,
        severity: "info",
        title: `${name}: ${rupees(-diff)} less than quantity × rate`,
        detail: `${qtyText(it.quantity)} × ${rupees(it.unitPrice)} = ${rupees(expected)}, the bill says ${rupees(it.amount)}. Probably a line discount — in your favour.`,
        impact: 0,
        target: { kind: "item", index: i },
      });
    }
  });

  // ── 2. No price above MRP ───────────────────────────────────────────
  items.forEach((it, i) => {
    if (it.mrp == null || it.mrp <= 0) return;
    const unit =
      it.unitPrice ?? (it.amount != null && it.quantity ? r2(it.amount / it.quantity) : null);
    if (unit == null) return;
    mark("mrp", "pass");
    const tolerance = it.unitPrice != null ? 0.01 : 0.5;
    if (unit - it.mrp > tolerance) {
      const q = it.quantity ?? 1;
      add(
        {
          id: `mrp-${i}`,
          severity: "error",
          title: `${itemName(it.name, i)}: sold above MRP`,
          detail: `MRP is ${rupees(it.mrp)}, but you were charged ${rupees(unit)}${q !== 1 ? ` each, for ${qtyText(q)}` : ""}. Shops can't sell above the printed MRP.`,
          impact: (unit - it.mrp) * q,
          note: `MRP is ${rupees(it.mrp)}`,
          target: { kind: "item", index: i },
        },
        "mrp",
      );
    }
  });

  // ── 3. Items add up to the subtotal ─────────────────────────────────
  if (bill.subtotal != null && allAmountsKnown) {
    mark("subtotal", "pass");
    const diff = r2(bill.subtotal - itemsTotal);
    if (diff > TOL) {
      add(
        {
          id: "subtotal",
          severity: "error",
          title: `Subtotal is ${rupees(diff)} more than the items`,
          detail: `The items add up to ${rupees(itemsTotal)}, but the subtotal says ${rupees(bill.subtotal)}.`,
          impact: diff,
          note: `items add up to ${rupees(itemsTotal)}`,
          target: { kind: "subtotal" },
        },
        "subtotal",
      );
    } else if (diff < -TOL) {
      add(
        {
          id: "subtotal",
          severity: "warning",
          title: `Subtotal is ${rupees(-diff)} less than the items`,
          detail: `The items add up to ${rupees(itemsTotal)}, the subtotal says ${rupees(bill.subtotal)}. Could be an unlisted discount, or a line that was misread.`,
          impact: 0,
          target: { kind: "subtotal" },
        },
        "subtotal",
      );
    }
  }

  // ── 4. No repeated lines ────────────────────────────────────────────
  if (items.length > 1) {
    mark("dupes", "pass");
    const groups = new Map<string, number[]>();
    items.forEach((it, i) => {
      if (!it.name.trim() || it.amount == null) return;
      const key = `${norm(it.name)}|${it.amount}`;
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    for (const idx of groups.values()) {
      if (idx.length < 2) continue;
      const it = items[idx[0]];
      add(
        {
          id: `dupe-${idx[0]}`,
          severity: "warning",
          title: `"${it.name.trim()}" is billed ${idx.length} times`,
          detail: `Same item, same amount (${rupees(it.amount ?? 0)}), on separate lines. Fine if you ordered it again — otherwise it's a double entry.`,
          impact: 0,
          note: "billed twice?",
          target: { kind: "item", index: idx[1] },
        },
        "dupes",
      );
    }
  }

  // ── 5. Charges: service charge + charges with a printed % ───────────
  bill.charges.forEach((c, i) => {
    const label = c.label.trim() || "Charge";
    if (c.kind === "service_charge" && (c.amount ?? 0) > 0) {
      mark("service", "flag");
      add({
        id: `service-${i}`,
        severity: "warning",
        title: `Service charge of ${rupees(c.amount ?? 0)} is optional`,
        detail:
          "Restaurants can't make service charge compulsory — that's the CCPA rule the Delhi High Court upheld in March 2025. If nobody asked you, you can ask for it to be removed.",
        impact: c.amount ?? 0,
        note: "optional, you can refuse",
        target: { kind: "charge", index: i },
      });
    }
    if (c.rate != null && c.amount != null && base != null) {
      mark("chargeRate", "pass");
      const candidates = [base, base - discountTotal].map((b) => ({ b, e: r2((b * c.rate!) / 100) }));
      const best = candidates.reduce((x, y) => (Math.abs(c.amount! - y.e) < Math.abs(c.amount! - x.e) ? y : x));
      const diff = r2(c.amount - best.e);
      if (diff > TOL) {
        add(
          {
            id: `charge-${i}`,
            severity: "error",
            title: `${label} is ${rupees(diff)} more than ${c.rate}%`,
            detail: `${c.rate}% of ${rupees(best.b)} is ${rupees(best.e)}, but the bill charges ${rupees(c.amount)}.`,
            impact: diff,
            note: `${c.rate}% = ${rupees(best.e)}`,
            target: { kind: "charge", index: i },
          },
          "chargeRate",
        );
      }
    }
  });

  // ── 6. Tax amounts match their % ────────────────────────────────────
  const ratesByKind = new Map<string, Set<number>>();
  bill.taxes.forEach((t) => {
    if (t.rate == null) return;
    ratesByKind.set(t.kind, (ratesByKind.get(t.kind) ?? new Set()).add(t.rate));
  });
  const multiRate = [...ratesByKind.values()].some((s) => s.size > 1);
  const combinedRate = multiRate ? 0 : total(bill.taxes.map((t) => t.rate));

  bill.taxes.forEach((t, i) => {
    if (t.rate == null || t.amount == null || t.rate <= 0) return;
    if (t.taxableAmount == null && (multiRate || base == null)) return;
    mark("taxRate", "pass");
    const label = t.label.trim() || t.kind;
    const bases: number[] = [];
    if (t.taxableAmount != null) {
      bases.push(t.taxableAmount);
    } else if (base != null) {
      const gross = base + taxableCharges - discountTotal;
      bases.push(gross, base - discountTotal, base + taxableCharges, base);
      if (combinedRate > 0) bases.push(gross / (1 + combinedRate / 100), (base - discountTotal) / (1 + combinedRate / 100));
    }
    const options = bases.map((b) => ({ b: r2(b), e: r2((b * t.rate!) / 100) }));
    const best = options.reduce((x, y) => (Math.abs(t.amount! - y.e) < Math.abs(t.amount! - x.e) ? y : x));
    const diff = r2(t.amount - best.e);
    if (diff > TOL) {
      add(
        {
          id: `tax-${i}`,
          severity: t.taxableAmount != null ? "error" : "warning",
          title: `${label} looks ${rupees(diff)} too high`,
          detail: `${t.rate}% of ${rupees(best.b)} is ${rupees(best.e)}, but the bill charges ${rupees(t.amount)}.`,
          impact: diff,
          note: `${t.rate}% = ${rupees(best.e)}`,
          target: { kind: "tax", index: i },
        },
        "taxRate",
      );
    } else if (diff < -TOL) {
      add({
        id: `tax-${i}`,
        severity: "info",
        title: `${label} is lower than ${t.rate}%`,
        detail: `${t.rate}% of ${rupees(best.b)} would be ${rupees(best.e)}; the bill charges ${rupees(t.amount)}. In your favour, or a mixed-rate bill.`,
        impact: 0,
        target: { kind: "tax", index: i },
      });
    }
  });

  // ── 7. CGST equals SGST ─────────────────────────────────────────────
  const cgst = bill.taxes.filter((t) => t.kind === "CGST");
  const sgst = bill.taxes.filter((t) => t.kind === "SGST" || t.kind === "UTGST");
  const igst = bill.taxes.filter((t) => t.kind === "IGST");
  if (cgst.length || sgst.length) {
    mark("gstSplit", "pass");
    if (!sgst.length || !cgst.length) {
      const has = cgst.length ? "CGST" : "SGST";
      const missing = cgst.length ? "SGST" : "CGST";
      add(
        {
          id: "gst-split",
          severity: "warning",
          title: `${has} is charged but ${missing} is missing`,
          detail: `Inside one state, GST is split into two equal halves: CGST and SGST. Only one half is on this bill — check whether a line was missed.`,
          impact: 0,
          target: { kind: "tax" },
        },
        "gstSplit",
      );
    } else {
      const a = total(cgst.map((t) => t.amount));
      const b = total(sgst.map((t) => t.amount));
      if (Math.abs(a - b) > 0.5) {
        add(
          {
            id: "gst-split",
            severity: "warning",
            title: "CGST and SGST don't match",
            detail: `They should be equal halves. Here CGST is ${rupees(a)} and SGST is ${rupees(b)}.`,
            impact: 0,
            target: { kind: "tax" },
          },
          "gstSplit",
        );
      }
    }
  }
  if (igst.length && cgst.length) {
    add(
      {
        id: "gst-both",
        severity: "warning",
        title: "Both IGST and CGST are charged",
        detail: "A bill has either IGST (seller in another state) or CGST + SGST (same state), never both.",
        impact: 0,
        target: { kind: "tax" },
      },
      "gstSplit",
    );
  }

  // ── 8. Grand total adds up ──────────────────────────────────────────
  let expectedTotal: number | null = null;
  let taxMode: Verdict["computed"]["taxMode"] = taxTotal > 0 ? "unknown" : "none";
  if (bill.grandTotal != null && base != null) {
    mark("total", "pass");
    const ro = bill.roundOff ?? 0;
    const pre = base + chargesTotal - discountTotal;
    const exclusive = r2(pre + taxTotal + ro);
    const inclusive = r2(pre + ro);
    const options =
      taxTotal > 0
        ? bill.taxesIncludedInPrices === true
          ? [inclusive, exclusive]
          : [exclusive, inclusive]
        : [exclusive];
    const matched = options.find((o) => Math.abs(bill.grandTotal! - o) <= TOL);
    if (matched != null) {
      expectedTotal = matched;
      if (taxTotal > 0) taxMode = matched === exclusive ? "exclusive" : "inclusive";
    } else {
      const closest = options.reduce((x, y) => (Math.abs(bill.grandTotal! - y) < Math.abs(bill.grandTotal! - x) ? y : x));
      expectedTotal = closest;
      if (taxTotal > 0) taxMode = closest === exclusive ? "exclusive" : "inclusive";
      const diff = r2(bill.grandTotal - closest);
      const parts = [`items ${rupees(base)}`];
      if (chargesTotal) parts.push(`charges ${rupees(chargesTotal)}`);
      if (discountTotal) parts.push(`minus discount ${rupees(discountTotal)}`);
      if (taxMode === "exclusive" && taxTotal) parts.push(`tax ${rupees(taxTotal)}`);
      if (ro) parts.push(`round-off ${rupees(ro)}`);
      if (diff > TOL) {
        add(
          {
            id: "total",
            severity: "error",
            title: `Total is ${rupees(diff)} more than it should be`,
            detail: `${capitalise(parts.join(", "))} comes to ${rupees(closest)}. The bill asks for ${rupees(bill.grandTotal)}.`,
            impact: diff,
            note: `should be ${rupees(closest)}`,
            target: { kind: "total" },
          },
          "total",
        );
      } else {
        add(
          {
            id: "total",
            severity: "warning",
            title: `Total is ${rupees(-diff)} less than the bill's own numbers`,
            detail: `${capitalise(parts.join(", "))} comes to ${rupees(closest)}, but the bill asks for ${rupees(bill.grandTotal)}. In your favour — or a number was misread.`,
            impact: 0,
            target: { kind: "total" },
          },
          "total",
        );
      }
    }
  }

  // ── 9. Round-off under ₹1 ───────────────────────────────────────────
  if (bill.roundOff != null) {
    mark("roundoff", "pass");
    if (Math.abs(bill.roundOff) >= 1) {
      add(
        {
          id: "roundoff",
          severity: "warning",
          title: `Round-off of ${rupees(bill.roundOff)} is too big`,
          detail: "Round-off only clears the paise, so it should stay under ₹1 either way.",
          impact: bill.roundOff > 0 ? Math.floor(bill.roundOff) : 0,
          note: "should be under ₹1",
          target: { kind: "roundoff" },
        },
        "roundoff",
      );
    }
  }

  // ── 10. GSTIN passes the official check ─────────────────────────────
  let gstinInfo: Verdict["gstin"] = null;
  const chargesGst = bill.taxes.some((t) => ["CGST", "SGST", "UTGST", "IGST", "CESS"].includes(t.kind) && (t.amount ?? 0) > 0);
  if (bill.gstin && bill.gstin.trim()) {
    mark("gstin", "pass");
    const g = checkGstin(bill.gstin);
    gstinInfo = { normalized: g.normalized, valid: g.valid, state: g.state };
    if (!g.valid) {
      const why =
        g.reason === "checksum"
          ? `For this number the last character should be "${g.expectedCheck}", not "${g.normalized[14]}".`
          : g.reason === "state"
            ? `It starts with "${g.normalized.slice(0, 2)}", which isn't a GST state code.`
            : `A GSTIN has 15 characters in a fixed pattern, and "${g.normalized}" doesn't fit it.`;
      add(
        {
          id: "gstin",
          severity: "warning",
          title: "GSTIN doesn't pass the official check",
          detail: `${why} Either a smudged character was misread, or the number is fake. Compare it with the paper bill.`,
          impact: 0,
          note: g.reason === "checksum" ? `check digit should be ${g.expectedCheck}` : "invalid format",
          target: { kind: "gstin" },
        },
        "gstin",
      );
    }
  } else if (chargesGst) {
    add(
      {
        id: "gstin",
        severity: "warning",
        title: "GST is charged, but no GSTIN is printed",
        detail: "A business collecting GST has to print its GSTIN on the bill.",
        impact: 0,
        target: { kind: "gstin" },
      },
      "gstin",
    );
  }

  // ── 11. Bill date makes sense ───────────────────────────────────────
  if (bill.billDate) {
    const d = new Date(`${bill.billDate}T00:00:00+05:30`);
    if (!Number.isNaN(d.getTime())) {
      mark("date", "pass");
      if (d.getTime() > now.getTime() + 36 * 3600 * 1000) {
        add(
          {
            id: "date",
            severity: "warning",
            title: "Bill date is in the future",
            detail: `The date reads as ${bill.billDate}. Probably a misread — check the date on the paper bill.`,
            impact: 0,
            target: { kind: "date" },
          },
          "date",
        );
      }
    }
  }

  // ── Context notes (never change the verdict) ────────────────────────
  if (bill.dueDate) {
    const due = new Date(`${bill.dueDate}T23:59:59+05:30`);
    if (!Number.isNaN(due.getTime())) {
      const passed = due.getTime() < now.getTime();
      findings.push({
        id: "due",
        severity: "info",
        title: passed ? `Due date ${bill.dueDate} has passed` : `Pay by ${bill.dueDate}`,
        detail: passed ? "A late fee may be added to your next bill." : "Paying after this date usually adds a late fee.",
        impact: 0,
      });
    }
  }
  if (bill.lateFee && bill.lateFee > 0) {
    findings.push({
      id: "latefee",
      severity: "info",
      title: `Late fee of ${rupees(bill.lateFee)} on this bill`,
      detail: "Paying before the due date avoids this next time.",
      impact: 0,
    });
  }
  const unsure = items.map((it, i) => ({ it, i })).filter(({ it }) => it.confidence === "low");
  if (unsure.length) {
    findings.push({
      id: "unsure",
      severity: "info",
      title: `AI wasn't sure about ${unsure.length === 1 ? "1 line" : `${unsure.length} lines`}`,
      detail: `${unsure.map(({ it, i }) => itemName(it.name, i)).join(", ")}. Check against the paper bill and fix if needed.`,
      impact: 0,
    });
  }

  // ── Verdict ─────────────────────────────────────────────────────────
  let status: VerdictStatus;
  if (!bill.isBill) {
    status = "unreadable";
  } else if (!items.length && bill.grandTotal == null) {
    status = "unreadable";
  } else if (findings.some((f) => f.severity === "error")) {
    status = "gadbad";
  } else if (findings.some((f) => f.severity === "warning")) {
    status = "check";
  } else {
    status = "sahi";
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.impact - a.impact);

  return {
    status,
    moneyAtStake: r2(findings.filter((f) => f.severity !== "info").reduce((s, f) => s + f.impact, 0)),
    findings,
    checks: Object.keys(CHECK_LABELS).map((key) => ({
      key,
      label: CHECK_LABELS[key],
      status: checks.get(key) ?? "skip",
    })),
    computed: { itemsTotal, chargesTotal, discountTotal, taxTotal, expectedTotal, taxMode },
    gstin: gstinInfo,
  };
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
