// Conversation logic, independent of the transport (iMessage via Spectrum, or the local CLI).
import { findListings, oembed, agentProfiles, resolveTikTok, videoId, postedDaysAgo, dealOf, type Listing } from "./listings";
import { fmt, moveIn, parseWant, readPrice, findAreas, kindOf, phonesIn, waLink, type Want } from "./lagos";
import { marketPrice, verdict, type Market } from "./market";
import { addWatch, removeWatches, getSession, saveSession, hasWatch } from "./store";
import { weekPulse, pulseText } from "./pulse";

export type Item = { text: string } | { link: string } | { celebrate: string };
export interface Chat {
  id: string;
  send(...items: Item[]): Promise<void>;
  typing<T>(fn: () => Promise<T>): Promise<T>;
  ack(): Promise<void>; // quick tapback on the user's message
}

const t = (text: string): Item => ({ text });
const link = (url: string): Item => ({ link: url });

const HELP =
  "Hey 👋 I'm Ilé, your Lagos house hunter.\n\n" +
  "Text me what you want, like:\n" +
  "• 2 bed in Lekki under 6m\n" +
  "• mini flat Yaba or Akoka, max 2.5m\n" +
  "• self con Ikeja\n\n" +
  "I search fresh TikTok listings from Lagos agents (last 30 days), find the agent's number, work out what you'll actually pay to move in, and check the price against the market.\n\n" +
  "Ask the market: \"how much is a 2 bed in Lekki?\"\n" +
  "Send me any TikTok listing link and I'll check it. Say \"watch\" and I'll text you the moment a new one is posted.";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ago = (d: number) => (d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const cleanCaption = (c: string) => c.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();

function contactLine(l: Listing): string | undefined {
  const phone = l.phones[0] ?? l.agent?.bioPhones[0];
  if (phone) return `📞 ${phone.replace(/(\d{4})(\d{3})(\d{4})/, "$1 $2 $3")} (call or WhatsApp)`;
  if (l.agent?.whatsapp) return "💬 WhatsApp link in their TikTok bio";
  return "📞 number's in their TikTok bio";
}

export function card(l: Listing, n: number): string {
  const where = l.areas[0] ?? "Lagos";
  const what = l.kind ? l.kind.replace(/^\w/, (c) => c.toUpperCase()) : "Listing";
  const lines = [`${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"][n] ?? `${n + 1}.`} ${what} · ${where}`];
  const price = l.rent ?? l.total;
  if (l.total && !l.rent) lines.push(`💰 ${fmt(l.total)} total package (as posted)`);
  else if (price) lines.push(`💰 ${fmt(l.rent)}/yr → about ${fmt(l.moveIn)} to move in${l.moveInStated ? " (as posted)" : " (rent + agency, legal & caution)"}`);
  else lines.push("💰 price not stated — ask the agent");
  if (l.priceFrom === "summary") lines.push("   ↳ price read from the video, confirm with the agent");
  const fol = l.agent?.followers ? ` (${l.agent.followers} followers)` : "";
  lines.push(`🕒 posted ${ago(l.postedDays)} by @${l.handle}${fol}`);
  const c = contactLine(l);
  if (c) lines.push(c);
  for (const f of l.flags) lines.push(`⚠️ ${f}`);
  return lines.join("\n");
}

function describeWant(w: Want): string {
  const what = w.kind === "any" ? "places" : `${w.kind}${w.kind.endsWith("contain") || w.kind.endsWith("flat") ? "s" : "s"}`;
  const where = w.areas.length ? ` in ${w.areas.join(" / ")}` : " in Lagos";
  const budget = w.maxRent ? ` under ${fmt(w.maxRent)}` : "";
  return `${what}${where}${budget}`;
}

async function sendPage(chat: Chat, listings: Listing[], from: number) {
  const page = listings.slice(from, from + 3);
  for (let i = 0; i < page.length; i++) {
    await chat.send(t(card(page[i], from + i)), link(page[i].url));
  }
  const left = listings.length - (from + page.length);
  const s = getSession(chat.id);
  const offerWatch = from === 0 && !hasWatch(chat.id);
  if (offerWatch) { s.pending = "watch"; saveSession(chat.id, s); }
  await chat.send(t([
    left > 0 ? `Reply "more" for ${Math.min(3, left)} more, or a number (like "1") for details and a message to the agent.` : "That's everything fresh right now.",
    offerWatch ? "Want me to keep looking for you? Reply \"yes\" and I'll text you only when a new match is posted." : "",
  ].filter(Boolean).join("\n\n")));
}

function checkTarget(w: Want, listings: Listing[]) {
  const kind = w.kind !== "any" ? w.kind : listings.find((l) => l.kind && l.rent)?.kind;
  const area = w.areas[0] ?? listings[0]?.areas[0];
  return kind && area && w.deal === "rent" ? { kind, area } : null;
}

async function marketFollowUp(chat: Chat, w: Want, listings: Listing[]) {
  const target = checkTarget(w, listings);
  if (!target) return;
  const { kind, area } = target;
  const m = await marketPrice(area, kind).catch(() => null);
  if (!m) return chat.send(t(`📊 I couldn't get a clean price comparison for ${kind}s in ${area} from the property sites right now, so I won't guess.`));
  const lines = [`📊 Price check: ${plural(m.count, `${kind} listing`)} in ${area} on ${m.source} ask ${fmt(m.low)}–${fmt(m.high)} (typical ${fmt(m.median)}).`];
  listings.slice(0, 3).forEach((l, i) => {
    const p = l.rent;
    if (p && l.kind === kind) lines.push(`${i + 1}️⃣ ${fmt(p)}: ${verdict(p, m)}`);
  });
  await chat.send(t(lines.join("\n")));
}

export async function runSearch(chat: Chat, w: Want, opts: { quietIfEmpty?: boolean } = {}) {
  const { listings, overBudget, otherDeals } = await chat.typing(() => findListings(w));
  const s = getSession(chat.id);
  s.want = w;
  s.results = listings;
  s.cursor = 3;
  s.seen = [...new Set([...(s.seen ?? []), ...listings.map((l) => l.id)])];
  saveSession(chat.id, s);
  if (!listings.length) {
    if (!opts.quietIfEmpty) await chat.send(t(`I couldn't find fresh TikTok listings for ${describeWant(w)} in the last 30 days 😕 Try a nearby area or a bigger budget, or say "watch" and I'll keep looking.`));
    return;
  }
  const skipped = [overBudget && `${overBudget} over budget`, otherDeals && `${otherDeals} ${w.deal === "rent" ? "shortlets/sales" : "other listings"}`].filter(Boolean).join(", ");
  await chat.send(t(`🏠 Found ${plural(listings.length, "fresh listing")} for ${describeWant(w)}, all posted on TikTok in the last 30 days${skipped ? ` (skipped ${skipped})` : ""}. Best ${Math.min(3, listings.length)}:`));
  await sendPage(chat, listings, 0);
  const target = checkTarget(w, listings);
  if (target) {
    await chat.send(t(`📊 Checking what ${target.kind}s in ${target.area} actually go for on property sites… (about 2 min)`));
    marketFollowUp(chat, w, listings).catch(() => {});
  }
}

async function checkLink(chat: Chat, raw: string) {
  const url = await resolveTikTok(raw);
  const id = videoId(url);
  const oe = id ? await oembed(url) : null;
  if (!id || !oe) {
    await chat.send(t("I couldn't open that TikTok — it may be deleted or private."));
    return;
  }
  const handle = oe.handle ?? url.split("/")[3]?.replace("@", "") ?? "";
  const profiles = await agentProfiles([handle]).catch(() => new Map());
  const price = readPrice(oe.caption);
  const mi = moveIn(price);
  const kind = kindOf(oe.caption);
  const areas = findAreas(oe.caption);
  const l: Listing = {
    id, url, handle, caption: oe.caption, postedDays: postedDaysAgo(id), areas, kind, ...price,
    moveIn: mi.amount, moveInStated: mi.stated, priceFrom: price.rent || price.total ? "caption" : "none",
    phones: phonesIn(oe.caption), agent: profiles.get(handle), deal: dealOf(oe.caption), flags: [], score: 0,
  };
  if (/inspection fee|pay (?:before|to) inspect|transfer (?:to|before)/i.test(oe.caption)) l.flags.push("asks for money before inspection");
  if (l.postedDays > 60) l.flags.push(`posted ${l.postedDays} days ago — may already be taken`);
  if (l.deal === "shortlet") l.flags.push("this looks like a shortlet — the price is probably per night, not per year");
  const body = [`Here's what I found on that listing:`, "", card(l, 0).replace(/^1️⃣ /, "🏠 "), "", `Caption: “${cleanCaption(oe.caption).slice(0, 220)}”`];
  await chat.send(t(body.join("\n")));
  if (kind && areas[0] && l.rent && l.deal === "rent") {
    await chat.send(t(`📊 Checking ${kind} prices in ${areas[0]} on property sites… (about 2 min)`));
    const m = await marketPrice(areas[0], kind).catch(() => null);
    if (m) await chat.send(t(`📊 ${fmt(l.rent)} vs typical ${fmt(m.median)} for a ${kind} in ${areas[0]} (${fmt(m.low)}–${fmt(m.high)}, ${m.count} listings on ${m.source}): ${verdict(l.rent, m)}`));
  }
}

export async function handle(chat: Chat, text: string) {
  const msg = text.trim();
  const low = msg.toLowerCase();
  const s = getSession(chat.id);

  const tiktok = msg.match(/https?:\/\/(?:www\.|vm\.|vt\.|m\.)?tiktok\.com\/\S+/i);
  if (tiktok) {
    await chat.ack();
    await chat.typing(() => checkLink(chat, tiktok[0]));
    return;
  }
  if (/^(yes|yeah|yh|yep|ok|okay|sure|please|pls|go ahead)\b/.test(low) && s.pending) {
    const what = s.pending;
    s.pending = undefined;
    saveSession(chat.id, s);
    if (what === "watch" && s.want) {
      addWatch(chat.id, s.want, s.seen ?? []);
      await chat.ack();
      return chat.send(t(`👀 Done. I'm watching for new ${describeWant(s.want)}. I'll stay quiet until a new one is posted, then text you straight away. Say "stop" anytime.`));
    }
    if (what === "show-new" && s.fresh?.length) {
      const fresh = s.fresh;
      s.results = fresh; s.cursor = 3; s.seen = [...new Set([...(s.seen ?? []), ...fresh.map((l) => l.id)])]; s.fresh = undefined;
      saveSession(chat.id, s);
      return sendPage(chat, fresh, 0);
    }
  }
  if (/^(hi+|hello|hey+|help|start|menu|good (morning|afternoon|evening)|\?)\b/.test(low) && !parseWant(msg)?.areas.length) {
    const away = s.lastVisit ? Date.now() - s.lastVisit : 0;
    s.lastVisit = Date.now();
    saveSession(chat.id, s);
    if (s.want && away > 30 * 60_000) {
      // Remember them: re-run their last search and say what changed.
      const { listings } = await chat.typing(() => findListings(s.want!, 7));
      const fresh = listings.filter((l) => !(s.seen ?? []).includes(l.id));
      s.fresh = fresh;
      s.pending = fresh.length ? "show-new" : undefined;
      saveSession(chat.id, s);
      return chat.send(t(fresh.length
        ? `Welcome back 👋 Still looking for ${describeWant(s.want)}? ${plural(fresh.length, "new listing")} since you last checked. Want to see them? Reply "yes".`
        : `Welcome back 👋 Nothing new for ${describeWant(s.want)} since you last checked. Tell me if your search has changed.`));
    }
    await chat.send(t(HELP));
    return;
  }
  s.lastVisit = Date.now();
  if (/^(more|next|show more)\b/.test(low)) {
    if (!s.results?.length) return chat.send(t("Tell me what you're looking for first, e.g. \"2 bed in Lekki under 6m\"."));
    const from = s.cursor ?? 3;
    if (from >= s.results.length) return chat.send(t("That's all I have for now. Say \"watch\" and I'll text you new ones."));
    s.cursor = from + 3;
    saveSession(chat.id, s);
    return sendPage(chat, s.results, from);
  }
  const num = low.match(/^#?(\d)$/);
  if (num && s.results?.length) {
    const l = s.results[Number(num[1]) - 1];
    if (!l) return chat.send(t(`I only have ${s.results.length} results right now.`));
    await chat.send(t(`${card(l, Number(num[1]) - 1)}\n\nCaption: “${cleanCaption(l.caption).slice(0, 300)}”\n\nTip: inspect before you pay anything, and ask for the agency, legal and caution fees in writing.`), link(l.url));
    const phone = l.phones[0] ?? l.agent?.bioPhones[0];
    if (phone) {
      const draft = `Hi, I saw your ${l.kind ?? "listing"}${l.areas[0] ? ` in ${l.areas[0]}` : ""} on TikTok (${l.url}). Is it still available, and when can I inspect?`;
      await chat.send(t("✍️ I drafted a message to the agent. I won't send anything for you: tap to open it in WhatsApp, check it, and send it yourself."),
        link(`https://wa.me/234${phone.replace(/^0/, "")}?text=${encodeURIComponent(draft)}`));
    }
    return;
  }
  if (/^(watch|alert|notify|keep (looking|searching)|tell me|text me)\b/.test(low) || /^(yes|yeah|ok|okay|sure)\b.*\b(keep (looking|searching)|watch|text me|notify|alert)\b/.test(low)) {
    const w = parseWant(msg) ?? s.want;
    if (!w) return chat.send(t("What should I watch for? e.g. \"watch 2 bed Lekki under 6m\""));
    addWatch(chat.id, w, s.seen ?? []);
    await chat.ack();
    return chat.send(t(`👀 Watching for new ${describeWant(w)}. I'll text you as soon as an agent posts one. Say "stop" to cancel.`));
  }
  if (/^(stop|cancel|unwatch)\b/.test(low)) {
    const n = removeWatches(chat.id);
    return chat.send(t(n ? "Done, I've stopped watching. Text me anytime." : "You don't have any watches running."));
  }
  if (/\b(market|how much (is|are|for|does)|average|typical|price check|going rate|what do .* go for)\b/i.test(low)) {
    const mw = parseWant(msg);
    if (!mw?.areas.length) return chat.send(t("Which area? e.g. \"how much is a 2 bed in Lekki?\""));
    await chat.ack();
    const p = await chat.typing(() => weekPulse(mw));
    await chat.send(t(pulseText(mw, p)));
    if (p.priced[0]) await chat.send(link(p.priced[0].url));
    if (mw.kind !== "any" && p.median) {
      await chat.send(t(`Checking how that compares with property sites… (about 2 min)`));
      marketPrice(mw.areas[0], mw.kind).then((m) => m && chat.send(t(
        `🏷️ On ${m.source}, ${m.count} ${mw.kind} listings in ${mw.areas[0]} ask ${fmt(m.low)}–${fmt(m.high)} (typical ${fmt(m.median)}). ` +
        (p.median! < m.median * 0.85 ? "TikTok agents are listing cheaper than the property sites right now." : p.median! > m.median * 1.15 ? "TikTok listings are pricier than the property sites right now." : "TikTok and the property sites agree on price."),
      ))).catch(() => {});
    }
    return;
  }
  const w = parseWant(msg);
  if (!w) return chat.send(t(HELP));
  if (w.deal !== "rent") {
    await chat.send(t(`I'm best at rentals right now, but I'll look for ${w.deal === "sale" ? "properties for sale" : "shortlets"} too.`));
  }
  await chat.ack();
  await runSearch(chat, w);
}

/** Watch loop: re-run each saved search and text only listings the user hasn't seen. */
export async function checkWatch(chat: Chat, w: Want, seen: string[]): Promise<string[]> {
  const { listings } = await findListings(w, 3);
  const fresh = listings.filter((l) => !seen.includes(l.id) && (!w.maxRent || (l.rent ?? l.total ?? 0) <= w.maxRent) && l.score > 20);
  if (!fresh.length) return [];
  const n = fresh.slice(0, 3);
  await chat.send({ celebrate: `🔔 ${n.length === 1 ? "New listing just posted" : `${n.length} new listings just posted`} for ${describeWant(w)}!` });
  for (let i = 0; i < n.length; i++) await chat.send(t(card(n[i], i)), link(n[i].url));
  const s = getSession(chat.id);
  s.results = n;
  s.cursor = 3;
  saveSession(chat.id, s);
  return n.map((l) => l.id);
}
