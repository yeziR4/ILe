// Tiny JSON-file store for conversation state and watches (enough for a single bot instance).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Listing } from "./listings";
import type { Want } from "./lagos";

const FILE = process.env.STORE_FILE ?? "data/store.json";
interface Session { want?: Want; results?: Listing[]; cursor?: number; seen?: string[] }
export interface Watch { chatId: string; want: Want; seen: string[]; created: number; lastRun?: number }
interface Store { sessions: Record<string, Session>; watches: Watch[] }

let db: Store = { sessions: {}, watches: [] };
try {
  if (existsSync(FILE)) db = JSON.parse(readFileSync(FILE, "utf8"));
} catch { /* start fresh */ }

function flush() {
  mkdirSync(FILE.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  writeFileSync(FILE, JSON.stringify(db));
}

export const getSession = (id: string): Session => (db.sessions[id] ??= {});
export function saveSession(id: string, s: Session) { db.sessions[id] = s; flush(); }
export function addWatch(chatId: string, want: Want, seen: string[]) {
  db.watches = db.watches.filter((w) => !(w.chatId === chatId && JSON.stringify(w.want) === JSON.stringify(want)));
  db.watches.push({ chatId, want, seen: [...seen], created: Date.now() });
  flush();
}
export function removeWatches(chatId: string): number {
  const before = db.watches.length;
  db.watches = db.watches.filter((w) => w.chatId !== chatId);
  flush();
  return before - db.watches.length;
}
export const allWatches = () => db.watches;
export function markSeen(w: Watch, ids: string[]) { w.seen = [...new Set([...w.seen, ...ids])]; w.lastRun = Date.now(); flush(); }
