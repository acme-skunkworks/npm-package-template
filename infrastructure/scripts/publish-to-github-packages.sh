#!/usr/bin/env bash
# Publish the current package to GitHub Packages (npm.pkg.github.com) as a
# secondary target (ASW-323; reinstates the leg dropped in ASW-320 / #49).
#
# Auth: GitHub Packages has no OIDC Trusted-Publisher flow, so this uses the
# automatic per-job GITHUB_TOKEN — the most secure option GitHub Packages
# offers (ephemeral, scoped to this repo, no standing secret). It needs no
# OIDC, so plain `npm` (token auth works on any npm version) and no
# --provenance flag. Relies on the preceding actions/setup-node (GitHub
# Packages) step having written .npmrc; auth comes from NODE_AUTH_TOKEN.
#
# Provenance is NOT carried via `npm publish --provenance` — that uploads the
# attestation to npm's registry attestation API, which is npmjs.org-only.
# Instead the workflow runs actions/attest-build-provenance over the exact
# tarball this script publishes, producing a GitHub-native attestation
# verifiable with `gh attestation verify`. To keep the attested and published
# digests identical, we publish the prebuilt $TARBALL rather than letting
# `npm publish` re-pack.
#
# Idempotent: if package@version already exists on GitHub Packages, exit 0
# instead of re-publishing (which would 409). Combined with the workflow's
# pending-changesets gate, this keeps retries and any non-release run safe.
#
# Inputs (all from env, set by the workflow):
#   NODE_AUTH_TOKEN              — GitHub Packages auth (the GITHUB_TOKEN); read
#                                  from .npmrc by npm
#   GITHUB_PACKAGES_REGISTRY_URL — registry to target, from
#                                  infrastructure/repo-config.yaml (ASW-176)
#   TARBALL                      — path to the .tgz produced by `npm pack` and
#                                  attested by the workflow; this exact file is
#                                  published so its digest matches the attestation
#
# Reads ./package.json for the package name and version.
set -euo pipefail

: "${NODE_AUTH_TOKEN:?NODE_AUTH_TOKEN is not set; actions/setup-node (GitHub Packages) must run first}"
: "${GITHUB_PACKAGES_REGISTRY_URL:?GITHUB_PACKAGES_REGISTRY_URL is not set; pass it from infrastructure/repo-config.yaml}"
: "${TARBALL:?TARBALL is not set; the workflow must npm pack and attest the tarball first}"

# Hard-code the publish target and fail closed if repo-config drifts (ASW-330).
# The ephemeral GITHUB_TOKEN is sent as a bearer credential to whatever registry
# we publish to, so the host must never be data-driven from a config value an
# attacker could redirect by merging an edit. repo-config.yaml still supplies the
# value to setup-node's registry-url, but here we assert it equals the one known
# host and publish only to that constant.
readonly EXPECTED_REGISTRY="https://npm.pkg.github.com"
if [ "$GITHUB_PACKAGES_REGISTRY_URL" != "$EXPECTED_REGISTRY" ]; then
  echo "Refusing to publish: GITHUB_PACKAGES_REGISTRY_URL='$GITHUB_PACKAGES_REGISTRY_URL' is not the expected '$EXPECTED_REGISTRY'." >&2
  exit 1
fi

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

# Pin the registry explicitly rather than leaning on setup-node's scoped
# .npmrc: a misconfigured scope would silently send `npm view` to public npm —
# where the version exists — so the skip path would fire forever and GitHub
# Packages would go permanently stale. ASW-307 review.
#
# Capture the probe's exit code and output so we can tell "this version isn't
# published yet" (a 404 — safe to publish) apart from a transient or auth
# failure. Treating every non-zero exit as "not published" would turn a
# registry blip or a bad token into a spurious publish attempt rather than a
# clear, actionable error.
set +e
view_output=$(npm view "$NAME@$VERSION" version --registry "$EXPECTED_REGISTRY" 2>&1)
view_status=$?
set -e

# Skip only on a genuine hit: exit 0 *with* output. npm can exit 0 with empty
# output for unresolved descriptors (a long-standing dist-tag quirk, e.g.
# `@latest` with no latest), so a bare exit-0 isn't proof the version exists.
if [ "$view_status" -eq 0 ] && [ -n "$view_output" ]; then
  echo "Already published to GitHub Packages: $NAME@$VERSION — skipping."
  exit 0
fi

# Exit 0 with empty output means "not published yet" — fall through to publish.
# Only a non-zero exit whose error isn't a 404 is a real failure to abort on.
if [ "$view_status" -ne 0 ] && ! printf '%s' "$view_output" | grep -qiE 'E404|not found'; then
  echo "npm view failed for $NAME@$VERSION (exit $view_status) and the error is not a 404 — aborting:" >&2
  printf '%s\n' "$view_output" >&2
  exit 1
fi

echo "Publishing $NAME@$VERSION to GitHub Packages from $TARBALL..."
npm publish "$TARBALL" --access public --registry "$EXPECTED_REGISTRY"
