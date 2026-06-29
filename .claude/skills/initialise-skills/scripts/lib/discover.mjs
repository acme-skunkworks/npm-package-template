// Locate the sibling skill bundles installed alongside this one (A-409).
//
// Where bundles live is install-dependent: `skills add` may vendor them under
// `.claude/skills/`, `.agents/skills/`, or a repo's own `skills/`. We resolve the
// directory that CONTAINS this bundle (two levels up from scripts/lib/initialise
// modules — i.e. the install root holding every sibling bundle dir) from the
// module URL, not from cwd. An explicit override (`--skills-dir`) wins, for tests
// and unusual layouts.

import { parseConfig, readConfig } from "./jsonio.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Skills that configure themselves and so must NOT get a generated config.json.
// `preflight` reads an OPTIONAL `preflight.config.json` at the consumer repo ROOT
// (not an in-bundle config.json) and auto-detects base branch + workspaces when
// it is absent — so writing skills/preflight/config.json would create a file it
// never reads. Its config.example.json documents that root-level override only.
// (Future: a skill could declare this in its SKILL.md metadata; hardcoded for now.)
const SELF_CONFIGURING = new Set(["preflight"]);

/**
 * The directory holding sibling bundles: the parent of THIS bundle's own
 * directory. `import.meta.url` here is …/<skillsDir>/initialise-skills/scripts/lib/discover.mjs,
 * so four `dirname` hops reach <skillsDir>.
 * @returns {string}
 */
export function defaultSkillsDirectory() {
  const here = import.meta.dirname; // scripts/lib
  const bundleDirectory = dirname(dirname(here)); // skills/initialise-skills
  return dirname(bundleDirectory); // skills/
}

/**
 * Is the `preflight` bundle installed alongside this one? `discoverSkills()` omits
 * it (self-configuring, no config.json to reconcile), so the gitignore reconcile —
 * which exists only because preflight writes `.preflight-summary.json` — must check
 * for it separately. Keys on its SKILL.md so an empty leftover directory doesn't
 * count as installed.
 * @param {string} [skillsDirectory]
 * @returns {boolean}
 */
export function isPreflightInstalled(
  skillsDirectory = defaultSkillsDirectory(),
) {
  return existsSync(join(skillsDirectory, "preflight", "SKILL.md"));
}

/**
 * @typedef {object} InstalledSkill
 * @property {string} name - bundle directory name
 * @property {string} dir - absolute bundle dir
 * @property {string} configPath - absolute config.json path (may not exist yet)
 * @property {Record<string, unknown>} example - config.example.json contents (the key set)
 * @property {import('./jsonio.mjs').ParsedConfig} config - existing config.json (exists:false when absent)
 * @property {boolean} malformed - config.json present but unparseable → skip writes
 */

/**
 * Discover every installed skill that ships a `config.example.json` (i.e. has a
 * config surface to reconcile). This bundle itself is skipped (it has no config).
 * @param {string} [skillsDirectory]
 * @returns {InstalledSkill[]}
 */
export function discoverSkills(skillsDirectory = defaultSkillsDirectory()) {
  if (!existsSync(skillsDirectory)) {
    return [];
  }

  /** @type {InstalledSkill[]} */
  const skills = [];
  const entries = readdirSync(skillsDirectory, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );

  for (const entry of entries) {
    if (SELF_CONFIGURING.has(entry.name)) {
      continue;
    }

    const directory = join(skillsDirectory, entry.name);
    const examplePath = join(directory, "config.example.json");
    // No config surface → nothing to reconcile (also skips initialise-skills).
    if (!existsSync(examplePath)) {
      continue;
    }

    let example;
    try {
      example = parseConfig(readFileSync(examplePath, "utf8")).data;
    } catch {
      // A malformed example means we can't know the key set — skip the skill.
      continue;
    }

    const configPath = join(directory, "config.json");
    let config;
    let malformed = false;
    try {
      config = readConfig(configPath);
    } catch {
      // config.json exists but is unparseable: don't risk clobbering it.
      config = {
        data: {},
        exists: true,
        indent: 2,
        keyOrder: [],
        trailingNewline: true,
      };
      malformed = true;
    }

    skills.push({
      config,
      configPath,
      dir: directory,
      example,
      malformed,
      name: entry.name,
    });
  }

  return skills.toSorted((a, b) => a.name.localeCompare(b.name));
}
