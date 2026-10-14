// Minimal TinyFish client (Search, Fetch, Agent) with a small in-memory cache.
const KEY = () => {
  const k = process.env.TINYFISH_API_KEY;
  if (!k) throw new Error("TINYFISH_API_KEY is not set");
  return k;
};
const cache = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await run();
  cache.set(key, { at: Date.now(), v });
  return v;
}

export const calls = { search: 0, fetch: 0, agent: 0 };
const log = (e: string, msg: string) => console.log(`[tinyfish:${e}] ${msg}`);

export interface SearchResult { url: string; title: string; snippet?: string; date?: string }

export function search(params: Record<string, string | number | undefined>): Promise<SearchResult[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  return cached(`s:${qs}`, 10 * 60_000, async () => {
    calls.search++;
    const r = await fetch(`https://api.search.tinyfish.ai?${qs}`, { headers: { "X-API-Key": KEY() } });
    if (!r.ok) throw new Error(`search ${r.status}`);
    const d = (await r.json()) as { results?: SearchResult[] };
    log("search", `"${params.query}" → ${d.results?.length ?? 0}`);
    return d.results ?? [];
  });
}

export interface FetchResult { url: string; final_url?: string; title?: string; description?: string; text?: string; links?: string[]; image_links?: string[] }

export async function fetchPages(urls: string[], opts: { links?: boolean; images?: boolean; purpose?: string } = {}): Promise<Map<string, FetchResult>> {
  const out = new Map<string, FetchResult>();
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const body = { urls: batch, format: "markdown", links: !!opts.links, image_links: !!opts.images, purpose: opts.purpose, per_url_timeout_ms: 40_000 };
    const res = await cached(`f:${JSON.stringify(body)}`, 6 * 3600_000, async () => {
      calls.fetch++;
      const r = await fetch("https://api.fetch.tinyfish.ai", {
        method: "POST",
        headers: { "X-API-Key": KEY(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const d = (await r.json()) as { results?: FetchResult[] };
      log("fetch", `${d.results?.length ?? 0}/${batch.length} pages`);
      return d.results ?? [];
    }).catch(() => [] as FetchResult[]);
    for (const x of res) out.set(x.url, x);
  }
  return out;
}

export function agent<T>(url: string, goal: string, maxSeconds = 170): Promise<T | null> {
  return cached(`a:${url}:${goal}`, 24 * 3600_000, async () => {
    calls.agent++;
    log("agent", `start ${url}`);
    const t = Date.now();
    const r = await fetch("https://agent.tinyfish.ai/v1/automation/run", {
      method: "POST",
      headers: { "X-API-Key": KEY(), "Content-Type": "application/json" },
      body: JSON.stringify({ url, goal, browser_profile: "stealth", agent_config: { max_duration_seconds: maxSeconds } }),
      signal: AbortSignal.timeout((maxSeconds + 60) * 1000),
    });
    if (!r.ok) throw new Error(`agent ${r.status}`);
    const d = (await r.json()) as { status: string; result: unknown };
    log("agent", `${d.status} in ${Math.round((Date.now() - t) / 1000)}s`);
    if (d.status !== "COMPLETED") return null;
    return unwrap<T>(d.result);
  }).catch((e) => { log("agent", `failed: ${(e as Error).message}`); return null; });
}

function unwrap<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (Array.isArray(raw) || (typeof raw === "object" && !("result" in (raw as object)))) return raw as T;
  const inner = (raw as { result: unknown }).result;
  if (typeof inner !== "string") return inner as T;
  const m = inner.match(/```(?:json)?\s*([\s\S]*?)```/) ?? inner.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  try { return m ? (JSON.parse(m[1]) as T) : null; } catch { return null; }
}
