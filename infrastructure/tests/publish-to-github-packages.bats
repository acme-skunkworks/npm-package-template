#!/usr/bin/env bats
# Tests for infrastructure/scripts/publish-to-github-packages.sh.
#
# Strategy: each test runs the script in an isolated cwd with a fake
# package.json and a fake `npm` on PATH that records its argv to a log file.
# `node` (used by the script for package.json parsing) is preserved by keeping
# the host PATH after the fake-npm dir. Unlike the npm leg, this script uses
# plain `npm` (token auth, no OIDC), so the fake lives on PATH rather than at
# $PNPM_HOME/npm.
#
# The script publishes the prebuilt $TARBALL (the exact file the workflow packs
# and attests, ASW-323), so setup creates a fake tarball and exports its path.

setup() {
  SCRIPT_DIR="${BATS_TEST_DIRNAME}/../scripts"
  CALLS_LOG="${BATS_TEST_TMPDIR}/calls.log"
  FAKE_BIN="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "$FAKE_BIN"
  : > "$CALLS_LOG"

  cd "${BATS_TEST_TMPDIR}"
  cat > package.json <<'EOF'
{ "name": "@test/pkg", "version": "1.0.0" }
EOF

  # The attested tarball the workflow would pass through. Contents are
  # irrelevant — the fake npm never reads it.
  TARBALL_PATH="${BATS_TEST_TMPDIR}/test-pkg-1.0.0.tgz"
  printf 'fake tarball' > "$TARBALL_PATH"

  # Fake npm first on PATH; real PATH kept after it so `node` resolves.
  export PATH="$FAKE_BIN:$PATH"
  # Env the script requires (set by the workflow in production).
  export NODE_AUTH_TOKEN="fake-token"
  export GITHUB_PACKAGES_REGISTRY_URL="https://npm.pkg.github.com"
  export TARBALL="$TARBALL_PATH"
}

write_fake_npm() {
  # write_fake_npm <view-exit-code> [publish-exit-code] [view-stderr]
  # `npm view` prints <view-stderr> (default: a 404 marker) to stderr and exits
  # <view-exit-code>; `npm publish` exits <publish-exit-code> (default 0). Both
  # record their full argv to $CALLS_LOG.
  local view_exit_code=$1
  local publish_exit_code=${2:-0}
  # `${3-default}` (not `${3:-default}`) so an explicit empty arg stays empty —
  # the empty-success test needs `npm view` to print nothing.
  local view_stderr=${3-'npm error code E404
npm error 404 Not Found - GET https://npm.pkg.github.com/@test%2fpkg'}
  cat > "$FAKE_BIN/npm" <<EOF
#!/usr/bin/env bash
echo "npm \$*" >> "$CALLS_LOG"
case "\$1" in
  view) printf '%s\n' "${view_stderr}" >&2; exit ${view_exit_code} ;;
  publish) exit ${publish_exit_code} ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$FAKE_BIN/npm"
}

@test "already-published: npm view succeeds, script exits 0 without publishing" {
  write_fake_npm 0

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm view @test/pkg@1.0.0 version --registry https://npm.pkg.github.com$" "$CALLS_LOG"
  ! grep -q "^npm publish" "$CALLS_LOG"
  echo "$output" | grep -q "Already published to GitHub Packages: @test/pkg@1.0.0"
}

@test "not-published: npm view fails, script publishes the tarball without --provenance" {
  write_fake_npm 1

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm view @test/pkg@1.0.0 version --registry https://npm.pkg.github.com$" "$CALLS_LOG"
  grep -q "^npm publish ${TARBALL} --access public --registry https://npm.pkg.github.com$" "$CALLS_LOG"
  ! grep -q -- "--provenance" "$CALLS_LOG"
  echo "$output" | grep -q "Publishing @test/pkg@1.0.0 to GitHub Packages"
}

@test "empty-success: npm view exits 0 with no output, script publishes (not a skip)" {
  # npm can exit 0 with empty output for unresolved descriptors (dist-tag
  # quirk). That must be treated as "not published", not a false idempotent
  # skip. write_fake_npm with empty stderr → command substitution strips the
  # lone newline → view_output is empty.
  write_fake_npm 0 0 ''

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm publish ${TARBALL} --access public --registry https://npm.pkg.github.com$" "$CALLS_LOG"
  ! grep -q -- "--provenance" "$CALLS_LOG"
}

@test "publish-failure: npm publish fails, script exits non-zero" {
  write_fake_npm 1 1

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  grep -q "^npm publish ${TARBALL} --access public --registry https://npm.pkg.github.com$" "$CALLS_LOG"
}

@test "non-404 view error: script aborts without publishing" {
  write_fake_npm 1 0 'npm error code E500
npm error 500 Internal Server Error'

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  ! grep -q "^npm publish" "$CALLS_LOG"
  echo "$output" | grep -q "is not a 404"
  echo "$output" | grep -q "@test/pkg@1.0.0"
}

@test "missing NODE_AUTH_TOKEN: script fails fast with documented error" {
  write_fake_npm 1
  unset NODE_AUTH_TOKEN

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "NODE_AUTH_TOKEN is not set"
  ! grep -q "^npm publish" "$CALLS_LOG"
}

@test "missing GITHUB_PACKAGES_REGISTRY_URL: script fails fast with documented error" {
  write_fake_npm 1
  unset GITHUB_PACKAGES_REGISTRY_URL

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "GITHUB_PACKAGES_REGISTRY_URL is not set"
  ! grep -q "^npm publish" "$CALLS_LOG"
}

@test "missing TARBALL: script fails fast with documented error" {
  write_fake_npm 1
  unset TARBALL

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "TARBALL is not set"
  ! grep -q "^npm publish" "$CALLS_LOG"
}

@test "registry drift: a non-canonical GITHUB_PACKAGES_REGISTRY_URL aborts without publishing" {
  # ASW-330: the publish target is hard-coded; the script fails closed rather
  # than send the GITHUB_TOKEN to whatever host a config edit points it at.
  write_fake_npm 1
  export GITHUB_PACKAGES_REGISTRY_URL="https://evil.example.com"

  run bash "$SCRIPT_DIR/publish-to-github-packages.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "not the expected"
  ! grep -q "^npm publish" "$CALLS_LOG"
  # And it never probed the attacker host either.
  ! grep -q "evil.example.com" "$CALLS_LOG"
}
