#!/usr/bin/env bash
# Publish the current package to npm via the upgraded npm at $PNPM_HOME/npm,
# bypassing `pnpm changeset publish`. Diagnosed in ASW-174: pnpm's publish
# path from inside `changesets/action` ends up failing OIDC Trusted Publishing
# even when `$PNPM_HOME` is on $PATH and `which npm` correctly resolves to
# npm 11.x. Calling npm directly works (PR #19 proved the npm-side flow when
# the workflow filename matches the TP allowlist on npmjs.com).
#
# Idempotent: if the package@version already exists on npm, exit 0 instead
# of re-publishing (which would 403/409). Lets release.yml retry safely
# after the version commit lands but before npm has the artifact.
#
# Publishes the prebuilt $TARBALL (ASW-328) rather than re-packing the working
# tree, so the npm tarball, the GitHub Packages tarball, and the attested digest
# are byte-identical — and no build-time code runs in this credential-holding
# job. `--provenance` still works on a prebuilt tarball: npm derives the
# provenance statement from the GHA OIDC token + run context, not from a re-run
# build.
#
# Inputs (all from env, set by the workflow):
#   PNPM_HOME — directory containing the upgraded npm binary
#   TARBALL   — path to the .tgz built and uploaded by the unprivileged build
#               job, downloaded here as an artifact
#
# Reads ./package.json for the package name and version.
set -euo pipefail

: "${PNPM_HOME:?PNPM_HOME is not set; pnpm/action-setup must run first}"
: "${TARBALL:?TARBALL is not set; the build job must npm pack and upload the tarball first}"

NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")

# Probe whether this version already exists. Capture the exit code and output
# so a genuine 404 ("not published yet" → publish) is told apart from a
# transient/auth/registry failure (→ abort with a clear error before the OIDC
# token exchange and publish, so the failure surfaces here rather than mid-
# publish). Mirrors publish-to-github-packages.sh. ASW-326 review.
set +e
view_output=$("$PNPM_HOME/npm" view "$NAME@$VERSION" version 2>&1)
view_status=$?
set -e

# Skip only on a genuine hit: exit 0 *with* output. npm can exit 0 with empty
# output for unresolved descriptors (a dist-tag quirk), so a bare exit-0 isn't
# proof the version exists.
if [ "$view_status" -eq 0 ] && [ -n "$view_output" ]; then
  echo "Already published: $NAME@$VERSION — skipping."
  exit 0
fi

# Exit 0 with empty output means "not published yet" — fall through to publish.
# Only a non-zero exit whose error isn't a 404 is a real failure to abort on.
if [ "$view_status" -ne 0 ] && ! printf '%s' "$view_output" | grep -qiE 'E404|not found'; then
  echo "npm view failed for $NAME@$VERSION (exit $view_status) and the error is not a 404 — aborting:" >&2
  printf '%s\n' "$view_output" >&2
  exit 1
fi

echo "Publishing $NAME@$VERSION from $TARBALL via $PNPM_HOME/npm..."
"$PNPM_HOME/npm" publish "$TARBALL" --access public --provenance
