import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BillSchema, type Bill } from "../src/lib/schema";
import { checkGstin } from "../src/lib/gstin";
import { verifyBill } from "../src/lib/verify";

const NOW = new Date("2026-11-23T12:00:00+05:30");
const sample = (slug: string): Bill =>
  BillSchema.parse(JSON.parse(readFileSync(join(__dirname, "../public/samples", `${slug}.json`), "utf8")));
const ids = (v: ReturnType<typeof verifyBill>) => v.findings.map((f) => `${f.severity}:${f.id}`);
const check = (v: ReturnType<typeof verifyBill>, key: string) => v.checks.find((c) => c.key === key)?.status;

describe("GSTIN check digit", () => {
  it("accepts real-world valid GSTINs", () => {
    expect(checkGstin("09AAACT2727Q1ZU").valid).toBe(true);
    expect(checkGstin("27AABCU9603R1ZN").valid).toBe(true);
    expect(checkGstin("27 aabcu 9603 r1zn").valid).toBe(true);
  });
  it("rejects a wrong check character and says what it should be", () => {
    const r = checkGstin("09AAACT2727Q1ZA");
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.reason).toBe("checksum");
      expect(r.expectedCheck).toBe("U");
    }
  });
  it("rejects bad length and unknown state codes", () => {
    expect(checkGstin("27AABCU9603R1Z").valid).toBe(false);
    const r = checkGstin("55AABCU9603R1ZN");
    expect(r.valid === false && r.reason).toBe("state");
  });
});

describe("demo bills", () => {
  it("restaurant: catches the coffee line and the service charge", () => {
    const v = verifyBill(sample("restaurant"), NOW);
    expect(v.status).toBe("gadbad");
    expect(v.moneyAtStake).toBe(88);
    expect(ids(v)).toEqual(["error:line-2", "warning:service-0"]);
    expect(v.findings[0].impact).toBe(20);
    expect(check(v, "taxRate")).toBe("pass");
    expect(check(v, "gstSplit")).toBe("pass");
    expect(check(v, "total")).toBe("pass");
    expect(check(v, "gstin")).toBe("pass");
    expect(v.computed.taxMode).toBe("exclusive");
  });

  it("medical store: catches the above-MRP syrup and the fake GSTIN", () => {
    const v = verifyBill(sample("medical"), NOW);
    expect(v.status).toBe("gadbad");
    expect(v.moneyAtStake).toBe(7);
    expect(ids(v)).toEqual(["error:mrp-1", "warning:gstin"]);
    expect(check(v, "total")).toBe("pass");
    expect(check(v, "taxRate")).toBe("pass");
    expect(v.computed.taxMode).toBe("inclusive");
  });

  it("kirana: a clean bill gets a clean verdict", () => {
    const v = verifyBill(sample("kirana"), NOW);
    expect(v.status).toBe("sahi");
    expect(v.moneyAtStake).toBe(0);
    expect(v.findings).toEqual([]);
    expect(check(v, "line")).toBe("pass");
    expect(check(v, "mrp")).toBe("pass");
    expect(check(v, "total")).toBe("pass");
    expect(check(v, "taxRate")).toBe("skip");
  });
});

describe("edge cases", () => {
  const base = () => sample("restaurant");

  it("flags an inflated grand total with the exact difference", () => {
    const b = base();
    b.grandTotal = 825;
    const v = verifyBill(b, NOW);
    const f = v.findings.find((x) => x.id === "total");
    expect(f?.severity).toBe("error");
    expect(f?.impact).toBe(40);
  });

  it("flags a subtotal that doesn't match the items", () => {
    const b = sample("kirana");
    b.subtotal = 1281;
    b.grandTotal = 1281;
    const v = verifyBill(b, NOW);
    expect(v.findings.find((x) => x.id === "subtotal")?.impact).toBe(50);
  });

  it("warns when SGST is missing", () => {
    const b = base();
    b.taxes = b.taxes.filter((t) => t.kind !== "SGST");
    b.grandTotal = 766.3;
    b.roundOff = null;
    const v = verifyBill(b, NOW);
    expect(ids(v)).toContain("warning:gst-split");
  });

  it("warns about a round-off bigger than ₹1", () => {
    const b = base();
    b.roundOff = 4.6;
    b.grandTotal = 790;
    const v = verifyBill(b, NOW);
    expect(ids(v)).toContain("warning:roundoff");
  });

  it("warns about a future date (likely misread)", () => {
    const b = base();
    b.billDate = "2026-12-21";
    expect(ids(verifyBill(b, NOW))).toContain("warning:date");
  });

  it("doesn't accuse a mixed-rate bill without taxable amounts", () => {
    const b = sample("kirana");
    b.taxes = [
      { label: "CGST 2.5%", kind: "CGST", rate: 2.5, taxableAmount: null, amount: 10 },
      { label: "CGST 9%", kind: "CGST", rate: 9, taxableAmount: null, amount: 20 },
      { label: "SGST 2.5%", kind: "SGST", rate: 2.5, taxableAmount: null, amount: 10 },
      { label: "SGST 9%", kind: "SGST", rate: 9, taxableAmount: null, amount: 20 },
    ];
    b.taxesIncludedInPrices = true;
    const v = verifyBill(b, NOW);
    expect(check(v, "taxRate")).toBe("skip");
    expect(v.status).toBe("sahi");
  });

  it("calls a non-bill unreadable", () => {
    const b = base();
    b.isBill = false;
    expect(verifyBill(b, NOW).status).toBe("unreadable");
  });

  it("coerces messy numbers from the AI", () => {
    const b = BillSchema.parse({
      isBill: true,
      billType: "restaurant",
      items: [{ name: "Thali", quantity: "2", unitPrice: "₹ 1,250.50", amount: "Rs. 2,501.00", confidence: "high" }],
      grandTotal: "2,501",
      discounts: [{ label: "Promo", amount: "-50" }],
      roundOff: "(0.40)",
    });
    expect(b.items[0].unitPrice).toBe(1250.5);
    expect(b.items[0].amount).toBe(2501);
    expect(b.grandTotal).toBe(2501);
    expect(b.discounts[0].amount).toBe(50);
    expect(b.roundOff).toBe(-0.4);
    expect(b.taxes).toEqual([]);
  });
});
