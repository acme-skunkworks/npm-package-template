#!/usr/bin/env bats
# Tests for infrastructure/scripts/ensure-yamllint.sh.
#
# Strategy: each test runs the script in an isolated $HOME with a fake-bin
# directory prepended to PATH. Fake commands record their argv to a log so
# we can assert which branch fired.

setup() {
  SCRIPT_DIR="${BATS_TEST_DIRNAME}/../scripts"
  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin"
  CALLS_LOG="${BATS_TEST_TMPDIR}/calls.log"
  FAKE_HOME="${BATS_TEST_TMPDIR}/home"
  GITHUB_PATH_FILE="${BATS_TEST_TMPDIR}/github_path"
  mkdir -p "$FAKE_BIN" "$FAKE_HOME"
  : > "$CALLS_LOG"
  : > "$GITHUB_PATH_FILE"

  # Sandbox: only our fake-bin + system essentials. Drop the user's PATH so
  # the real yamllint/pip can't leak in.
  export PATH="$FAKE_BIN:/usr/bin:/bin"
  export HOME="$FAKE_HOME"
  export GITHUB_PATH="$GITHUB_PATH_FILE"

  # Targets to lint — yamllint . needs a directory to walk.
  cd "${BATS_TEST_TMPDIR}"
}

write_fake() {
  # write_fake <name> <body>
  cat > "$FAKE_BIN/$1" <<EOF
#!/usr/bin/env bash
echo "$1 \$*" >> "$CALLS_LOG"
$2
EOF
  chmod +x "$FAKE_BIN/$1"
}

@test "already-installed: pip is not called, yamllint is invoked" {
  write_fake yamllint "exit 0"
  write_fake pip "echo 'pip should not have been called' >&2; exit 1"

  run bash "$SCRIPT_DIR/ensure-yamllint.sh"
  [ "$status" -eq 0 ]
  grep -q "^yamllint \\.$" "$CALLS_LOG"
  ! grep -q "^pip" "$CALLS_LOG"
}

@test "not-installed: pip install runs with --require-hashes against the pinned requirements" {
  # No yamllint on PATH initially. pip stub installs a yamllint shim into
  # the script's expected location so the subsequent invocation finds it.
  write_fake pip "mkdir -p \"\$HOME/.local/bin\"; cat > \"\$HOME/.local/bin/yamllint\" <<'INNER'
#!/usr/bin/env bash
echo \"yamllint \$*\" >> \"$CALLS_LOG\"
INNER
chmod +x \"\$HOME/.local/bin/yamllint\""

  run bash "$SCRIPT_DIR/ensure-yamllint.sh"
  [ "$status" -eq 0 ]
  # Hash-locked install, not a bare `pip install yamllint==X` (ASW-327).
  grep -qE "^pip install --user --break-system-packages --require-hashes -r .*requirements-yamllint\\.txt$" "$CALLS_LOG"
  grep -q "^yamllint \\.$" "$CALLS_LOG"
}

@test "not-installed: appends ~/.local/bin to GITHUB_PATH" {
  write_fake pip "mkdir -p \"\$HOME/.local/bin\"; cat > \"\$HOME/.local/bin/yamllint\" <<'INNER'
#!/usr/bin/env bash
exit 0
INNER
chmod +x \"\$HOME/.local/bin/yamllint\""

  run bash "$SCRIPT_DIR/ensure-yamllint.sh"
  [ "$status" -eq 0 ]
  grep -qx "$FAKE_HOME/.local/bin" "$GITHUB_PATH_FILE"
}

@test "already-installed: GITHUB_PATH is not appended to" {
  write_fake yamllint "exit 0"
  write_fake pip "exit 1"

  run bash "$SCRIPT_DIR/ensure-yamllint.sh"
  [ "$status" -eq 0 ]
  [ ! -s "$GITHUB_PATH_FILE" ]
}

@test "honours YAMLLINT_REQUIREMENTS env override" {
  export YAMLLINT_REQUIREMENTS="/tmp/custom-reqs.txt"
  write_fake pip "mkdir -p \"\$HOME/.local/bin\"; cat > \"\$HOME/.local/bin/yamllint\" <<'INNER'
#!/usr/bin/env bash
exit 0
INNER
chmod +x \"\$HOME/.local/bin/yamllint\""

  run bash "$SCRIPT_DIR/ensure-yamllint.sh"
  [ "$status" -eq 0 ]
  grep -q "^pip install --user --break-system-packages --require-hashes -r /tmp/custom-reqs.txt$" "$CALLS_LOG"
}
