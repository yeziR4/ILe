// Market pulse: what this week's TikTok listings say about an area, built from posts (not people).
import { findListings, type Listing } from "./listings";
import { fmt, type Want } from "./lagos";

export interface Pulse {
  listings: Listing[];
  priced: Listing[];
  agents: number;
  median?: number;
  low?: number;
  high?: number;
  shortlets: number;
}

function q(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export async function weekPulse(w: Want): Promise<Pulse> {
  const { listings, otherDeals } = await findListings({ ...w, maxRent: undefined }, 7);
  const priced = listings.filter((l) => l.rent).sort((a, b) => a.rent! - b.rent!);
  const prices = priced.map((l) => l.rent!);
  return {
    listings,
    priced,
    agents: new Set(listings.map((l) => l.handle)).size,
    median: prices.length ? q(prices, 0.5) : undefined,
    low: prices.length >= 4 ? q(prices, 0.2) : prices[0],
    high: prices.length >= 4 ? q(prices, 0.8) : prices[prices.length - 1],
    shortlets: otherDeals,
  };
}

export function pulseText(w: Want, p: Pulse): string {
  const what = w.kind === "any" ? "rentals" : `${w.kind}s`;
  const where = w.areas.length ? w.areas.join(" / ") : "Lagos";
  if (!p.listings.length) return `📊 No ${what} in ${where} posted on TikTok in the last 7 days that I could find. Try a nearby area.`;
  const lines = [
    `📊 ${where} · ${what} · last 7 days on TikTok`,
    `• ${p.listings.length} new listing${p.listings.length === 1 ? "" : "s"} from ${p.agents} agent${p.agents === 1 ? "" : "s"}`,
  ];
  if (p.median) lines.push(`• Typical asking rent: ${fmt(p.median)}${p.low && p.high && p.low !== p.high ? ` (most between ${fmt(p.low)} and ${fmt(p.high)})` : ""}`);
  lines.push(`• ${p.priced.length} of ${p.listings.length} posted the price — ${p.listings.length - p.priced.length} say "DM for price"`);
  if (p.median) lines.push(`• Budget about ${fmt(Math.round(p.median * 1.3))} to move in at the typical rent (agency, legal, caution)`);
  if (p.priced[0]) lines.push(`• Cheapest posted: ${fmt(p.priced[0].rent)} by @${p.priced[0].handle}`);
  return lines.join("\n");
}
