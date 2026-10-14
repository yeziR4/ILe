// Local test harness: `bun --env-file=.env src/cli.ts "2 bed in Lekki under 6m" "more" "1"`
import { handle, checkWatch, type Chat } from "./bot";
import { calls } from "./tinyfish";

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`;
const chat: Chat = {
  id: "cli",
  async send(...items) {
    for (const it of items) {
      if ("link" in it) console.log(`${stamp()} 🔗 ${it.link}`);
      else if ("celebrate" in it) console.log(`${stamp()} 🎉 ${it.celebrate}`);
      else console.log(`${stamp()} 💬 ${it.text.replace(/\n/g, "\n          ")}`);
    }
  },
  async typing(fn) { console.log(`${stamp()} …typing`); return fn(); },
  async ack() { console.log(`${stamp()} 👍 (tapback)`); },
};

for (const msg of process.argv.slice(2)) {
  console.log(`\n${stamp()} 🙋 ${msg}`);
  if (msg === "--watch") {
    const { getSession } = await import("./store");
    const s = getSession("cli");
    if (s.want) await checkWatch(chat, s.want, []);
    continue;
  }
  await handle(chat, msg);
}
// let background market checks finish
await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS ?? 0)));
console.log(`\n${stamp()} TinyFish calls:`, calls);
