#!/usr/bin/env bash
# Ensure `yamllint` is on PATH, install it via pip --user if not, then run it
# against the repo root. Designed to be portable across:
#   - real `ubuntu-latest` GHA runners (yamllint not pre-installed; --user
#     installs are whitelisted; ~/.local/bin pre-added to PATH)
#   - catthehacker/ubuntu (used by `act` locally; Ubuntu 24.04 / Python 3.12
#     enforces PEP 668 — hence --break-system-packages — and runs as root, so
#     ~/.local/bin is not on PATH by default).
#
# Cache: the GHA workflow caches ~/.local keyed on the hash of the requirements
# file below. When the cache hits, `yamllint` is already on disk under
# ~/.local/bin, so the install branch is skipped on the second run onwards.
#
# Version + integrity are pinned in infrastructure/requirements-yamllint.txt,
# installed with `pip install --require-hashes` so pip refuses any artefact —
# yamllint or a transitive dep (pathspec, PyYAML) — whose sha256 isn't listed
# there (A-327). A bare `pip install yamllint==X` trusts whatever PyPI serves;
# this does not. Regenerate the requirements file when bumping the version (see
# its header); the ci.yml `yaml-lint` cache key is keyed on this file's hash, so
# regenerating it busts the cache automatically — there's no separate version to
# keep in sync.
#
# Confinement: this script (and the bats/actionlint bootstraps) must never be
# added to the `release` / `publish-github-packages` jobs — they run only in
# read-scoped CI jobs with no publish credential, which is what keeps a
# compromised upstream from reaching the npm/GitHub Packages identity.
#
# Env:
#   YAMLLINT_REQUIREMENTS — path to the hash-locked requirements file
#                           (default: ../requirements-yamllint.txt next to this
#                           script). Overridable for tests.
#   GITHUB_PATH           — set by GHA; the export propagates ~/.local/bin to
#                           subsequent steps. Local invocations leave it unset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YAMLLINT_REQUIREMENTS="${YAMLLINT_REQUIREMENTS:-$SCRIPT_DIR/../requirements-yamllint.txt}"

if ! command -v yamllint >/dev/null 2>&1; then
  pip install --user --break-system-packages --require-hashes -r "$YAMLLINT_REQUIREMENTS"
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$HOME/.local/bin" >> "$GITHUB_PATH"
  fi
  export PATH="$HOME/.local/bin:$PATH"
fi

yamllint .
