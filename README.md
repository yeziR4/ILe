# Ilé: your Lagos house hunter on iMessage

In Lagos, house hunting happens on TikTok. Agents post a 30-second video of a flat, and the price, area and phone number are scattered across the caption, the video and the agent's bio. Old posts never get taken down.

**Ilé is the friend you text instead of scrolling.** Tell it what you want and it texts back fresh listings from the last 30 days, with the agent's number, the real cost of moving in, and how the price compares with the market. Ask it to watch, and **it texts you first** when a new listing is posted.

Built with **[Photon Spectrum](https://photon.codes)** (iMessage) and **[TinyFish](https://tinyfish.ai)** Search, Fetch and Agent.

## What you can text it

| You text | Ilé texts back |
|---|---|
| `2 bed in Lekki under 6m` | The 3 best fresh TikTok listings: price, **move-in cost** (rent + agency, legal, caution), when it was posted, the agent's phone/WhatsApp, warnings. Each listing's TikTok link unfurls into a video preview. About 2 minutes later it follows up with a price check against Nigeria Property Centre. |
| `how much is a 2 bed in Lekki?` | A market pulse built from this week's listings: how many were posted, typical asking rent and range, how many hide the price, the cheapest one. |
| any TikTok listing link | A breakdown of that listing: price, move-in cost, the agent's contact from their bio, red flags, a fair-price verdict. |
| `watch` | It saves the search and **texts you first** (with confetti 🎉) when a matching listing is posted. `stop` cancels. |
| `more`, `1`, `2`… | The next results, or full details on one listing. |

## How TinyFish does the work

TikTok blocks bots on video pages, so Ilé never scrapes them. It uses each endpoint for the job it does best:

| Endpoint | What it does in Ilé |
|---|---|
| **Search** | Finds listing videos on `tiktok.com` for the area and property type, limited to the last 30 days (`recency_minutes`), or the last 7 days for market pulses and 3 days for watch alerts. |
| **Fetch** | Reads each agent's TikTok **profile page** for the phone/WhatsApp number that captions hide behind "number in bio", plus follower count. |
| **Agent** | Reads **Nigeria Property Centre**, which blocks plain fetching, in a real browser to get comparable listings and decide whether a price is a good deal, fair or too high. |

Alongside TinyFish:
- TikTok's public **oEmbed** endpoint confirms a video is still up and returns the agent's real caption and thumbnail.
- The **video ID** encodes the upload time, which gives the exact "posted 2 days ago" without opening the page.

## How Photon is used

`spectrum-ts` with the cloud iMessage provider:
- a 👍 **tapback** to acknowledge each request
- a **typing indicator** while TinyFish works
- **rich links**, so each TikTok listing unfurls as a video card
- a **confetti effect** on new-listing alerts
- **proactive messages**: watches re-check on a schedule and text the user first

## Lagos-specific logic

- Understands how people actually text: `self con`, `mini flat`, `room and parlour`, `under 6m`, `budget 800k`, and 30+ areas with their aliases (Abraham Adesanya → Ajah, Akoka → Yaba, Oniru → VI…).
- **Move-in cost**: Lagos rent is never what you pay. Ilé adds the usual ~10% agency, ~10% legal and ~10% caution (or uses the agent's stated "total package").
- Filters out shortlets and sales when you asked to rent, flags prices far below the pack ("inspect before paying anything") and captions asking for money before inspection.

## Run it

```bash
bun install
cp .env.example .env   # add your Photon project ID/secret and TinyFish key
bun --env-file=.env src/index.ts
```

Then text your Photon line. To try the conversation without iMessage:

```bash
bun --env-file=.env src/cli.ts "2 bed in Lekki under 6m" "more" "how much is a mini flat in Yaba?"
```

## Files

```
src/index.ts     Photon Spectrum transport: tapbacks, typing, rich links, effects, watch scheduler
src/bot.ts       Conversation logic (transport-independent)
src/listings.ts  TikTok pipeline: Search → video-ID dates → oEmbed → Fetch agent profiles → ranking & flags
src/pulse.ts     Weekly market pulse from listings
src/market.ts    Price check via TinyFish Agent on Nigeria Property Centre
src/lagos.ts     Areas, property types, naira parsing, move-in cost
src/store.ts     Sessions and watches (JSON file)
src/cli.ts       Local test harness
```

## Limits

- Photon's free plan uses a shared number that only replies to registered users. A dedicated number would be needed to open it to everyone.
- Some prices come from the search index's summary of the video rather than the caption; Ilé marks those "confirm with the agent".
- The property-site check uses a paid TinyFish Agent run (about 2 minutes) and is cached per area and property type for a day.
