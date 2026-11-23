import "server-only";

/**
 * Best-effort per-IP limiter so a public demo link can't burn the free AI quota.
 * In-memory, so each serverless instance counts on its own — good enough for a demo.
 */
const hits = new Map<string, number[]>();

export function allow(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
