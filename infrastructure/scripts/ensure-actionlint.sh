#!/usr/bin/env bash
# Ensure the pinned `actionlint` binary exists at ./actionlint, downloading it
# via the project's official bootstrap script if missing, then run it against
# .github/workflows/*. The GHA workflow caches ./actionlint on the version
# key so the download branch is normally skipped on subsequent runs.
#
# Integrity (ASW-327): two changes harden the otherwise curl|bash bootstrap.
#   1. The bootstrap script is fetched from an immutable COMMIT SHA (the v1.7.5
#      tag's commit), not the mutable `v1.7.5` tag — the script can't change
#      under us. The version is passed as an arg so the bootstrap installs that
#      exact actionlint release (not "latest").
#   2. download-actionlint.bash verifies the *tarball* against a checksum it
#      re-fetches from the same release — not an independent control — so we
#      re-verify the extracted ./actionlint binary against a pinned sha256.
#      The binary digest is arch-specific, so this is enforced only on the CI
#      arch (linux/amd64); other platforms fall back to the bootstrap's own
#      check (set the digest empty to skip, e.g. in tests).
#
# Confinement: this script (and the bats/yamllint bootstraps) must never be
# added to the `release` / `publish-github-packages` jobs — they run only in
# read-scoped CI jobs with no publish credential, which is what keeps a
# compromised upstream from reaching the npm/GitHub Packages identity.
#
# Env:
#   ACTIONLINT_VERSION             — pinned version (default 1.7.5). Match the
#                                    cache key in .github/workflows/ci.yml.
#   ACTIONLINT_BOOTSTRAP_REF       — immutable git ref of download-actionlint.bash
#                                    (default: the v1.7.5 tag's commit SHA).
#   ACTIONLINT_SHA256_LINUX_AMD64  — pinned sha256 of the linux/amd64 binary.
#                                    Set empty to skip the check (tests).

set -euo pipefail

ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.5}"
ACTIONLINT_BOOTSTRAP_REF="${ACTIONLINT_BOOTSTRAP_REF:-e11169d0656294827d65370a3c76a2325406da85}"
ACTIONLINT_SHA256_LINUX_AMD64="${ACTIONLINT_SHA256_LINUX_AMD64-76e1b008a05f55effccb39355d76c74e5312fefa6c98253032a499b227d01149}"

if [ ! -x ./actionlint ]; then
  DOWNLOAD_URL="https://raw.githubusercontent.com/rhysd/actionlint/${ACTIONLINT_BOOTSTRAP_REF}/scripts/download-actionlint.bash"
  bash <(curl -fsSL "$DOWNLOAD_URL") "$ACTIONLINT_VERSION"

  # Independent digest check on the CI arch (linux/amd64).
  if [ "$(uname -s)" = "Linux" ] && [ "$(uname -m)" = "x86_64" ] && [ -n "$ACTIONLINT_SHA256_LINUX_AMD64" ]; then
    echo "${ACTIONLINT_SHA256_LINUX_AMD64}  ./actionlint" | sha256sum -c -
  fi
fi

./actionlint -color
