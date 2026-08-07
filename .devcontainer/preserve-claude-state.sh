#!/usr/bin/env bash
#
#   RUN THIS ON YOUR HOST MACHINE, NOT INSIDE THE DEV CONTAINER.
#
# Carries Claude Code's state — login, conversation transcripts, memory files —
# across the dev container rebuild that renames its config volume.
#
# WHY THIS IS NEEDED, ONCE:
#
# devcontainer.json used to mount `claude-code-config-${devcontainerId}`. That
# id is derived from the container's identifying labels, so it changes when the
# workspace is opened by a different path or the container is recreated — and
# when it changes Docker does not error, it mounts a NEW EMPTY VOLUME. That was
# one of three causes of state loss on rebuild (commit 69aa945).
#
# The fix pins the name to a literal. The cost is exactly one migration: the
# next rebuild switches to the new volume, leaving the old one behind, intact
# but unmounted. This script copies it across.
#
# Running it inside the dev container CANNOT work: after the rebuild that
# container has its own nested Docker daemon, which has a completely separate
# volume namespace and cannot see the host's volumes at all.
#
# Safe to run more than once, but it OVERWRITES same-named files in the
# destination, so don't run it after doing real work in a fresh volume.
set -euo pipefail

OLD_VOLUME="${OLD_VOLUME:-claude-code-config-177m86mlann63cgq426iictpqga63dq45efgff62m5g7uhk0v78l}"
NEW_VOLUME="${NEW_VOLUME:-epichem-claude-config}"

if [ -f /.dockerenv ]; then
    echo "ERROR: this is running inside a container." >&2
    echo "       Run it from a terminal on your own machine instead." >&2
    exit 1
fi

if ! docker volume inspect "$OLD_VOLUME" >/dev/null 2>&1; then
    echo "ERROR: source volume '$OLD_VOLUME' not found." >&2
    echo >&2
    echo "Find the right one with:  docker volume ls | grep claude" >&2
    echo "Then re-run:              OLD_VOLUME=<name> $0" >&2
    exit 1
fi

echo "==> copying $OLD_VOLUME -> $NEW_VOLUME"
docker volume create "$NEW_VOLUME" >/dev/null

# `cp -a` preserves the 0600 modes on .credentials.json. Both volumes are
# mounted into a throwaway container, so nothing is written to the host
# filesystem and no secret is ever copied into the repo.
docker run --rm \
    -v "$OLD_VOLUME":/from:ro \
    -v "$NEW_VOLUME":/to \
    alpine sh -c 'cp -a /from/. /to/ && ls -la /to | head -20'

cat <<EOF

==> Done. Now rebuild the dev container:
        Command Palette -> "Dev Containers: Rebuild Container"

    Afterwards you should still be logged in, and \`history\` should still
    show your old commands. If not, see docs/SESSION_HANDOFF.md §5 — nothing
    is lost either way, that file and docs/HOST_SETUP.md hold the state that
    matters.
EOF
