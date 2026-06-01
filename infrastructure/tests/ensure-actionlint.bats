#!/usr/bin/env bats
# Tests for infrastructure/scripts/ensure-actionlint.sh.
#
# Cache-hit: an executable ./actionlint exists in cwd → no download.
# Cache-miss: ./actionlint absent → download via bash <(curl ...).

setup() {
  SCRIPT_DIR="${BATS_TEST_DIRNAME}/../scripts"
  FIXTURES="${BATS_TEST_DIRNAME}/fixtures"
  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin"
  WORK="${BATS_TEST_TMPDIR}/work"
  mkdir -p "$FAKE_BIN" "$WORK"

  # Exported so the stub actionlint inherits it via `bash <(curl ...)`.
  export CALLS_LOG="${BATS_TEST_TMPDIR}/calls.log"
  : > "$CALLS_LOG"

  export PATH="$FAKE_BIN:/usr/bin:/bin"
  # Disable the linux/amd64 binary-digest check by default; the fixture's stub
  # ./actionlint won't match the pinned real-binary digest. The dedicated
  # checksum tests below set it explicitly.
  export ACTIONLINT_SHA256_LINUX_AMD64=""
  cd "$WORK"
}

# Portable sha256 of a file (Linux sha256sum / macOS shasum).
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Writes a fake command on PATH that records its argv to $CALLS_LOG and then
# runs the body in $2.
write_fake() {
  local name="$1"
  local body="$2"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'echo "%s $*" >> "%s"\n' "$name" "$CALLS_LOG"
    printf '%s\n' "$body"
  } > "$FAKE_BIN/$name"
  chmod +x "$FAKE_BIN/$name"
}

@test "cache-hit: existing ./actionlint is invoked, no curl download" {
  {
    printf '#!/usr/bin/env bash\n'
    printf 'echo "actionlint $*" >> "%s"\n' "$CALLS_LOG"
  } > "$WORK/actionlint"
  chmod +x "$WORK/actionlint"
  write_fake curl "echo 'curl should not have been called' >&2; exit 1"

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -eq 0 ]
  grep -q "^actionlint -color$" "$CALLS_LOG"
  ! grep -q "^curl" "$CALLS_LOG"
}

@test "cache-miss: curl downloads a bootstrap that drops ./actionlint, then it is invoked" {
  # Fake `curl` emits the contents of the fixture bootstrap script. The
  # script's `bash <(curl ...)` evaluates that bootstrap, which writes
  # ./actionlint that logs its argv to $CALLS_LOG when invoked.
  write_fake curl "cat \"$FIXTURES/fake-actionlint-bootstrap.sh\""

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -eq 0 ]
  # Bootstrap fetched from the immutable commit SHA, not the mutable v1.7.5 tag.
  grep -q "^curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/e11169d0656294827d65370a3c76a2325406da85/scripts/download-actionlint.bash$" "$CALLS_LOG"
  # Version passed as an arg so the bootstrap installs that exact release.
  grep -q "^actionlint-bootstrap 1.7.5$" "$CALLS_LOG"
  grep -q "^actionlint -color$" "$CALLS_LOG"
}

@test "honours ACTIONLINT_VERSION env override (passed to the bootstrap)" {
  export ACTIONLINT_VERSION="1.99.0"
  write_fake curl "cat \"$FIXTURES/fake-actionlint-bootstrap.sh\""

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -eq 0 ]
  grep -q "^actionlint-bootstrap 1.99.0$" "$CALLS_LOG"
}

@test "honours ACTIONLINT_BOOTSTRAP_REF env override in the download URL" {
  export ACTIONLINT_BOOTSTRAP_REF="deadbeefcafe"
  write_fake curl "cat \"$FIXTURES/fake-actionlint-bootstrap.sh\""

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -eq 0 ]
  grep -q "rhysd/actionlint/deadbeefcafe/scripts/download-actionlint.bash" "$CALLS_LOG"
}

@test "checksum match: binary digest equals the pin, actionlint runs (linux/amd64)" {
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || skip "binary-digest check is linux/amd64 only"
  # Learn the digest of the stub the fixture writes, then pin it so the check passes.
  ( cd "$WORK" && CALLS_LOG=/dev/null bash "$FIXTURES/fake-actionlint-bootstrap.sh" >/dev/null )
  export ACTIONLINT_SHA256_LINUX_AMD64="$(sha256_of "$WORK/actionlint")"
  rm -f "$WORK/actionlint"
  write_fake curl "cat \"$FIXTURES/fake-actionlint-bootstrap.sh\""

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -eq 0 ]
  grep -q "^actionlint -color$" "$CALLS_LOG"
}

@test "checksum mismatch: a tampered binary aborts before actionlint runs (linux/amd64)" {
  [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || skip "binary-digest check is linux/amd64 only"
  export ACTIONLINT_SHA256_LINUX_AMD64="0000000000000000000000000000000000000000000000000000000000000000"
  write_fake curl "cat \"$FIXTURES/fake-actionlint-bootstrap.sh\""

  run bash "$SCRIPT_DIR/ensure-actionlint.sh"
  [ "$status" -ne 0 ]
  ! grep -q "^actionlint -color$" "$CALLS_LOG"
}
