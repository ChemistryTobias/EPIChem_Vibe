#!/bin/sh
# Seeds a registry with the example virtual lab so a fresh stack has something
# to show. Run as the one-shot `seed` service in compose.yaml, and by the CI
# `verify` stage before taking screenshots.
#
# THIS MUST BE IDEMPOTENT. It runs on every `docker compose up`, not just the
# first, and a seed step that fails on the second run turns "docker compose up"
# into "docker compose up, except when it doesn't work".
#
#   - `epichem import-dir` is already an upsert (see epichem/importer.py):
#     create, and on a natural-key conflict update the existing row instead.
#     Re-running it is safe and records a Revision only where something
#     actually changed.
#   - `epichem sample add` is NOT. It calls create_entity directly and exits 1
#     on a duplicate code, so each sample is guarded by an existence check.
set -eu

DESCRIPTORS_DIR="${DESCRIPTORS_DIR:-/descriptors}"

echo "==> importing descriptors from ${DESCRIPTORS_DIR}"
epichem import-dir --descriptors-dir "${DESCRIPTORS_DIR}"

# Add a sample only if its code is absent. Deliberately fixed codes and values,
# not generated ones: docs/MILESTONE_CI_CD.md §5 wants screenshots that only
# change when the UI changes, and randomised sample IDs would make every
# screenshot diff noise.
add_sample() {
    code="$1"
    shift
    if epichem sample list | grep -q -- "${code}"; then
        echo "    sample ${code} already present"
    else
        epichem sample add "${code}" "$@"
    fi
}

echo "==> seeding samples"
add_sample SMP-2026-0001 "PEDOT:PSS film" \
    --substance "PEDOT:PSS" --amount 1.5 --unit mL --location RACK-A/3
add_sample SMP-2026-0002 "P3HT solution" \
    --substance "P3HT" --amount 5 --unit mL --location RACK-A/4
add_sample SMP-2026-0003 "Perovskite precursor" \
    --substance "MAPbI3" --amount 2.5 --unit mL --location RACK-B/1

echo "==> seed complete"
