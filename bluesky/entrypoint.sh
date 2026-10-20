#!/bin/sh
# One station pod: RE Manager (+ its worker) and the HTTP server in front of it.
# Redis is a separate container (REDIS_ADDR). See docs/BLUESKY.md.
set -eu

STARTUP_DIR="${STARTUP_DIR:-/pod/startup}"
REDIS_ADDR="${REDIS_ADDR:-redis:6379}"
: "${QSERVER_HTTP_SERVER_SINGLE_USER_API_KEY:?set an API key (letters and digits only)}"

# The plan/device list the manager validates against is generated from the
# profile itself, every start -- edit a plan, restart the pod, and EPIChem's
# palette follows. Never hand-edit this file.
qserver-list-plans-devices --startup-dir "$STARTUP_DIR" --file-dir "$STARTUP_DIR" \
  --file-name existing_plans_and_devices.yaml

start-re-manager \
  --startup-dir "$STARTUP_DIR" \
  --redis-addr "$REDIS_ADDR" \
  --keep-re \
  --zmq-publish-console ON &
MANAGER=$!

# Open the worker environment once the manager answers, so the station is
# ready to run as soon as EPIChem dispatches to it.
(
  for _ in $(seq 1 60); do
    if qserver status >/dev/null 2>&1; then
      qserver environment open && exit 0
    fi
    sleep 1
  done
  echo "RE Manager did not come up; environment left closed" >&2
) &

exec uvicorn --host 0.0.0.0 --port 60610 bluesky_httpserver.server:app
