// Ilé — Lagos house hunter on iMessage (Photon Spectrum + TinyFish).
import { existsSync, unlinkSync } from "node:fs";
import { Spectrum, richlink, type Space, type Message } from "spectrum-ts";
import { imessage, effect } from "spectrum-ts/providers/imessage";
import { handle, checkWatch, type Chat, type Item } from "./bot";
import { allWatches, markSeen, seenMessage } from "./store";
import { calls } from "./tinyfish";

type App = Awaited<ReturnType<typeof Spectrum>>;
let app: App;
const spaces = new Map<string, Space>();

function toContent(it: Item) {
  if ("link" in it) return richlink(it.link);
  if ("celebrate" in it) return effect(it.celebrate, imessage.effect.message.confetti);
  return it.text;
}

function chatFor(space: Space, message?: Message): Chat {
  return {
    id: space.id,
    async send(...items) {
      // One bubble per item so TikTok links unfurl into their own preview cards.
      for (const it of items) await space.send(toContent(it));
    },
    typing: (fn) => space.responding(fn),
    async ack() {
      await message?.react("👍").catch(() => {});
    },
  };
}

// Watches: re-check saved searches and text people first only when something new is posted.
const EVERY_MIN = Number(process.env.WATCH_EVERY_MINUTES ?? 30);
let watching = false;
async function runWatches(reason: string) {
  if (watching || !app) return;
  watching = true;
  console.log(`[watch] run (${reason}) for ${allWatches().length} watch(es)`);
  try {
    for (const w of allWatches()) {
      try {
        const space = spaces.get(w.chatId) ?? (await imessage(app).space.get(w.chatId));
        const ids = await checkWatch(chatFor(space), w.want, w.seen);
        markSeen(w, ids);
        console.log(`[watch] ${w.chatId}: ${ids.length ? `sent ${ids.length} new` : "nothing new, staying quiet"}`);
      } catch (e) {
        console.log(`[watch] ${w.chatId} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    watching = false;
  }
}
setInterval(() => runWatches("schedule"), EVERY_MIN * 60_000);
// Operator trigger (used for demos): `touch data/run-watches` re-checks immediately.
setInterval(() => {
  if (existsSync("data/run-watches")) {
    unlinkSync("data/run-watches");
    runWatches("manual trigger");
  }
}, 3000);

// The message stream can drop (network hiccups, proxies that cut long connections).
// Reconnect instead of dying; Spectrum replays anything missed while we were away.
async function serve() {
  for (let attempt = 0; ; attempt++) {
    try {
      app = await Spectrum({
        projectId: process.env.SPECTRUM_PROJECT_ID!,
        projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
        providers: [imessage.config()],
      });
      console.log(`Ilé is live${attempt ? ` (reconnect #${attempt})` : ""}. Watches run every ${EVERY_MIN} min.`);
      for await (const [space, message] of app.messages) {
        if (message.direction === "outbound" || message.content.type !== "text") continue;
        if (seenMessage(message.id)) continue; // replayed after a reconnect
        spaces.set(space.id, space);
        const text = message.content.text;
        console.log(`[in] ${space.id}: ${text}`);
        handle(chatFor(space, message), text)
          .catch(async (e) => {
            console.error("[error]", e);
            await space.send("Sorry, something went wrong on my side. Try again in a minute 🙏").catch(() => {});
          })
          .finally(() => console.log(`[tinyfish] totals`, calls));
      }
    } catch (e) {
      console.log(`[stream] dropped: ${(e as Error).message?.slice(0, 120)} — reconnecting in 3s`);
    }
    await app?.stop().catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
  }
}
serve();
