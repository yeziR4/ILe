// "Is this price fair?" — TinyFish Agent reads comparable listings on Nigeria Property Centre.
// That site blocks plain fetching, so it needs a real (stealth) browser; results are cached for a day.
import { agent } from "./tinyfish";
import { naira, type Kind } from "./lagos";

const LEKKI_SUBS = new Set(["Ikate", "Chevron", "Osapa", "Agungi", "Ikota", "VGC", "Jakande", "Lekki Phase 1", "Sangotedo"]);
const IKEJA_SUBS = new Set(["Ikeja GRA"]);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function npcUrl(area: string, kind: Kind): string {
  const path = LEKKI_SUBS.has(area) ? `lekki/${slug(area)}` : IKEJA_SUBS.has(area) ? `ikeja/${slug(area)}` : slug(area);
  const beds: Partial<Record<Kind, number>> = { "self contain": 1, "mini flat": 1, "2 bedroom": 2, "3 bedroom": 3, "4 bedroom": 4, duplex: 4 };
  const type = kind === "duplex" || kind === "4 bedroom" ? "houses" : "flats-apartments";
  const b = beds[kind];
  return `https://nigeriapropertycentre.com/for-rent/${type}/lagos/${path}/showtype${b ? `?bedrooms=${b}` : ""}`;
}

export interface Market { area: string; kind: Kind; count: number; median: number; low: number; high: number; source: string }

export async function marketPrice(area: string, kind: Kind): Promise<Market | null> {
  const url = npcUrl(area, kind);
  const rows = await agent<{ price?: string; title?: string }[]>(
    url,
    `This is a Nigeria Property Centre results page for ${kind === "any" ? "" : kind + " "}rentals in ${area}, Lagos. Close any popup. ` +
      `If the page shows no results, use the site's search to find ${kind} for rent in ${area}, Lagos. ` +
      `Read up to 12 listings and return ONLY a JSON array of {"title","price"} where price is the yearly rent exactly as shown.`,
  );
  const prices = (rows ?? [])
    .map((r) => {
      if (!r?.price || /per (day|night|week|month)|\/(day|night|month)/i.test(r.price)) return undefined;
      let v = naira(r.price);
      if (v !== undefined && v < 1000) v *= 1e6;
      return v;
    })
    .filter((v): v is number => !!v && v >= 100_000 && v <= 500_000_000)
    .sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const q = (p: number) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  return { area, kind, count: prices.length, median: q(0.5), low: q(0.2), high: q(0.8), source: "Nigeria Property Centre" };
}

export function verdict(price: number, m: Market): string {
  const r = price / m.median;
  if (r < 0.5) return "⚠️ way below market — be careful";
  if (r < 0.85) return "✅ good deal";
  if (r <= 1.15) return "👌 fair price";
  if (r <= 1.5) return "📈 above average";
  return "💸 pricey for the area";
}
