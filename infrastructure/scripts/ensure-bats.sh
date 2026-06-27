#!/usr/bin/env bash
# Ensure the pinned `bats` is on PATH, installing bats-core from its GitHub
# release tarball under $HOME/.local if absent or at the wrong version. The
# GHA workflow caches $HOME/.local on the version key so the install branch
# is skipped on subsequent runs.
#
# Why pin: bats-core has had breaking syntax changes between majors. The
# previous `apt-get install -y bats` floated with the Ubuntu mirror and
# could break CI between green runs. A-169.
#
# Integrity: the downloaded release tarball is verified against a pinned sha256
# before extraction (A-327), so a tampered or swapped archive can't execute
# install.sh. Update BATS_SHA256 in lockstep with BATS_VERSION.
#
# Confinement: this script (and the yamllint/actionlint bootstraps) must never
# be added to the `release` / `publish-github-packages` jobs — they run only in
# read-scoped CI jobs with no publish credential, which is what keeps a
# compromised upstream from reaching the npm/GitHub Packages identity.
#
# Env:
#   BATS_VERSION  — pinned version (default 1.13.0). Match the cache key in
#                   .github/workflows/ci.yml when bumping.
#   BATS_SHA256   — pinned sha256 of the v$BATS_VERSION source tarball. Set
#                   empty to skip the check (tests).
#   GITHUB_PATH   — set by GHA; the export propagates $HOME/.local/bin to
#                   subsequent steps. Local invocations leave it unset.

set -euo pipefail

BATS_VERSION="${BATS_VERSION:-1.13.0}"
BATS_SHA256="${BATS_SHA256-a85e12b8828271a152b338ca8109aa23493b57950987c8e6dff97ba492772ff3}"

# Verify a file against an expected sha256, portable across Linux (sha256sum)
# and macOS (shasum). Aborts (set -e) on mismatch.
verify_sha256() { # <expected> <file>
  if command -v sha256sum >/dev/null 2>&1; then
    echo "$1  $2" | sha256sum -c -
  else
    echo "$1  $2" | shasum -a 256 -c -
  fi
}

# Prepend $HOME/.local/bin BEFORE the version check so a cache-restored bats
# (under ~/.local/bin from a previous run) is discoverable to `command -v`.
# Otherwise needs_install treats every run as a cache miss and re-downloads.
export PATH="$HOME/.local/bin:$PATH"
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$HOME/.local/bin" >> "$GITHUB_PATH"
fi

needs_install() {
  if ! command -v bats >/dev/null 2>&1; then
    return 0
  fi
  # `grep -Fqx "Bats X.Y.Z"` so e.g. `1.13.0` doesn't substring-match `11.13.0`.
  if ! bats --version 2>/dev/null | grep -Fqx "Bats ${BATS_VERSION}"; then
    return 0
  fi
  return 1
}

if needs_install; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  TARBALL_URL="https://github.com/bats-core/bats-core/archive/refs/tags/v${BATS_VERSION}.tar.gz"
  curl -fsSL "$TARBALL_URL" -o "$TMP/bats.tar.gz"
  if [ -n "$BATS_SHA256" ]; then
    verify_sha256 "$BATS_SHA256" "$TMP/bats.tar.gz"
  fi
  tar -xzf "$TMP/bats.tar.gz" -C "$TMP"
  "$TMP/bats-core-${BATS_VERSION}/install.sh" "$HOME/.local"
fi

bats --version
