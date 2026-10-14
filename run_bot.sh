#!/bin/sh
# Start Ilé and keep it running: reads .env, appends logs to bot.log, restarts if the process ever exits.
# Runs under Node (gRPC streams are more reliable than under Bun, and Node honours https_proxy / NODE_EXTRA_CA_CERTS).
cd "$(dirname "$0")"
export WATCH_EVERY_MINUTES="${WATCH_EVERY_MINUTES:-15}"
[ -n "$HTTPS_PROXY" ] && export https_proxy="$HTTPS_PROXY" grpc_proxy="$HTTPS_PROXY"
while true; do
  node --env-file=.env --import tsx src/index.ts >> bot.log 2>&1
  echo "[supervisor] bot exited ($?), restarting in 3s" >> bot.log
  sleep 3
done
