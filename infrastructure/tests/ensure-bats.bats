#!/usr/bin/env bats
# Tests for infrastructure/scripts/ensure-bats.sh.
#
# Cache-hit: `bats` already on PATH at the pinned version → no curl/tar.
# Cache-miss: `bats` absent or wrong version → curl downloads, tar extracts,
#             install.sh runs.

setup() {
  SCRIPT_DIR="${BATS_TEST_DIRNAME}/../scripts"
  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin"
  WORK="${BATS_TEST_TMPDIR}/work"
  mkdir -p "$FAKE_BIN" "$WORK"

  export CALLS_LOG="${BATS_TEST_TMPDIR}/calls.log"
  : > "$CALLS_LOG"

  # Isolate from any real $HOME so the install-target stays under tmpdir.
  export HOME="${BATS_TEST_TMPDIR}/home"
  mkdir -p "$HOME"

  export PATH="$FAKE_BIN:/usr/bin:/bin"
  # Disable the tarball-digest check by default; most tests use a fake curl that
  # produces no real tarball. The dedicated checksum tests set it explicitly.
  export BATS_SHA256=""
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

@test "cache-hit: existing bats at pinned version skips download" {
  write_fake bats "echo 'Bats 1.13.0'"
  write_fake curl "echo 'curl should not have been called' >&2; exit 1"
  write_fake tar "echo 'tar should not have been called' >&2; exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -eq 0 ]
  grep -q "^bats --version$" "$CALLS_LOG"
  ! grep -q "^curl" "$CALLS_LOG"
  ! grep -q "^tar" "$CALLS_LOG"
}

@test "cache-miss: missing bats triggers download from pinned version URL" {
  # Fake `curl` records the URL but produces no real tarball; fake `tar`
  # writes a stub install.sh that drops a bats stub into $HOME/.local/bin
  # so the final `bats --version` invocation succeeds.
  BATS_VERSION="${BATS_VERSION:-1.13.0}"
  EXTRACT_DIR="${BATS_TEST_TMPDIR}/extracted-bats-core-${BATS_VERSION}"
  mkdir -p "$EXTRACT_DIR"
  cat > "$EXTRACT_DIR/install.sh" <<'INSTALL'
#!/usr/bin/env bash
# Stub install.sh — receives a single PREFIX argument and creates a fake bats.
PREFIX="$1"
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/bats" <<'BATS'
#!/usr/bin/env bash
echo "Bats 1.13.0"
BATS
chmod +x "$PREFIX/bin/bats"
INSTALL
  chmod +x "$EXTRACT_DIR/install.sh"

  write_fake curl ""
  write_fake tar "cp -r '$EXTRACT_DIR' \"\$(echo \"\$*\" | awk -F'-C ' '{print \$2}')/bats-core-${BATS_VERSION}\""

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -eq 0 ]
  grep -q "^curl -fsSL https://github.com/bats-core/bats-core/archive/refs/tags/v1.13.0.tar.gz" "$CALLS_LOG"
  grep -q "^tar " "$CALLS_LOG"
}

@test "cache-miss: wrong bats version triggers reinstall" {
  write_fake bats "echo 'Bats 1.10.0'"
  write_fake curl "exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  # curl fails so script exits non-zero, but importantly curl WAS invoked,
  # proving the version mismatch took the install branch instead of skipping.
  [ "$status" -ne 0 ]
  grep -q "^curl -fsSL https://github.com/bats-core/bats-core/archive/refs/tags/v1.13.0.tar.gz" "$CALLS_LOG"
}

@test "honours BATS_VERSION env override in the download URL" {
  export BATS_VERSION="1.99.0"
  write_fake curl "exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -ne 0 ]
  grep -q "bats-core/archive/refs/tags/v1.99.0.tar.gz" "$CALLS_LOG"
}

@test "cache-hit: bats restored to \$HOME/.local/bin (off-PATH) is discovered" {
  # Simulates GHA cache-restore: bats only exists under ~/.local/bin, which
  # is NOT pre-added to PATH. The script must prepend it BEFORE the version
  # check so command -v finds the cached binary instead of treating the run
  # as a cache miss and re-downloading.
  mkdir -p "$HOME/.local/bin"
  cat > "$HOME/.local/bin/bats" <<'BATS'
#!/usr/bin/env bash
echo "Bats 1.13.0"
BATS
  chmod +x "$HOME/.local/bin/bats"
  write_fake curl "echo 'curl should not have been called' >&2; exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -eq 0 ]
  ! grep -q "^curl" "$CALLS_LOG"
}

@test "substring-safe: a version that contains BATS_VERSION as substring is not accepted" {
  # `1.13.0` is a substring of `11.13.0`; the version check must use
  # whole-line matching so the substring case still triggers reinstall.
  write_fake bats "echo 'Bats 11.13.0'"
  write_fake curl "exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -ne 0 ]
  grep -q "^curl -fsSL https://github.com/bats-core/bats-core/archive/refs/tags/v1.13.0.tar.gz" "$CALLS_LOG"
}

@test "checksum match: tarball digest equals the pin, extraction proceeds" {
  # Pin BATS_SHA256 to the digest of the bytes the fake curl will write, so the
  # check passes and the script proceeds to extract + install.
  SAMPLE="${BATS_TEST_TMPDIR}/sample.tgz"
  printf '%s' "pretend-bats-tarball" > "$SAMPLE"
  export BATS_SHA256="$(sha256_of "$SAMPLE")"

  BATS_VERSION="${BATS_VERSION:-1.13.0}"
  EXTRACT_DIR="${BATS_TEST_TMPDIR}/extracted-bats-core-${BATS_VERSION}"
  mkdir -p "$EXTRACT_DIR"
  cat > "$EXTRACT_DIR/install.sh" <<'INSTALL'
#!/usr/bin/env bash
PREFIX="$1"
mkdir -p "$PREFIX/bin"
cat > "$PREFIX/bin/bats" <<'BATS'
#!/usr/bin/env bash
echo "Bats 1.13.0"
BATS
chmod +x "$PREFIX/bin/bats"
INSTALL
  chmod +x "$EXTRACT_DIR/install.sh"

  # Fake curl writes the sample bytes to its -o target so the digest matches.
  write_fake curl 'while [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then printf "%s" "pretend-bats-tarball" > "$2"; fi; shift; done'
  write_fake tar "cp -r '$EXTRACT_DIR' \"\$(echo \"\$*\" | awk -F'-C ' '{print \$2}')/bats-core-${BATS_VERSION}\""

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -eq 0 ]
  grep -q "^tar " "$CALLS_LOG"
}

@test "checksum mismatch: a tampered tarball aborts before extraction" {
  export BATS_SHA256="0000000000000000000000000000000000000000000000000000000000000000"
  # Fake curl writes some bytes to -o (so the file exists) that won't match.
  write_fake curl 'while [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then printf "%s" "tampered-bytes" > "$2"; fi; shift; done'
  write_fake tar "echo 'tar should not have been called' >&2; exit 1"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -ne 0 ]
  ! grep -q "^tar " "$CALLS_LOG"
}

@test "appends \$HOME/.local/bin to GITHUB_PATH even on cache hit" {
  # GHA pipeline must propagate ~/.local/bin to subsequent steps regardless
  # of whether this run installed or used a cached binary.
  write_fake bats "echo 'Bats 1.13.0'"
  export GITHUB_PATH="${BATS_TEST_TMPDIR}/github_path"
  : > "$GITHUB_PATH"

  run bash "$SCRIPT_DIR/ensure-bats.sh"
  [ "$status" -eq 0 ]
  grep -qF "$HOME/.local/bin" "$GITHUB_PATH"
}
