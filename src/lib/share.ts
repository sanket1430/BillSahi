import type { Bill } from "./schema";
import { rupees, type Verdict } from "./verify";

export function shareText(bill: Bill, verdict: Verdict, siteUrl: string): string {
  const who = bill.merchantName ?? "this bill";
  const total = bill.grandTotal != null ? ` (${rupees(bill.grandTotal)})` : "";
  const lines: string[] = [];
  if (verdict.status === "sahi") {
    lines.push(`✅ Checked my bill from ${who}${total} on BillSahi. Sahi hai, every number adds up.`);
  } else if (verdict.status === "gadbad") {
    lines.push(`🧾 Checked my bill from ${who}${total} on BillSahi. Found ${rupees(verdict.moneyAtStake)} extra:`);
  } else if (verdict.status === "check") {
    lines.push(`🧾 Checked my bill from ${who}${total} on BillSahi. A few things to look at:`);
  } else {
    lines.push("🧾 Tried checking a bill on BillSahi.");
  }
  for (const f of verdict.findings.filter((x) => x.severity !== "info").slice(0, 4)) {
    lines.push(`• ${f.title}`);
  }
  lines.push("", `Check yours: ${siteUrl}`);
  return lines.join("\n");
}

export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
