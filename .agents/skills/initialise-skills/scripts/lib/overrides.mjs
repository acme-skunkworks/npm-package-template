// Parse and validate `--set <skill>.<key>=<value>` CLI overrides into a per-skill
// map the reconcile can apply, so a caller can push an arbitrary config value a
// detector would never produce (A-704).
//
// The reconcile's config keys are flat, so a `--set` address is exactly two
// segments: the skill (bundle directory name) and a top-level config key. We
// split the address on the FIRST `.` and the assignment on the FIRST `=`, so a
// value may itself contain dots or `=` (e.g. `--set changelog.baseBranch=release/2.0`).
//
// Validation is strict and refuses rather than guesses: the skill must be
// installed, the key must exist in that skill's config.example.json, and the
// coerced value's JSON type must match the example placeholder's type. Values are
// parsed as JSON (so `true` / `42` / `["A"]` type correctly), falling back to a
// bare string when they aren't valid JSON (so `develop` stays "develop").
//
// Pure: no filesystem, no process.exit — `resolveOverrides` collects errors for
// the caller to surface and decide on.

/**
 * Config keys that must never be written through the bracket-notation assignment
 * below — they could reach `Object.prototype` and pollute it. Belt-and-braces atop
 * the config.example allowlist (the key must also be an own key of the example).
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Split one `--set` argument into `{ skill, key, rawValue }`. Splits on the first
 * `=` (value keeps any further `=`) then the first `.` (key keeps any further `.`,
 * though config keys are flat today). Throws a descriptive Error on a malformed
 * shape — a missing `=`, a missing `.`, or an empty skill/key segment.
 * @param {string} raw
 * @returns {{ skill: string, key: string, rawValue: string }}
 */
export function parseSetAssignment(raw) {
  const shape = `--set expects <skill>.<key>=<value>, got "${raw}"`;
  const eq = raw.indexOf("=");
  if (eq === -1) {
    throw new Error(`${shape} (no "=")`);
  }

  const address = raw.slice(0, eq);
  const rawValue = raw.slice(eq + 1);
  const dot = address.indexOf(".");
  if (dot === -1) {
    throw new Error(`${shape} (no "." separating skill from key)`);
  }

  const skill = address.slice(0, dot);
  const key = address.slice(dot + 1);
  if (!skill || !key) {
    throw new Error(`${shape} (empty skill or key)`);
  }

  return { key, rawValue, skill };
}

/**
 * Coerce a raw CLI value to a JSON value: parse it as JSON so `true`, `42`, and
 * `["A"]` type correctly, and fall back to the bare string when it isn't valid
 * JSON (so `develop` stays the string "develop").
 * @param {string} rawValue
 * @returns {unknown}
 */
export function coerceValue(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

/**
 * The JSON type tag of a value, distinguishing arrays and null from plain
 * objects (which `typeof` lumps together). Used to type-check an override against
 * its config.example.json placeholder.
 * @param {unknown} value
 * @returns {"array" | "object" | "null" | "string" | "number" | "boolean"}
 */
export function jsonType(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

/**
 * A JSON type tag with the grammatically-correct indefinite article, so the
 * type-mismatch error reads "an array" / "an object" rather than "a array".
 * @param {ReturnType<typeof jsonType>} type
 * @returns {string}
 */
function withArticle(type) {
  return `${/^[aeiou]/.test(type) ? "an" : "a"} ${type}`;
}

/**
 * Validate a list of raw `--set` arguments against the installed skills and
 * resolve them into a per-skill override map. Each argument must parse, name an
 * installed skill, name a key in that skill's config.example.json, and coerce to
 * a value whose JSON type matches the example placeholder's type — otherwise it
 * is collected as an error. A later assignment to the same skill+key wins.
 * @param {string[]} rawSetArgs
 * @param {import('./discover.mjs').InstalledSkill[]} skills
 * @returns {{ overrides: Map<string, Record<string, unknown>>, errors: string[] }}
 */
export function resolveOverrides(rawSetArgs, skills) {
  /** @type {Map<string, Record<string, unknown>>} */
  const overrides = new Map();
  /** @type {string[]} */
  const errors = [];
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  for (const raw of rawSetArgs) {
    let parsed;
    try {
      parsed = parseSetAssignment(raw);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    const { key, rawValue, skill: skillName } = parsed;

    // Reject prototype-polluting keys before the bracket-notation write further
    // down (`overrides.get(skillName)[key] = value`). The config.example allowlist
    // would normally exclude them, but guard the raw user-supplied key directly.
    if (DANGEROUS_KEYS.has(key)) {
      errors.push(
        `--set "${skillName}.${key}": "${key}" is not an assignable config key`,
      );
      continue;
    }

    const skill = byName.get(skillName);
    if (!skill) {
      errors.push(
        `--set "${skillName}.${key}": "${skillName}" is not an installed skill`,
      );
      continue;
    }

    // A skill whose config.json is unparseable is skipped by the reconcile loop
    // (never written, to avoid clobbering it), so an override targeting it would
    // be silently dropped at exit 0. Refuse it up front instead — fail fast,
    // consistent with the rest of --set's validation.
    if (skill.malformed) {
      errors.push(
        `--set "${skillName}.${key}": ${skillName}'s config.json is malformed and cannot be updated`,
      );
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(skill.example, key)) {
      errors.push(
        `--set "${skillName}.${key}": "${key}" is not a known config key for ${skillName} (not in config.example.json)`,
      );
      continue;
    }

    const value = coerceValue(rawValue);
    const wantType = jsonType(skill.example[key]);
    const gotType = jsonType(value);
    if (wantType !== gotType) {
      errors.push(
        `--set "${skillName}.${key}": expected ${withArticle(wantType)} value but got ${withArticle(gotType)} (${JSON.stringify(value)})`,
      );
      continue;
    }

    if (!overrides.has(skillName)) {
      overrides.set(skillName, {});
    }

    overrides.get(skillName)[key] = value;
  }

  return { errors, overrides };
}
