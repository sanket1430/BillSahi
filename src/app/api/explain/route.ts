import { NextResponse } from "next/server";
import { z } from "zod";
import { AIError, generateJSON } from "@/lib/gemini";
import { EXPLAIN, EXPLAIN_JSON_SCHEMA, LANGUAGES, type Lang } from "@/lib/prompts";
import { allow, clientIp } from "@/lib/ratelimit";
import { BillSchema } from "@/lib/schema";
import { verifyBill } from "@/lib/verify";

export const maxDuration = 60;

const ExplainSchema = z.object({
  summary: z.string(),
  points: z.array(z.string()).catch([]),
  askMessage: z.string().nullable().catch(null),
});

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!allow(`explain:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
    return fail("Too many explanations this hour. Try again a bit later.", 429);
  }

  let body: { bill?: unknown; lang?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("Bad request.", 400);
  }
  const lang = (typeof body.lang === "string" && body.lang in LANGUAGES ? body.lang : "en") as Lang;
  const parsed = BillSchema.safeParse(body.bill);
  if (!parsed.success) return fail("Bad bill data.", 400);

  // The verdict is recomputed here, never taken from the client:
  // the explanation is always grounded in the deterministic checks.
  const bill = parsed.data;
  const verdict = verifyBill(bill);
  const payload = {
    bill: {
      merchant: bill.merchantName,
      type: bill.billType,
      date: bill.billDate,
      grandTotal: bill.grandTotal,
      items: bill.items.map((i) => i.name).slice(0, 25),
      dueDate: bill.dueDate,
    },
    verdict: {
      status: verdict.status,
      moneyAtStake: verdict.moneyAtStake,
      findings: verdict.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, rupees: f.impact })),
    },
  };

  try {
    const ai = await generateJSON({
      system: EXPLAIN(lang),
      schema: EXPLAIN_JSON_SCHEMA,
      parts: [{ text: JSON.stringify(payload) }],
      timeoutMs: 30_000,
    });
    const out = ExplainSchema.safeParse(ai.data);
    if (!out.success) return fail("The explanation came back garbled. Try again.", 502);
    return NextResponse.json({ ...out.data, lang, model: ai.model });
  } catch (e) {
    if (e instanceof AIError) return fail(e.userMessage, e.status);
    console.error("[explain] unexpected", e);
    return fail("Couldn't explain this bill right now.", 500);
  }
}
