#!/usr/bin/env bash
# Runs once, after the dev container is created or rebuilt.
#
# Everything here must be idempotent: "Rebuild Container" reruns it against
# volumes that already hold state from the previous container.
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> EPIChem post-create"

# ---------------------------------------------------------------- claude code
# The CLI is a global npm package, which lives in the container filesystem and
# is therefore lost on rebuild. The login is NOT — that is in the
# epichem-claude-config volume (see devcontainer.json).
npm install -g @anthropic-ai/claude-code

# ------------------------------------------------------------------- history
# HISTFILE points at the volume. Docker creates a new named volume's mount
# point owned by root, so chown must run BEFORE mkdir/touch — the node user
# has no write permission there until it does.
sudo chown -R node:node /commandhistory
mkdir -p /commandhistory
touch /commandhistory/.bash_history

# ----------------------------------------------------------------------- git
# The repo used to carry a local core.sshCommand pinning a key file
# (~/.ssh/id_ed25519_gitlab) that does not exist in this container — it printed
# a warning on every fetch and would have broken auth outright if the agent
# were ever unavailable. Authentication here is by forwarded SSH agent, which
# needs no -i flag at all, so drop the override if it is still present.
if git config --local --get core.sshCommand >/dev/null 2>&1; then
  git config --local --unset-all core.sshCommand
  echo "    removed stale core.sshCommand (auth is via forwarded SSH agent)"
fi

# ------------------------------------------------------------------- backend
# The venv is inside the workspace bind mount, so it survives rebuilds. Only
# create it if it is missing; reuse otherwise.
if [ ! -x backend/.venv/bin/python ]; then
  echo "    creating backend/.venv"
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install --quiet --upgrade pip
backend/.venv/bin/pip install --quiet -e "./backend[dev]"

# ------------------------------------------------------------------ frontend
if [ ! -d frontend/node_modules ]; then
  echo "    installing frontend dependencies"
  (cd frontend && npm ci)
fi

cat <<'EOF'

==> Ready.

    Whole stack (what you normally want):
        docker compose up

    Backend only, no Docker:
        backend/.venv/bin/pytest
        backend/.venv/bin/uvicorn epichem.api.app:app --reload

EOF
