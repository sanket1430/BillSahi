import { NextResponse } from "next/server";
import { AIError, generateJSON } from "@/lib/gemini";
import { READ_BILL } from "@/lib/prompts";
import { allow, clientIp } from "@/lib/ratelimit";
import { BILL_JSON_SCHEMA, BillSchema } from "@/lib/schema";
import { verifyBill } from "@/lib/verify";

export const maxDuration = 60;

const MAX_BASE64 = 4_000_000;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!allow(clientIp(req), 25, 60 * 60 * 1000)) {
    return fail("You've checked a lot of bills this hour. Try again a bit later.", 429);
  }

  let body: { image?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("The photo didn't arrive properly. Try again.", 400);
  }

  const image = typeof body.image === "string" ? body.image.replace(/^data:[^;]+;base64,/, "") : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
  if (!image) return fail("No photo received. Choose a bill photo and try again.", 400);
  if (image.length > MAX_BASE64) return fail("That photo is too large. Try a screenshot or a smaller photo.", 413);
  if (!MIME.has(mimeType)) return fail("Use a JPG, PNG or WebP photo of the bill.", 415);

  try {
    const ai = await generateJSON({
      system: READ_BILL,
      schema: BILL_JSON_SCHEMA,
      parts: [{ text: "Read this bill." }, { inline_data: { mime_type: mimeType, data: image } }],
    });
    const parsed = BillSchema.safeParse(ai.data);
    if (!parsed.success) {
      console.error("[analyze] schema mismatch", parsed.error.issues.slice(0, 5));
      return fail("The AI's reading came back in an unexpected shape. Try again.", 502);
    }
    const bill = parsed.data;
    const verdict = verifyBill(bill);
    return NextResponse.json({
      bill,
      verdict,
      meta: { model: ai.model, ms: ai.ms, shape: ai.shape, source: "ai" },
    });
  } catch (e) {
    if (e instanceof AIError) return fail(e.userMessage, e.status);
    console.error("[analyze] unexpected", e);
    return fail("Something went wrong while checking this bill. Try again.", 500);
  }
}
