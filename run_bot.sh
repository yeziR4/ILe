#!/bin/sh
# Start Ilé in the background-friendly way: reads .env, appends logs to bot.log.
cd "$(dirname "$0")"
export WATCH_EVERY_MINUTES="${WATCH_EVERY_MINUTES:-15}"
exec bun --env-file=.env src/index.ts >> bot.log 2>&1
