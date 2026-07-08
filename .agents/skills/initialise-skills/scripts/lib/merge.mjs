// Three-way reconcile for a skill's config.json (A-409).
//
// Per key we hold three values:
//   base   — the placeholder from the skill's config.example.json (or undefined)
//   ours   — the value in the host repo's existing config.json (or undefined)
//   theirs — the detector's output for this key (or null = "couldn't detect")
//
// The classifier decides, per key, whether to write the detected value, leave a
// deliberate edit alone (drift), or flag a value the caller must supply. The
// guiding rule (A-409): NEVER clobber a deliberate manual edit. Drift is kept by
// default and only overwritten when the caller opts in per key (acceptDrift).
//
// `classifyKey` and `mergeConfig` are pure — no filesystem, no git — so the whole
// table is unit-testable by passing plain objects.

/**
 * Recursive structural equality for JSON values (objects, arrays, primitives).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a !== "object") {
    return false;
  }

  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) {
    return false;
  }

  return ak.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
  );
}

/**
 * Order-insensitive equality for a pair of string arrays (treated as sets).
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    return false;
  }

  // Compare as true sets so duplicates don't mask a difference: ["ASW","ASW"]
  // and ["ASW","SK"] are NOT equal (sizes 1 vs 2), so a duplicated issueKeys
  // value isn't silently treated as unchanged.
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) {
    return false;
  }

  for (const item of setA) {
    if (!setB.has(item)) {
      return false;
    }
  }

  return true;
}

// Keys whose array value is semantically a set: detecting ["ASW","SK"] when the
// config says ["SK","ASW"] is NOT drift, so we compare order-insensitively (and
// keep the existing order on write to avoid churn).
const SET_KEYS = new Set(["issueKeys"]);

/**
 * Key-aware equality: set semantics for SET_KEYS, deep structural for everything
 * else.
 * @param {string} key
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function valuesEqual(key, a, b) {
  if (SET_KEYS.has(key)) {
    return sameSet(a, b);
  }

  return deepEqual(a, b);
}

/**
 * @typedef {object} KeyResult
 * @property {"inferred" | "unchanged" | "drift" | "needs-manual-input" | "manual-kept" | "unknown-kept" | "set"} status - how the key was classified
 * @property {unknown} [write] - value to persist (inferred / accepted drift / set)
 * @property {unknown} [keep] - value left untouched (drift / manual-kept / unknown-kept)
 * @property {unknown} [detected] - detector value (drift — shown alongside `keep`)
 * @property {unknown} [from] - previous value an explicit `set` override replaced (omitted when the key was unset)
 */

/**
 * Classify a single key against base / ours / theirs.
 * @param {string} key
 * @param {unknown} base   config.example.json placeholder (undefined if absent)
 * @param {unknown} ours   existing config.json value (undefined if absent)
 * @param {{ value: unknown } | null} theirs detector output (null = undetectable)
 * @returns {KeyResult}
 */
export function classifyKey(key, base, ours, theirs) {
  // `theirs` is `{ value } | null` by contract — null is the only "not detected"
  // signal, so a bare null check is sufficient (and an accidental undefined
  // surfaces loudly rather than being silently swallowed).
  const detected = theirs !== null;
  const value = detected ? theirs.value : undefined;
  const hasOurs = ours !== undefined;
  const hasBase = base !== undefined;

  // No existing value: take the detected one, else flag for manual input.
  if (!hasOurs) {
    return detected
      ? { status: "inferred", write: value }
      : { status: "needs-manual-input" };
  }

  // Existing value already equals the detected one — nothing to do.
  if (detected && valuesEqual(key, ours, value)) {
    return { status: "unchanged" };
  }

  // Existing value is still the example placeholder — safe to fill in.
  if (hasBase && valuesEqual(key, ours, base)) {
    return detected
      ? { status: "inferred", write: value }
      : { keep: ours, status: "needs-manual-input" };
  }

  // A real value that differs from what we detected: a deliberate edit. Keep it.
  if (detected) {
    return { detected: value, keep: ours, status: "drift" };
  }

  // A real value we have no detector for: keep it, no flag (nothing to compare).
  return { keep: ours, status: "manual-kept" };
}

/**
 * Reconcile one skill's config against detected facts.
 *
 * `detect(key)` returns `{ value }` when the key is detectable, else null. It is
 * a function (not a precomputed map) so detectors run lazily and can be stubbed
 * in tests. `acceptDrift` is the per-key opt-in: keys listed there have their
 * drift overwritten with the detected value.
 * @param {object} params
 * @param {Record<string, unknown>} params.example  config.example.json contents (key set + placeholders)
 * @param {Record<string, unknown>} params.config   existing config.json contents
 * @param {(key: string) => ({ value: unknown } | null)} params.detect
 * @param {string[]} [params.acceptDrift]  keys whose drift the caller accepts
 * @param {Record<string, unknown>} [params.set]  explicit `--set` overrides for
 *   this skill (already validated to example keys); each wins over detection.
 * @returns {{
 *   results: Record<string, KeyResult>,
 *   data: Record<string, unknown>,
 *   changed: boolean,
 * }}
 */
export function mergeConfig({
  acceptDrift = [],
  config,
  detect,
  example,
  set = {},
}) {
  const exampleKeys = Object.keys(example ?? {});
  const configKeys = Object.keys(config ?? {});
  // Example drives reconciliation; config-only keys are reported but never touched.
  const keys = [...new Set([...exampleKeys, ...configKeys])];
  const acceptSet = new Set(acceptDrift);

  /** @type {Record<string, KeyResult>} */
  const results = {};
  /** @type {Record<string, unknown>} */
  const data = { ...config };

  for (const key of keys) {
    const inExample = Object.prototype.hasOwnProperty.call(example ?? {}, key);
    const inConfig = Object.prototype.hasOwnProperty.call(config ?? {}, key);

    // A key the consumer added that no skill template knows about: leave it be.
    if (!inExample && inConfig) {
      results[key] = { keep: config[key], status: "unknown-kept" };
      continue;
    }

    const base = inExample ? example[key] : undefined;
    const ours = inConfig ? config[key] : undefined;
    const theirs = detect(key);
    let result = classifyKey(key, base, ours, theirs);

    // Per-key opt-in: an accepted drift becomes an applied write.
    if (result.status === "drift" && acceptSet.has(key)) {
      result = { status: "inferred", write: result.detected };
    }

    results[key] = result;

    if (result.status === "inferred" && "write" in result) {
      data[key] = result.write;
    }
  }

  // Explicit `--set` overrides win over whatever detection classified: the caller
  // has already validated each key against config.example.json and coerced the
  // value, so we apply it verbatim and authoritatively — `data[key]` always ends
  // up exactly what was asked for, so the persisted value matches the reported
  // `write`. `had`/`from` read the ORIGINAL `config`, not `data`: when a key has
  // both a live detector and a `--set` (the documented "detection still runs and
  // your values are layered on top" case) an earlier `inferred` write has already
  // mutated `data[key]`, so reading `data` would report the in-run inferred value —
  // not the real previous `config.json` value — and mark `had` true for a
  // never-previously-set key. `changed` is NOT accumulated per key; it is computed
  // once after the loop from the final `data` vs the original (see below).
  const original = config ?? {};
  for (const [key, value] of Object.entries(set)) {
    const had = Object.prototype.hasOwnProperty.call(original, key);
    /** @type {KeyResult} */
    const result = { status: "set", write: value };
    if (had) {
      result.from = original[key];
    }

    results[key] = result;

    data[key] = value;
  }

  // Report `changed` from the net result, once, after all inferred + `--set`
  // writes: a change survived only if the final `data` differs from the original
  // `config`. This correctly reports `false` when a `--set` restores a key that
  // detection had inferred away (the intermediate inferred write is undone, so
  // there is no net change). `deepEqual` is EXACT (order-sensitive for arrays),
  // not the set-aware `valuesEqual`: a reordering `--set` on a set-semantic key
  // (`issueKeys`) is a genuine change the user asked for and must still count.
  const changed = !deepEqual(data, original);

  return { changed, data, results };
}

/**
 * Statuses that represent an applied change (for summary counts).
 */
export const APPLIED_STATUSES = new Set(["inferred", "set"]);
