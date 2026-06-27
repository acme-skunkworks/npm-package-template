#!/usr/bin/env bats
# Tests for infrastructure/scripts/publish-via-raw-npm.sh.
#
# Strategy: each test runs the script in an isolated cwd with a fake
# package.json and a fake npm binary at $PNPM_HOME/npm that records its
# argv to a log file. The host PATH is preserved so `node` (used by the
# script for package.json parsing) resolves normally.

setup() {
  SCRIPT_DIR="${BATS_TEST_DIRNAME}/../scripts"
  CALLS_LOG="${BATS_TEST_TMPDIR}/calls.log"
  FAKE_PNPM_HOME="${BATS_TEST_TMPDIR}/pnpm-home"
  mkdir -p "$FAKE_PNPM_HOME"
  : > "$CALLS_LOG"

  cd "${BATS_TEST_TMPDIR}"
  cat > package.json <<'EOF'
{ "name": "@test/pkg", "version": "1.0.0" }
EOF

  # The prebuilt tarball the workflow packs, uploads and downloads (A-328).
  # Contents are irrelevant — the fake npm never reads it.
  TARBALL_PATH="${BATS_TEST_TMPDIR}/test-pkg-1.0.0.tgz"
  printf 'fake tarball' > "$TARBALL_PATH"

  export PNPM_HOME="$FAKE_PNPM_HOME"
  export TARBALL="$TARBALL_PATH"
}

write_fake_npm() {
  # write_fake_npm <view-exit-code> [publish-exit-code] [view-output]
  # `npm view` prints <view-output> (default: a 404 marker) to stderr and exits
  # <view-exit-code>; `npm publish` exits <publish-exit-code> (default 0). Both
  # record their full argv to $CALLS_LOG. The probe classifies 404 vs real
  # errors via the captured output, so the default exercises the 404 path.
  local view_exit_code=$1
  local publish_exit_code=${2:-0}
  # `${3-default}` (not `${3:-default}`) so an explicit empty arg stays empty —
  # the empty-success test needs `npm view` to print nothing.
  local view_output=${3-'npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@test%2fpkg'}
  cat > "$FAKE_PNPM_HOME/npm" <<EOF
#!/usr/bin/env bash
echo "npm \$*" >> "$CALLS_LOG"
case "\$1" in
  view) printf '%s\n' "${view_output}" >&2; exit ${view_exit_code} ;;
  publish) exit ${publish_exit_code} ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$FAKE_PNPM_HOME/npm"
}

@test "already-published: npm view succeeds, script exits 0 without publishing" {
  write_fake_npm 0

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm view @test/pkg@1.0.0 version$" "$CALLS_LOG"
  ! grep -q "^npm publish" "$CALLS_LOG"
  echo "$output" | grep -q "Already published: @test/pkg@1.0.0"
}

@test "not-published: npm view 404s, script calls npm publish with TP flags" {
  write_fake_npm 1

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm view @test/pkg@1.0.0 version$" "$CALLS_LOG"
  grep -q "^npm publish ${TARBALL} --access public --provenance$" "$CALLS_LOG"
  echo "$output" | grep -q "Publishing @test/pkg@1.0.0"
}

@test "empty-success: npm view exits 0 with no output, script publishes (not a skip)" {
  # npm can exit 0 with empty output for unresolved descriptors; that must be
  # treated as "not published", not a false idempotent skip.
  write_fake_npm 0 0 ''

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -eq 0 ]
  grep -q "^npm publish ${TARBALL} --access public --provenance$" "$CALLS_LOG"
}

@test "non-404 view error: script aborts without publishing" {
  write_fake_npm 1 0 'npm error code E500
npm error 500 Internal Server Error'

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -ne 0 ]
  ! grep -q "^npm publish" "$CALLS_LOG"
  echo "$output" | grep -q "is not a 404"
  echo "$output" | grep -q "@test/pkg@1.0.0"
}

@test "missing PNPM_HOME: script fails fast with documented error" {
  unset PNPM_HOME

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "PNPM_HOME is not set"
}

@test "missing TARBALL: script fails fast with documented error" {
  write_fake_npm 1
  unset TARBALL

  run bash "$SCRIPT_DIR/publish-via-raw-npm.sh"
  [ "$status" -ne 0 ]
  echo "$output" | grep -q "TARBALL is not set"
  ! grep -q "^npm publish" "$CALLS_LOG"
}
