import "server-only";

/**
 * Minimal Gemini client over REST (no SDK, so nothing to break on upgrades).
 *
 * Resilience is deliberate, because a reviewer may open the demo on a bad day:
 *  - Model chain: GEMINI_MODEL (comma-separated) first, then sensible fallbacks.
 *    A 404 (model retired), 429 (quota) or 5xx moves on to the next model.
 *  - Request shape chain: the newest structured-output field first, older ones
 *    after, then plain JSON mode. A 400 about an unknown field moves on.
 *  - The reply is parsed defensively and validated by zod afterwards anyway.
 */

const API = "https://generativelanguage.googleapis.com/v1beta/models";
const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

export class AIError extends Error {
  constructor(
    message: string,
    public status: number,
    public userMessage: string,
  ) {
    super(message);
  }
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

type Shape = { name: string; config: (schema: object) => Record<string, unknown> };

const SHAPES: Shape[] = [
  { name: "responseFormat", config: (schema) => ({ responseFormat: { text: { mimeType: "application/json", schema } } }) },
  { name: "responseJsonSchema", config: (schema) => ({ responseMimeType: "application/json", responseJsonSchema: schema }) },
  { name: "jsonMode", config: () => ({ responseMimeType: "application/json" }) },
];

export function modelChain(): string[] {
  const fromEnv = (process.env.GEMINI_MODEL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromEnv, ...FALLBACK_MODELS])];
}

export interface AIResult {
  data: unknown;
  model: string;
  ms: number;
  shape: string;
  attempts: string[];
}

export async function generateJSON(opts: {
  system: string;
  parts: Part[];
  schema: object;
  timeoutMs?: number;
}): Promise<AIResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new AIError("GEMINI_API_KEY missing", 503, "BillSahi isn't connected to its AI yet. Add GEMINI_API_KEY on the server.");
  }

  const started = Date.now();
  const attempts: string[] = [];
  let last: AIError | null = null;

  for (const model of modelChain()) {
    for (const shape of SHAPES) {
      const schemaText =
        shape.name === "jsonMode" ? `\n\nReturn only JSON matching this JSON Schema:\n${JSON.stringify(opts.schema)}` : "";
      const body = {
        systemInstruction: { parts: [{ text: opts.system + schemaText }] },
        contents: [{ role: "user", parts: opts.parts }],
        generationConfig: shape.config(opts.schema),
      };

      let res: Response;
      try {
        res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
        });
      } catch (e) {
        attempts.push(`${model}/${shape.name}: network ${(e as Error).name}`);
        last = new AIError(String(e), 504, "The AI took too long to answer. Try again in a moment.");
        break; // next model
      }

      if (res.ok) {
        const json = (await res.json()) as GeminiResponse;
        const text = (json.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("");
        const data = parseJsonLoose(text);
        if (data === undefined) {
          attempts.push(`${model}/${shape.name}: unparseable reply`);
          last = new AIError("unparseable", 502, "The AI's answer came back garbled. Try again.");
          continue;
        }
        attempts.push(`${model}/${shape.name}: ok`);
        return { data, model, ms: Date.now() - started, shape: shape.name, attempts };
      }

      const errText = await res.text().catch(() => "");
      attempts.push(`${model}/${shape.name}: HTTP ${res.status}`);

      if (res.status === 400 && /api key|API_KEY_INVALID/i.test(errText)) {
        throw new AIError(errText, 401, "The Gemini API key on the server is invalid.");
      }
      if (res.status === 403) {
        throw new AIError(errText, 403, "The Gemini API key doesn't have access. Check the key's project settings.");
      }
      if (res.status === 400 && /unknown name|invalid json payload|cannot find field|responseFormat|responseJsonSchema/i.test(errText)) {
        last = new AIError(errText, 400, "The AI rejected the request format.");
        continue; // try an older request shape on the same model
      }
      if (res.status === 429) {
        last = new AIError(errText, 429, "BillSahi has hit its free AI limit for now. Try again in a minute — or try a sample bill.");
      } else if (res.status === 404) {
        last = new AIError(errText, 502, "The AI model isn't available.");
      } else {
        last = new AIError(errText, 502, "The AI service had a problem. Try again in a moment.");
      }
      break; // next model
    }
  }

  console.error("[gemini] all attempts failed", attempts, last?.message?.slice(0, 500));
  throw last ?? new AIError("no attempts", 502, "The AI service is unavailable.");
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
}

export function parseJsonLoose(text: string): unknown {
  if (!text) return undefined;
  const stripped = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
