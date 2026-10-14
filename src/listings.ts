// TikTok listing pipeline.
//   1. TinyFish Search over tiktok.com (30-day window) finds listing videos.
//   2. The video ID encodes the upload time -> exact "posted X days ago" without opening the page.
//   3. TikTok's public oEmbed confirms the video is still up and returns the agent's real caption + thumbnail.
//      (TikTok blocks bots on video pages, so we never scrape them.)
//   4. TinyFish Fetch reads the agent's profile (allowed) for the phone/WhatsApp that captions hide behind "number in bio".
import { fetchPages, search, type SearchResult } from "./tinyfish";
import { findAreas, kindOf, moveIn, phonesIn, readPrice, type Kind, type Want } from "./lagos";

export interface Listing {
  id: string;
  url: string;
  handle: string;
  caption: string;
  summary?: string; // search-index summary (may paraphrase)
  thumbnail?: string;
  postedDays: number;
  areas: string[];
  kind?: Kind;
  rent?: number;
  total?: number;
  serviceCharge?: number;
  moveIn?: number;
  moveInStated: boolean;
  priceFrom: "caption" | "summary" | "none";
  phones: string[];
  agent?: { followers?: string; bioPhones: string[]; whatsapp?: string };
  deal: "rent" | "sale" | "shortlet";
  flags: string[];
  score: number;
}

const KIND_Q: Record<Kind, string> = {
  "self contain": "self contain",
  "mini flat": "mini flat",
  "2 bedroom": "2 bedroom flat",
  "3 bedroom": "3 bedroom flat",
  "4 bedroom": "4 bedroom",
  duplex: "duplex",
  any: "apartment",
};

const SHORTLET = /short[\s-]?let|per night|\/\s?night|nightly|per day|daily rate|airbnb|guest support|housekeeping|check[\s-]?in|night stay/i;
const SALE = /for sale|\bsale\b|selling|c of o\b|governor'?s consent|deed of assignment|outright|\bbuy\b|land for/i;
export function dealOf(text: string): Listing["deal"] {
  if (SHORTLET.test(text)) return "shortlet";
  if (SALE.test(text) && !/for rent|to let|to-let|per annum|yearly/i.test(text)) return "sale";
  return "rent";
}

export function videoId(url: string): string | undefined {
  return url.match(/\/video\/(\d{15,22})/)?.[1];
}

export function postedDaysAgo(id: string): number {
  const secs = Number(BigInt(id) >> 32n);
  return Math.max(0, Math.floor((Date.now() / 1000 - secs) / 86400));
}

export async function resolveTikTok(url: string): Promise<string> {
  // vm.tiktok.com / vt.tiktok.com short links redirect to the full video URL.
  if (videoId(url)) return url.split("?")[0];
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
    return r.url.split("?")[0];
  } catch {
    return url;
  }
}

export async function oembed(url: string): Promise<{ caption: string; thumbnail?: string; handle?: string } | null> {
  try {
    const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { title?: string; thumbnail_url?: string; author_unique_id?: string };
    if (d.title === undefined) return null;
    return { caption: d.title, thumbnail: d.thumbnail_url, handle: d.author_unique_id };
  } catch {
    return null;
  }
}

export async function agentProfiles(handles: string[]): Promise<Map<string, Listing["agent"]>> {
  const out = new Map<string, Listing["agent"]>();
  const pages = await fetchPages(handles.map((h) => `https://www.tiktok.com/@${h}`), { links: true, purpose: "Read a Lagos estate agent's TikTok bio for their phone/WhatsApp" });
  for (const h of handles) {
    const p = pages.get(`https://www.tiktok.com/@${h}`);
    if (!p) continue;
    const bio = `${p.description ?? ""}\n${(p.text ?? "").slice(0, 3000)}`;
    const wa = (p.links ?? []).map((l) => decodeURIComponent(l)).find((l) => /wa\.me|whatsapp/i.test(l));
    out.set(h, {
      followers: bio.match(/([\d.,]+[KM]?)\s*Followers/i)?.[1],
      bioPhones: phonesIn(bio),
      whatsapp: wa?.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)[^\s&"]*/i)?.[0],
    });
  }
  return out;
}

async function enrich(r: SearchResult, id: string): Promise<Listing | null> {
  const url = r.url.split("?")[0];
  const oe = await oembed(url);
  if (!oe) return null; // deleted or private
  const caption = oe.caption.trim();
  const summary = [r.title, r.snippet].filter(Boolean).join(" — ");
  const fromCaption = readPrice(caption);
  const fromSummary = readPrice(summary);
  const price = fromCaption.rent || fromCaption.total ? fromCaption : fromSummary;
  const text = `${caption}\n${summary}`;
  const mi = moveIn(price);
  return {
    id,
    url,
    handle: oe.handle ?? url.split("/")[3]?.replace("@", "") ?? "",
    caption,
    summary,
    thumbnail: oe.thumbnail,
    postedDays: postedDaysAgo(id),
    areas: findAreas(text),
    kind: kindOf(text),
    ...price,
    moveIn: mi.amount,
    moveInStated: mi.stated,
    priceFrom: fromCaption.rent || fromCaption.total ? "caption" : fromSummary.rent || fromSummary.total ? "summary" : "none",
    phones: phonesIn(caption),
    deal: dealOf(text),
    flags: [],
    score: 0,
  };
}

function scoreListing(l: Listing, w: Want): number {
  let s = 0;
  if (w.areas.length && l.areas.some((a) => w.areas.includes(a))) s += 40;
  else if (w.areas.length) s -= 30;
  if (w.kind !== "any" && l.kind === w.kind) s += 25;
  else if (w.kind !== "any" && l.kind) s -= 25;
  const price = l.rent ?? l.total;
  if (w.maxRent && price) s += price <= w.maxRent ? 20 : -40;
  if (price) s += 8;
  s += Math.max(0, 20 - l.postedDays); // fresher is better
  if (l.phones.length || l.agent?.bioPhones.length || l.agent?.whatsapp) s += 6;
  return s;
}

export async function findListings(w: Want, days = 30): Promise<{ listings: Listing[]; checked: number; dropped: number; overBudget: number; otherDeals: number }> {
  const kindQ = KIND_Q[w.kind];
  const deal = w.deal === "sale" ? "for sale" : w.deal === "shortlet" ? "shortlet" : "for rent";
  const areas = w.areas.length ? w.areas.slice(0, 3) : ["Lagos"];
  const queries = areas.flatMap((a) => [`${kindQ} ${deal} ${a} Lagos`, `${kindQ} ${deal} in ${a}`]);
  const results = (await Promise.all(queries.map((q) =>
    search({ query: q, include_domains: "tiktok.com", recency_minutes: days * 1440, purpose: "Find recent Lagos property listing videos posted by estate agents" }).catch(() => []),
  ))).flat();

  const seen = new Set<string>();
  const fresh = results.filter((r) => {
    const id = videoId(r.url);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return postedDaysAgo(id) <= days;
  });
  const enriched = (await Promise.all(fresh.slice(0, 24).map((r) => enrich(r, videoId(r.url)!)))).filter((x): x is Listing => !!x);
  const dropped = fresh.slice(0, 24).length - enriched.length;

  // Wrong kind of deal (a shortlet or a sale when you asked to rent) is a different market entirely.
  let pool = enriched.filter((l) => l.deal === w.deal);
  // Prices far off the pack are usually misreads (a sale price, a phone number) — keep the listing, drop the number.
  const ps = pool.map((l) => l.rent).filter((x): x is number => !!x).sort((a, b) => a - b);
  const med = ps.length >= 3 ? ps[Math.floor(ps.length / 2)] : undefined;
  for (const l of pool) {
    if (med && l.rent && (l.rent > med * 8 || l.rent < med / 20)) {
      l.rent = undefined; l.total = undefined; l.moveIn = undefined; l.priceFrom = "none";
    }
  }
  let overBudget = 0;
  if (w.maxRent) {
    pool = pool.filter((l) => {
      const p = l.rent ?? l.total;
      const ok = !p || p <= w.maxRent! * 1.1;
      if (!ok) overBudget++;
      return ok;
    });
  }
  for (const l of pool) l.score = scoreListing(l, w);
  let ranked = pool.sort((a, b) => b.score - a.score || a.postedDays - b.postedDays);
  // Drop clear mismatches (wrong area or wrong type).
  ranked = ranked.filter((l) => l.score > -20);

  // Agent contacts for the top few (one Fetch batch).
  const top = ranked.slice(0, 6);
  const profiles = await agentProfiles([...new Set(top.map((l) => l.handle))]).catch(() => new Map());
  for (const l of top) l.agent = profiles.get(l.handle);

  // Red flags relative to what else is on the market right now.
  const prices = ranked.map((l) => l.rent).filter((x): x is number => !!x).sort((a, b) => a - b);
  const median = prices.length >= 4 ? prices[Math.floor(prices.length / 2)] : undefined;
  for (const l of ranked) {
    if (median && l.rent && l.rent < median * 0.45) l.flags.push("much cheaper than similar posts — inspect before paying anything");
    if (/inspection fee|pay (?:before|to) inspect|transfer (?:to|before)|deposit to secure/i.test(l.caption)) l.flags.push("asks for money before inspection");
    const f = l.agent?.followers;
    if (f && !/[KM]/i.test(f) && Number(f.replace(/,/g, "")) < 300 && !l.agent?.bioPhones.length) l.flags.push("very small, new-looking account");
  }
  return { listings: ranked, checked: fresh.length, dropped, overBudget, otherDeals: enriched.length - enriched.filter((l) => l.deal === w.deal).length };
}
