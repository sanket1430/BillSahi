import { z } from "zod";

/**
 * The shape of a bill as the AI reads it.
 *
 * Every field is forgiving (`.catch`) on purpose: a vision model will
 * occasionally return "1,234.50" instead of 1234.5, or skip a field.
 * We coerce what we can and fall back to null instead of failing the
 * whole request. The checker treats null as "not printed / unreadable".
 */

export const BILL_TYPES = [
  "restaurant",
  "pharmacy",
  "grocery_retail",
  "electricity",
  "telecom_internet",
  "fuel",
  "hotel",
  "ecommerce",
  "other",
] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const CHARGE_KINDS = [
  "service_charge",
  "packing",
  "delivery",
  "convenience_fee",
  "tip",
  "other",
] as const;

export const TAX_KINDS = ["CGST", "SGST", "UTGST", "IGST", "CESS", "VAT", "OTHER"] as const;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const negative = /^\s*[-−(]/.test(v);
    const cleaned = v.replace(/rs\.?|inr|₹|,|\s|\(|\)|−|-/gi, "");
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return null;
    return negative ? -n : n;
  }
  return null;
}

const money = z.preprocess(toNum, z.number().nullable()).catch(null);
const text = z.string().nullable().catch(null);

export const ItemSchema = z.object({
  name: z.string().catch(""),
  quantity: money,
  unitPrice: money,
  mrp: money,
  amount: money,
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
});

export const ChargeSchema = z.object({
  label: z.string().catch(""),
  kind: z.enum(CHARGE_KINDS).catch("other"),
  rate: money,
  amount: money,
});

export const DiscountSchema = z.object({
  label: z.string().catch(""),
  amount: z.preprocess(toNum, z.number().nullable()).transform((n) => (n == null ? null : Math.abs(n))).catch(null),
});

export const TaxSchema = z.object({
  label: z.string().catch(""),
  kind: z.preprocess((v) => (typeof v === "string" ? v.toUpperCase() : v), z.enum(TAX_KINDS)).catch("OTHER"),
  rate: money,
  taxableAmount: money,
  amount: money,
});

export const BillSchema = z.object({
  isBill: z.boolean().catch(true),
  notBillReason: text,
  billType: z.enum(BILL_TYPES).catch("other"),
  merchantName: text,
  merchantAddress: text,
  gstin: text,
  billNumber: text,
  billDate: text,
  items: z.array(ItemSchema).catch([]),
  charges: z.array(ChargeSchema).catch([]),
  discounts: z.array(DiscountSchema).catch([]),
  taxes: z.array(TaxSchema).catch([]),
  taxesIncludedInPrices: z.boolean().nullable().catch(null),
  subtotal: money,
  roundOff: money,
  grandTotal: money,
  dueDate: text,
  lateFee: money,
  readingNotes: z.array(z.string()).catch([]),
});

export type Bill = z.infer<typeof BillSchema>;
export type BillItem = z.infer<typeof ItemSchema>;
export type BillCharge = z.infer<typeof ChargeSchema>;
export type BillTax = z.infer<typeof TaxSchema>;

const nullable = (type: string) => ({ type: [type, "null"] });

/**
 * JSON Schema sent to Gemini as the structured-output contract.
 * Kept flat and small: big nested schemas get rejected.
 */
export const BILL_JSON_SCHEMA = {
  type: "object",
  properties: {
    isBill: { type: "boolean", description: "false if the image is not a bill, receipt or invoice" },
    notBillReason: nullable("string"),
    billType: { type: "string", enum: [...BILL_TYPES] },
    merchantName: nullable("string"),
    merchantAddress: nullable("string"),
    gstin: { ...nullable("string"), description: "Seller's 15-character GSTIN exactly as printed" },
    billNumber: nullable("string"),
    billDate: { ...nullable("string"), description: "YYYY-MM-DD" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: nullable("number"),
          unitPrice: { ...nullable("number"), description: "Rate per unit as printed" },
          mrp: { ...nullable("number"), description: "Only if an MRP value is printed for this line" },
          amount: { ...nullable("number"), description: "Line total exactly as printed, even if it looks wrong" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "quantity", "unitPrice", "mrp", "amount", "confidence"],
      },
    },
    charges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string", enum: [...CHARGE_KINDS] },
          rate: { ...nullable("number"), description: "Percent, if printed" },
          amount: nullable("number"),
        },
        required: ["label", "kind", "rate", "amount"],
      },
    },
    discounts: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string" }, amount: nullable("number") },
        required: ["label", "amount"],
      },
    },
    taxes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string", enum: [...TAX_KINDS] },
          rate: { ...nullable("number"), description: "Percent as printed, e.g. 2.5" },
          taxableAmount: { ...nullable("number"), description: "Only if printed next to this tax" },
          amount: nullable("number"),
        },
        required: ["label", "kind", "rate", "taxableAmount", "amount"],
      },
    },
    taxesIncludedInPrices: { ...nullable("boolean"), description: "true if item prices already include tax (tax shown only as a breakup)" },
    subtotal: nullable("number"),
    roundOff: { ...nullable("number"), description: "Signed: negative if it reduces the total" },
    grandTotal: { ...nullable("number"), description: "Final amount payable as printed" },
    dueDate: { ...nullable("string"), description: "YYYY-MM-DD, utility bills only" },
    lateFee: nullable("number"),
    readingNotes: { type: "array", items: { type: "string" }, description: "Up to 5 short notes on anything unclear" },
  },
  required: [
    "isBill",
    "billType",
    "merchantName",
    "gstin",
    "billDate",
    "items",
    "charges",
    "discounts",
    "taxes",
    "taxesIncludedInPrices",
    "subtotal",
    "roundOff",
    "grandTotal",
    "readingNotes",
  ],
} as const;
