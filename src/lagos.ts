// Lagos knowledge: areas, property types, naira amounts and the real cost of moving in.

export const AREAS: Record<string, string[]> = {
  "Lekki Phase 1": ["lekki phase 1", "lekki phase one", "lekki 1", "phase 1"],
  "Lekki": ["lekki"],
  "Ikate": ["ikate"],
  "Chevron": ["chevron"],
  "Osapa": ["osapa"],
  "Agungi": ["agungi"],
  "Jakande": ["jakande"],
  "Ikota": ["ikota"],
  "VGC": ["vgc"],
  "Sangotedo": ["sangotedo"],
  "Ajah": ["ajah", "abraham adesanya", "badore", "addo"],
  "Ibeju-Lekki": ["ibeju", "ibeju-lekki", "awoyaya"],
  "Victoria Island": ["victoria island", " vi ", "v.i", "oniru"],
  "Ikoyi": ["ikoyi"],
  "Yaba": ["yaba", "akoka", "sabo"],
  "Surulere": ["surulere", "ojuelegba", "aguda"],
  "Ebute Metta": ["ebute metta", "ebute-metta"],
  "Ikeja": ["ikeja", "allen", "opebi", "alausa", "oregun"],
  "Ikeja GRA": ["ikeja gra"],
  "Maryland": ["maryland", "anthony"],
  "Ilupeju": ["ilupeju", "palmgrove", "palm grove"],
  "Gbagada": ["gbagada"],
  "Ogudu": ["ogudu"],
  "Magodo": ["magodo"],
  "Ojodu": ["ojodu", "berger", "omole", "isheri"],
  "Ogba": ["ogba", "agege"],
  "Ketu": ["ketu", "ojota", "mile 12"],
  "Ikorodu": ["ikorodu"],
  "Isolo": ["isolo", "ago palace", "okota"],
  "Festac": ["festac", "amuwo", "amuwo odofin"],
  "Egbeda": ["egbeda", "idimu", "ikotun", "iyana ipaja", "ipaja"],
  "Ojo": ["ojo", "lasu"],
};

export type Kind = "self contain" | "mini flat" | "2 bedroom" | "3 bedroom" | "4 bedroom" | "duplex" | "any";

const KINDS: [Kind, RegExp][] = [
  ["self contain", /\b(self[\s-]?con(tain|tained)?|selfcon|single room|room self|studio)\b/i],
  ["mini flat", /\b(mini[\s-]?flat|1[\s-]?bed(room)?s?|one[\s-]?bed(room)?|room and parlou?r)\b/i],
  ["2 bedroom", /\b(2[\s-]?bed(room)?s?|two[\s-]?bed(room)?s?|2br)\b/i],
  ["3 bedroom", /\b(3[\s-]?bed(room)?s?|three[\s-]?bed(room)?s?|3br)\b/i],
  ["4 bedroom", /\b(4[\s-]?bed(room)?s?|four[\s-]?bed(room)?s?|5[\s-]?bed(room)?s?)\b/i],
  ["duplex", /\b(duplex|terrace|semi[\s-]?detached|detached)\b/i],
];

export interface Want {
  areas: string[];
  kind: Kind;
  maxRent?: number; // naira per year
  deal: "rent" | "sale" | "shortlet";
  raw: string;
}

/** "under 6m" / "5 million" / "₦4,500,000" / "800k" -> naira. */
export function naira(s: string): number | undefined {
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(m\b|mil\b|million|mn\b|k\b|thousand|b\b|billion)?/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = (m[2] ?? "").toLowerCase();
  if (u.startsWith("b")) return n * 1e9;
  if (u.startsWith("m")) return n * 1e6;
  if (u.startsWith("k") || u.startsWith("t")) return n * 1e3;
  return n;
}

export function fmt(n?: number): string {
  if (n === undefined) return "?";
  if (n >= 1e6) return `₦${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (n >= 1e3) return `₦${Math.round(n / 1e3)}k`;
  return `₦${n}`;
}

export function findAreas(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const hits = Object.entries(AREAS).filter(([, al]) => al.some((a) => t.includes(a.startsWith(" ") ? a : a))).map(([k]) => k);
  // "Lekki Phase 1" implies we don't also need the broader "Lekki" bucket.
  return hits.includes("Lekki Phase 1") ? hits.filter((h) => h !== "Lekki") : hits;
}

export function parseWant(text: string): Want | null {
  const areas = findAreas(text);
  const kindHit = KINDS.find(([, re]) => re.test(text));
  const deal = /\b(buy|sale|for sale|purchase)\b/i.test(text) ? "sale" : /\bshort[\s-]?let\b/i.test(text) ? "shortlet" : "rent";
  let maxRent: number | undefined;
  const b = text.match(/(?:under|below|less than|max(?:imum)?|budget(?: is| of)?|not more than|<|up to|within)\s*(?:₦|n|ngn)?\s*([\d.,]+\s*(?:m\b|mil\b|million|mn\b|k\b|thousand)?)/i)
    ?? text.match(/(?:₦|\bn)\s?([\d.,]+\s*(?:m\b|mil\b|million|mn\b|k\b)?)/i)
    ?? text.match(/\b([\d.,]+\s*(?:m|mil|million|mn|k))\b/i);
  if (b) {
    let v = naira(b[1]);
    if (v !== undefined && v < 1000) v *= 1e6; // "under 6" in Lagos rent talk means millions
    maxRent = v;
  }
  if (!areas.length && !kindHit && !maxRent) return null;
  return { areas, kind: kindHit?.[0] ?? "any", maxRent, deal, raw: text };
}

/** Pull the yearly rent (and any stated total package) out of a listing caption. */
export function readPrice(text: string): { rent?: number; total?: number; serviceCharge?: number } {
  const t = text.replace(/\s+/g, " ");
  const amt = String.raw`(?:₦|N|NGN|#)?\s?(\d[\d,]*(?:\.\d+)?)\s*(m\b|mil\b|million|mn\b|k\b|thousand)?`;
  const grab = (label: RegExp) => {
    const m = t.match(new RegExp(label.source + String.raw`\s*[:\-–=]?\s*(?:is\s*)?` + amt, "i"));
    if (!m) return undefined;
    let v = naira(`${m[m.length - 2]}${m[m.length - 1] ?? ""}`);
    if (v !== undefined && v < 1000) v *= 1e6;
    return v;
  };
  const total = grab(/\b(?:total(?: package)?|package|all[\s-]?in)/);
  const serviceCharge = grab(/\bservice charge/);
  let rent = grab(/\b(?:rent|price|asking|per annum|annual(?:ly)?)/);
  if (!rent) {
    // Fall back to the biggest plausible yearly figure that isn't a fee.
    const cands: number[] = [];
    for (const m of t.matchAll(new RegExp(amt, "gi"))) {
      const before = t.slice(Math.max(0, (m.index ?? 0) - 22), m.index).toLowerCase();
      if (/service|charge|agency|agent fee|legal|caution|inspection|commission|total|package|deposit/.test(before)) continue;
      if (!m[2] && !/[₦N#]/.test(m[0])) continue; // bare numbers are usually phone numbers or sizes
      let v = naira(`${m[1]}${m[2] ?? ""}`);
      if (v === undefined) continue;
      if (v < 1000 && m[2] === undefined) continue;
      if (v >= 150_000 && v <= 500_000_000) cands.push(v);
    }
    rent = cands.length ? Math.max(...cands) : undefined;
  }
  if (rent && total && total < rent) return { rent, serviceCharge };
  return { rent, total, serviceCharge };
}

/**
 * Lagos move-in cost: rent + agency (~10%) + legal/agreement (~10%) + caution/security deposit (~10%)
 * + service charge when stated. Agents quote these separately, so the sticker price is never what you pay.
 */
export function moveIn(p: { rent?: number; total?: number; serviceCharge?: number }): { amount?: number; stated: boolean } {
  if (p.total) return { amount: p.total, stated: true };
  if (!p.rent) return { stated: false };
  return { amount: Math.round(p.rent * 1.3 + (p.serviceCharge ?? 0)), stated: false };
}

export function kindOf(text: string): Kind | undefined {
  return KINDS.find(([, re]) => re.test(text))?.[0];
}

export const PHONE = /(?:\+?234[\s-]?|0)[789][01]\d[\s-]?\d{3}[\s-]?\d{4}/g;

export function phonesIn(text: string): string[] {
  return [...new Set((text.match(PHONE) ?? []).map((p) => p.replace(/[\s-]/g, "").replace(/^\+?234/, "0")))];
}

export function waLink(phone: string): string {
  return `https://wa.me/234${phone.replace(/^0/, "")}`;
}
