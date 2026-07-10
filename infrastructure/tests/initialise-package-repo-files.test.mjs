// Unit tests for the initialise-package-repo skill's in-repo file-edit logic
// (A-663). The skill scripts are zero-dep .mjs (they travel into every spawned
// repo), so their tests are .mjs too and import the pure cores directly — no fs,
// no gh — asserting the transforms and, crucially, their idempotent no-op paths.

import { planChangelogReset } from "../../.claude/skills/initialise-package-repo/scripts/lib/changelog-reset.mjs";
import { reseedManifest } from "../../.claude/skills/initialise-package-repo/scripts/lib/manifest.mjs";
import {
  applyIdentity,
  isPlaceholderName,
} from "../../.claude/skills/initialise-package-repo/scripts/lib/package-identity.mjs";
import { reconcileRepoConfigText } from "../../.claude/skills/initialise-package-repo/scripts/lib/repo-config.mjs";
import { deriveIdentity } from "../../.claude/skills/initialise-package-repo/scripts/lib/repo-facts.mjs";
import { planSkillConfigIgnoreStrip } from "../../.claude/skills/initialise-package-repo/scripts/lib/skill-config-gitignore.mjs";
import { describe, expect, it } from "vitest";

describe("planChangelogReset", () => {
  it("deletes every dated .md entry but keeps README.md", () => {
    const plan = planChangelogReset([
      "README.md",
      "20260701-155554-a-437-thing.md",
      "20260703-095959-a-649-other.md",
    ]);
    expect(plan).toEqual([
      "20260701-155554-a-437-thing.md",
      "20260703-095959-a-649-other.md",
    ]);
  });

  it("is a no-op when only README.md remains (idempotent)", () => {
    expect(planChangelogReset(["README.md"])).toEqual([]);
  });

  it("leaves non-markdown files untouched", () => {
    expect(planChangelogReset(["README.md", ".gitkeep", "notes.txt"])).toEqual(
      [],
    );
  });
});

describe("reseedManifest", () => {
  it("re-seeds the root entry to the package version", () => {
    const result = reseedManifest('{\n  ".": "0.0.0"\n}\n', "1.2.0");
    expect(result).not.toBeNull();
    expect(JSON.parse(result.text)["."]).toBe("1.2.0");
    expect(result.from).toBe("0.0.0");
  });

  it("returns null when already equal (idempotent no-op)", () => {
    expect(reseedManifest('{\n  ".": "1.2.0"\n}\n', "1.2.0")).toBeNull();
  });

  it("preserves other path entries in a monorepo manifest", () => {
    const result = reseedManifest(
      '{\n  ".": "0.0.0",\n  "packages/x": "3.0.0"\n}\n',
      "1.0.0",
    );
    const data = JSON.parse(result.text);
    expect(data["."]).toBe("1.0.0");
    expect(data["packages/x"]).toBe("3.0.0");
  });

  it("preserves indentation and trailing newline (byte-stable formatting)", () => {
    const result = reseedManifest('{\n    ".": "0.0.0"\n}\n', "2.0.0");
    expect(result.text).toBe('{\n    ".": "2.0.0"\n}\n');
  });
});

describe("deriveIdentity + applyIdentity", () => {
  const view = {
    defaultBranchRef: { name: "main" },
    description: "A real package",
    name: "portcullis",
    owner: { login: "acme-skunkworks" },
  };

  it("derives name, scope and URLs from the repo view", () => {
    const id = deriveIdentity(view);
    expect(id.name).toBe("@acme-skunkworks/portcullis");
    expect(id.scope).toBe("@acme-skunkworks");
    expect(id.homepage).toBe(
      "https://github.com/acme-skunkworks/portcullis#readme",
    );
    expect(id.bugsUrl).toBe(
      "https://github.com/acme-skunkworks/portcullis/issues",
    );
    expect(id.repositoryUrl).toBe(
      "https://github.com/acme-skunkworks/portcullis.git",
    );
    expect(id.defaultBranch).toBe("main");
  });

  it("falls back to @owner when a scoped override name has no slash", () => {
    // A malformed override like "@foo" must not slice to "@fo" and silently write
    // a broken npmScope downstream.
    expect(deriveIdentity(view, { name: "@foo" }).scope).toBe(
      "@acme-skunkworks",
    );
  });

  it("honours operator overrides for name/description/keywords", () => {
    const id = deriveIdentity(view, {
      description: "Custom",
      keywords: ["a"],
      name: "@acme-skunkworks/renamed",
    });
    expect(id.name).toBe("@acme-skunkworks/renamed");
    expect(id.description).toBe("Custom");
    expect(id.keywords).toEqual(["a"]);
  });

  it("rewrites the package identity block", () => {
    const pkg = {
      bugs: {
        url: "https://github.com/acme-skunkworks/npm-package-template/issues",
      },
      description: "Template repository",
      keywords: ["template"],
      name: "@acme-skunkworks/npm-package-template",
      repository: {
        type: "git",
        url: "https://github.com/acme-skunkworks/npm-package-template.git",
      },
      version: "0.0.0",
    };
    const { changed, data } = applyIdentity(
      pkg,
      deriveIdentity(view, { keywords: ["css"] }),
    );
    expect(changed).toBe(true);
    expect(data.name).toBe("@acme-skunkworks/portcullis");
    expect(data.keywords).toEqual(["css"]);
    expect(data.repository.url).toBe(
      "https://github.com/acme-skunkworks/portcullis.git",
    );
    expect(data.version).toBe("0.0.0"); // untouched — identity only
  });

  it("leaves keywords alone when none are supplied", () => {
    const pkg = {
      keywords: ["template"],
      name: "@acme-skunkworks/npm-package-template",
    };
    const { data } = applyIdentity(pkg, deriveIdentity(view));
    expect(data.keywords).toEqual(["template"]);
  });

  it("recognises the placeholder name as the not-yet-renamed signal", () => {
    expect(isPlaceholderName("@acme-skunkworks/npm-package-template")).toBe(
      true,
    );
    expect(isPlaceholderName("@acme-skunkworks/portcullis")).toBe(false);
  });
});

describe("reconcileRepoConfigText", () => {
  const yaml = [
    "# a comment",
    "defaultBranch: main",
    'npmScope: "@acme-skunkworks"',
    "npmRegistryUrl: https://registry.npmjs.org",
    "",
  ].join("\n");

  it("is a no-op for a same-org package (idempotent)", () => {
    const { changes, text } = reconcileRepoConfigText(yaml, {
      defaultBranch: "main",
      npmScope: "@acme-skunkworks",
    });
    expect(changes).toEqual({});
    expect(text).toBe(yaml);
  });

  it("rewrites a changed default branch, preserving comments and other keys", () => {
    const { changes, text } = reconcileRepoConfigText(yaml, {
      defaultBranch: "trunk",
    });
    expect(changes.defaultBranch).toEqual({ from: "main", to: "trunk" });
    expect(text).toContain("# a comment");
    expect(text).toContain("defaultBranch: trunk");
    expect(text).toContain("npmRegistryUrl: https://registry.npmjs.org");
  });

  it("preserves the quoting style of the scope value", () => {
    const { text } = reconcileRepoConfigText(yaml, { npmScope: "@acme-other" });
    expect(text).toContain('npmScope: "@acme-other"');
  });

  it("writes a value containing $-substitution sequences literally", () => {
    // `String.replace(re, string)` would interpret `$&` as the whole match; the
    // replacer-function form must keep it literal.
    const { text } = reconcileRepoConfigText(yaml, { defaultBranch: "a$&b" });
    expect(text).toContain("defaultBranch: a$&b");
  });
});

describe("planSkillConfigIgnoreStrip", () => {
  it("strips the template-seed skill-config patterns and comment block", () => {
    const raw = [
      "node_modules/",
      "",
      "# Template-seed only (A-812): keep resolved skill config.json out of the tree",
      '# copied by "Use this template". initialise-package-repo strips these lines in a',
      "# spawned consumer so initialise-skills can write trackable configs that the",
      "# consumer commits (agent-skills consumer contract). Do not copy this ignore into",
      "# a hand-rolled consumer — resolved config.json belongs in git there.",
      ".claude/skills/*/config.json",
      ".agents/skills/*/config.json",
      "",
    ].join("\n");
    const plan = planSkillConfigIgnoreStrip(raw);
    expect(plan.changed).toBe(true);
    expect(plan.text).toBe("node_modules/\n");
    expect(plan.removed).toEqual(
      expect.arrayContaining([
        ".claude/skills/*/config.json",
        ".agents/skills/*/config.json",
      ]),
    );
  });

  it("is a no-op when the patterns are already absent (idempotent)", () => {
    const raw = "node_modules/\ndist/\n";
    const plan = planSkillConfigIgnoreStrip(raw);
    expect(plan.changed).toBe(false);
    expect(plan.text).toBe(raw);
    expect(plan.removed).toEqual([]);
  });

  it("strips the legacy A-640 comment wording too", () => {
    const raw = [
      "# Per-skill agent-skills config.json is generated by the initialise-skills skill,",
      "# not committed (agent-skills v1.1.0 generated-config model, A-640).",
      ".claude/skills/*/config.json",
      ".agents/skills/*/config.json",
      "",
    ].join("\n");
    const plan = planSkillConfigIgnoreStrip(raw);
    expect(plan.changed).toBe(true);
    expect(plan.text.trim()).toBe("");
  });

  it("strips bare patterns with no preceding comment", () => {
    const raw =
      "node_modules/\n.claude/skills/*/config.json\n.agents/skills/*/config.json\n";
    const plan = planSkillConfigIgnoreStrip(raw);
    expect(plan.changed).toBe(true);
    expect(plan.text).toBe("node_modules/\n");
    expect(plan.removed).toEqual(
      expect.arrayContaining([
        ".claude/skills/*/config.json",
        ".agents/skills/*/config.json",
      ]),
    );
  });

  it("does not rewrite a file that only has consecutive blank lines", () => {
    const raw = "node_modules/\n\n\ndist/\n";
    const plan = planSkillConfigIgnoreStrip(raw);
    expect(plan.changed).toBe(false);
    expect(plan.text).toBe(raw);
    expect(plan.removed).toEqual([]);
  });
});
