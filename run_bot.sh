#!/bin/sh
# Start Ilé: reads .env, appends logs to bot.log. Runs under Node (gRPC streams are more reliable than under Bun,
# and Node honours https_proxy / NODE_EXTRA_CA_CERTS when the host sits behind a proxy).
cd "$(dirname "$0")"
export WATCH_EVERY_MINUTES="${WATCH_EVERY_MINUTES:-15}"
[ -n "$HTTPS_PROXY" ] && export https_proxy="$HTTPS_PROXY" grpc_proxy="$HTTPS_PROXY"
exec node --env-file=.env --import tsx src/index.ts >> bot.log 2>&1
