/**
 * GSTIN validation, fully offline.
 *
 * Format: 2-digit state code + 10-char PAN + entity number + "Z" + check character.
 * The check character uses the Luhn mod-36 scheme used by the GST system.
 * AI is never asked whether a GSTIN is valid — arithmetic decides.
 */

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman & Diu",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old code)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman & Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export function gstinCheckChar(first14: string): string | null {
  let factor = 1;
  let total = 0;
  for (const ch of first14) {
    const codePoint = CHARS.indexOf(ch);
    if (codePoint < 0) return null;
    let digit = factor * codePoint;
    digit = Math.floor(digit / 36) + (digit % 36);
    total += digit;
    factor = factor === 1 ? 2 : 1;
  }
  return CHARS[(36 - (total % 36)) % 36];
}

export type GstinResult =
  | { valid: true; normalized: string; state: string }
  | {
      valid: false;
      normalized: string;
      reason: "length" | "pattern" | "state" | "checksum";
      state?: string;
      expectedCheck?: string;
    };

export function checkGstin(raw: string): GstinResult {
  const g = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (g.length !== 15) return { valid: false, normalized: g, reason: "length" };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) {
    return { valid: false, normalized: g, reason: "pattern" };
  }
  const state = GST_STATES[g.slice(0, 2)];
  if (!state) return { valid: false, normalized: g, reason: "state" };
  const expected = gstinCheckChar(g.slice(0, 14));
  if (expected !== g[14]) {
    return { valid: false, normalized: g, reason: "checksum", state, expectedCheck: expected ?? undefined };
  }
  return { valid: true, normalized: g, state };
}
