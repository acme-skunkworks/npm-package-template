#!/usr/bin/env node
// Filesystem-hygiene pass for the cleanup-repo skill.
//
// Detects two kinds of cruft and (optionally) removes them:
//   - emptyDirs          : recursively-empty directories — a directory whose
//                          entire subtree contains no files at all. The top-most
//                          such directory is reported (removing it takes its
//                          empty descendants with it). A directory holding any
//                          file — including a `.gitkeep` / `.gitignore`
//                          placeholder — is NOT empty and is left alone.
//   - orphanNodeModules  : `node_modules/` directories whose immediate parent has
//                          no `package.json` (strict; no workspace inference).
//
// `.git/` is hard-protected: never traversed, and its presence marks the
// containing directory as non-empty (so a nested working tree is never swept).
// `node_modules/` is never traversed (huge, and handled by the orphan check).
//
// For a given filesystem state the SAME detection drives both the report and
// the removal, so `--apply` removes exactly what a plain run lists. (The skill
// runs detection twice — before and after worktree removal — so its end-to-end
// preview can still pick up parents emptied by that removal; see SKILL.md.)
//
// Usage:
//   node filesystem-hygiene.mjs [root]            # print detection JSON (default cwd)
//   node filesystem-hygiene.mjs [root] --json     # same, explicit
//   node filesystem-hygiene.mjs [root] --apply    # remove the detected set, print JSON
//   node filesystem-hygiene.mjs --self-test       # run built-in fixtures
//   node filesystem-hygiene.mjs --help            # print usage (alias: -h)

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

// Recurse a directory. Returns true when the directory is recursively empty
// (its subtree contains no files). Side effects: pushes top-most empty
// directories into `emptyDirs` and every node_modules path into `nodeModulesDirs`.
function scan(directory, emptyDirectories, nodeModulesDirectories) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Unreadable directory — treat as content so we never remove it.
    return false;
  }

  let hasContent = false;
  const emptyChildDirectories = [];

  for (const entry of entries) {
    const full = join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      // Never follow or remove through symlinks.
      hasContent = true;
      continue;
    }

    if (entry.isFile()) {
      // Any file — placeholders included — counts as content.
      hasContent = true;
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name === ".git") {
        hasContent = true; // protect working trees / nested repos
        continue;
      }

      if (entry.name === "node_modules") {
        nodeModulesDirectories.push(full);
        hasContent = true; // not traversed; handled by the orphan check
        continue;
      }

      const childEmpty = scan(full, emptyDirectories, nodeModulesDirectories);
      if (childEmpty) {
        emptyChildDirectories.push(full);
      } else {
        hasContent = true;
      }

      continue;
    }

    // Sockets, FIFOs, devices — treat as content.
    hasContent = true;
  }

  if (hasContent) {
    // This directory stays; its recursively-empty children are the top-most
    // empties (their parent has content), so they are the ones to remove.
    for (const child of emptyChildDirectories) {
      emptyDirectories.push(child);
    }

    return false;
  }

  // No content anywhere in this subtree: this whole directory is removable.
  // Don't record its children — the parent records this directory instead.
  return true;
}

export function detect(root) {
  if (!existsSync(root)) {
    throw new Error(`Root path does not exist: ${root}`);
  }

  if (!statSync(root).isDirectory()) {
    throw new Error(`Root path is not a directory: ${root}`);
  }

  const emptyDirectories = [];
  const nodeModulesDirectories = [];
  // The root itself is never a removal candidate.
  scan(root, emptyDirectories, nodeModulesDirectories);

  const orphanNodeModules = nodeModulesDirectories.filter(
    (nm) => !existsSync(join(dirname(nm), "package.json")),
  );

  return {
    emptyDirs: emptyDirectories.toSorted(),
    orphanNodeModules: orphanNodeModules.toSorted(),
  };
}

export function apply(root) {
  const result = detect(root);
  const removed = [];
  const failed = [];
  // Isolate per-path failures: one un-removable entry (permissions, a race)
  // must not abort the rest. Report what was removed and what wasn't.
  for (const path of [...result.orphanNodeModules, ...result.emptyDirs]) {
    try {
      rmSync(path, { force: true, recursive: true });
      removed.push(path);
    } catch (error) {
      failed.push({ error: error.message, path });
    }
  }

  return { ...result, failed, removed };
}

// Refuse to operate unless `root` looks like a Git working tree — i.e. it holds
// a `.git` entry (a directory in a primary worktree, a file in a linked one).
// Defence in depth on a destructive tool: this prunes recursively-empty
// directories and orphan `node_modules/`, so a mis-pointed root must never be
// allowed to sweep arbitrary directories.
export function assertGitRepo(root) {
  if (!existsSync(join(root, ".git"))) {
    throw new Error(
      `Refusing to run: ${root} is not a Git repository root (no .git entry). ` +
        "Pass the path from `git rev-parse --show-toplevel`.",
    );
  }
}

function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.find((a) => !a.startsWith("--"));
  return { flags, root: positional ?? process.cwd() };
}

// ---- self-test ----------------------------------------------------------

function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), "cleanup-repo-fs-"));
  function makeDirectory(...segments) {
    const full = join(root, ...segments);
    mkdirSync(full, { recursive: true });
    return full;
  }

  function makeFile(rel, body = "") {
    return writeFileSync(join(root, rel), body);
  }

  // A repo-like root marker so the root always has content.
  makeDirectory(".git");
  makeFile(".git/HEAD", "ref: refs/heads/main\n");

  // 1. A recursively-empty directory (nested, no files) → top-most reported.
  makeDirectory("empty-top", "a", "b");

  // 2. A directory whose subtree holds only a placeholder → left alone.
  makeDirectory("placeholder-only");
  makeFile("placeholder-only/.gitkeep");

  // 3. A directory with a real file → left alone.
  makeDirectory("has-file");
  makeFile("has-file/index.ts", "export {};\n");

  // 4. Orphan node_modules (parent has no package.json).
  makeDirectory("orphan-pkg", "node_modules", "left-pad");

  // 5. Legitimate node_modules (parent has package.json) → not orphan.
  makeDirectory("real-pkg", "node_modules", "left-pad");
  makeFile("real-pkg/package.json", "{}\n");

  // 6. A nested .git (sub working tree) inside an otherwise file-free dir →
  //    must NOT be reported as empty.
  makeDirectory("nested-repo", ".git");

  return root;
}

function selfTest() {
  const cases = [];
  const root = buildFixture();
  let result;
  try {
    result = detect(root);
  } catch (error) {
    console.log(`  FAIL  detect threw (${error.message})`);
    process.exit(1);
  }

  function rel(path) {
    return path.slice(root.length).split(sep).filter(Boolean).join("/");
  }

  const empties = result.emptyDirs.map(rel);
  const orphans = result.orphanNodeModules.map(rel);

  cases.push({
    name: "top-most empty directory is reported",
    ok: empties.includes("empty-top"),
  });
  cases.push({
    name: "empty descendants are not reported individually",
    ok: !empties.includes("empty-top/a") && !empties.includes("empty-top/a/b"),
  });
  cases.push({
    name: "placeholder-only directory is left alone",
    ok: !empties.includes("placeholder-only"),
  });
  cases.push({
    name: "directory with a real file is left alone",
    ok: !empties.includes("has-file"),
  });
  cases.push({
    name: "orphan node_modules (no sibling package.json) is reported",
    ok: orphans.includes("orphan-pkg/node_modules"),
  });
  cases.push({
    name: "node_modules with a sibling package.json is NOT an orphan",
    ok: !orphans.includes("real-pkg/node_modules"),
  });
  cases.push({
    name: "node_modules never appears in emptyDirs",
    ok: !empties.some((path) => path.split("/").includes("node_modules")),
  });
  cases.push({
    name: "directory holding a nested .git is not reported empty",
    ok: !empties.includes("nested-repo"),
  });
  cases.push({
    name: ".git is never reported or traversed",
    ok:
      !empties.some((path) => path.split("/").includes(".git")) &&
      !orphans.some((path) => path.split("/").includes(".git")),
  });

  // apply() removes exactly the detected snapshot and nothing else.
  const before = detect(root);
  const applied = apply(root);
  const after = detect(root);
  cases.push({
    name: "apply removed the originally detected paths",
    ok:
      before.emptyDirs.every((path) => !existsSync(path)) &&
      before.orphanNodeModules.every((path) => !existsSync(path)),
  });
  cases.push({
    name: "apply reports every removed path and no failures on a clean run",
    ok:
      applied.failed.length === 0 &&
      applied.removed.length ===
        before.emptyDirs.length + before.orphanNodeModules.length,
  });
  cases.push({
    name: "apply preserves placeholder-only and file-bearing directories",
    ok:
      existsSync(join(root, "placeholder-only")) &&
      existsSync(join(root, "has-file")),
  });
  // Removing orphan-pkg/node_modules empties its parent — a deliberate cascade
  // that a *subsequent* run sweeps, never the same snapshot.
  cases.push({
    name: "removing an orphan node_modules leaves its parent for the next run",
    ok:
      after.emptyDirs.map(rel).join(",") === "orphan-pkg" &&
      after.orphanNodeModules.length === 0,
  });

  // detect() fails fast on a root that exists but is not a directory, rather
  // than silently reporting nothing (readdirSync would throw ENOTDIR in scan).
  const fileRoot = join(tmpdir(), `cleanup-repo-fs-not-a-dir-${process.pid}`);
  writeFileSync(fileRoot, "");
  let threwOnFileRoot = false;
  try {
    detect(fileRoot);
  } catch {
    threwOnFileRoot = true;
  }

  rmSync(fileRoot, { force: true });
  cases.push({
    name: "detect throws on a non-directory root",
    ok: threwOnFileRoot,
  });

  // The git-repo guard refuses a root with no `.git` entry and accepts both
  // shapes a real root takes: buildFixture() created a `.git` directory at
  // `root` (primary worktree), and a linked worktree carries a `.git` *file*.
  const nonGitRoot = mkdtempSync(join(tmpdir(), "cleanup-repo-fs-nongit-"));
  const linkedWorktreeRoot = mkdtempSync(
    join(tmpdir(), "cleanup-repo-fs-linked-"),
  );
  writeFileSync(
    join(linkedWorktreeRoot, ".git"),
    "gitdir: /tmp/cleanup-repo-linked-worktree\n",
  );
  let guardThrewOnNonGit = false;
  try {
    assertGitRepo(nonGitRoot);
  } catch {
    guardThrewOnNonGit = true;
  }

  let guardAcceptedGitDirectory = true;
  try {
    assertGitRepo(root);
  } catch {
    guardAcceptedGitDirectory = false;
  }

  let guardAcceptedLinkedWorktree = true;
  try {
    assertGitRepo(linkedWorktreeRoot);
  } catch {
    guardAcceptedLinkedWorktree = false;
  }

  rmSync(nonGitRoot, { force: true, recursive: true });
  rmSync(linkedWorktreeRoot, { force: true, recursive: true });
  cases.push({
    name: "git-repo guard refuses a non-git root, accepts a .git dir and a linked-worktree .git file",
    ok:
      guardThrewOnNonGit &&
      guardAcceptedGitDirectory &&
      guardAcceptedLinkedWorktree,
  });

  rmSync(root, { force: true, recursive: true });

  let failed = 0;
  for (const { name, ok } of cases) {
    if (ok) {
      console.log(`  ok    ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

const USAGE = `filesystem-hygiene — detect (and optionally remove) recursively-empty dirs and orphan node_modules

Usage:
  node filesystem-hygiene.mjs [root]            Print detection JSON (default: cwd; read-only)
  node filesystem-hygiene.mjs [root] --json     Same, explicit
  node filesystem-hygiene.mjs [root] --apply    Remove the detected set, then print JSON
  node filesystem-hygiene.mjs --self-test       Run the built-in offline fixtures
  node filesystem-hygiene.mjs --help            Show this message (alias: -h)`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const { flags, root } = parseArgs(argv);
  try {
    assertGitRepo(root);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const result = flags.has("--apply") ? apply(root) : detect(root);
  console.log(JSON.stringify(result, null, 2));
}

// Run main() only when invoked directly as a CLI, not when imported. Compare
// realpath'd paths so symlinks (macOS /var→/private/var, pnpm's store) don't
// cause a false negative.
function isCliEntry() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(import.meta.filename) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
