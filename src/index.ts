// Ilé — Lagos house hunter on iMessage (Photon Spectrum + TinyFish).
import { Spectrum, richlink, type Space, type Message } from "spectrum-ts";
import { imessage, effect } from "spectrum-ts/providers/imessage";
import { handle, checkWatch, type Chat, type Item } from "./bot";
import { allWatches, markSeen } from "./store";
import { calls } from "./tinyfish";

const app = await Spectrum({
  projectId: process.env.SPECTRUM_PROJECT_ID!,
  projectSecret: process.env.SPECTRUM_PROJECT_SECRET!,
  providers: [imessage.config()],
});
const im = imessage(app);
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

// Watches: re-check saved searches and text people first when something new is posted.
const EVERY_MIN = Number(process.env.WATCH_EVERY_MINUTES ?? 30);
async function runWatches() {
  for (const w of allWatches()) {
    try {
      const space = spaces.get(w.chatId) ?? (await im.space.get(w.chatId));
      const ids = await checkWatch(chatFor(space), w.want, w.seen);
      markSeen(w, ids);
      if (ids.length) console.log(`[watch] sent ${ids.length} new to ${w.chatId}`);
    } catch (e) {
      console.log(`[watch] ${w.chatId} failed: ${(e as Error).message}`);
    }
  }
}
setInterval(runWatches, EVERY_MIN * 60_000);
console.log(`Ilé is live. Watches run every ${EVERY_MIN} min.`);

for await (const [space, message] of app.messages) {
  if (message.direction === "outbound" || message.content.type !== "text") continue;
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
