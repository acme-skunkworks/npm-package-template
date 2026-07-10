// Unit tests for the initialise-package-repo shared-skills pull (A-776).
// Asserts argv construction (locked skill set, both agents, --copy, no -g) and
// that dry-run never spawns while write records the runner call + status.

import {
  AGENT_SKILLS_SOURCE,
  buildSkillsAddArgv,
  pullSharedSkills,
  SHARED_SKILLS,
} from "../../.claude/skills/initialise-package-repo/scripts/lib/pull-skills.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("buildSkillsAddArgv", () => {
  it("targets agent-skills with every locked skill, both agents, and --copy", () => {
    const argv = buildSkillsAddArgv();
    expect(argv[0]).toBe("npx");
    expect(argv[1]).toBe("skills");
    expect(argv[2]).toBe("add");
    expect(argv[3]).toBe(AGENT_SKILLS_SOURCE);

    for (const skill of SHARED_SKILLS) {
      const index = argv.indexOf(skill);
      expect(index).toBeGreaterThan(-1);
      expect(argv[index - 1]).toBe("--skill");
    }

    expect(argv).toContain("--copy");
    expect(argv).not.toContain("-g");
    expect(argv).not.toContain("--global");

    const agentFlags = argv
      .map((value, index) => (value === "--agent" ? argv[index + 1] : null))
      .filter(Boolean);
    expect(agentFlags).toEqual(["claude-code", "cursor"]);
  });

  it("never includes the repo-local initialise-package-repo scaffolder", () => {
    expect(SHARED_SKILLS).not.toContain("initialise-package-repo");
    expect(buildSkillsAddArgv().join(" ")).not.toContain(
      "initialise-package-repo",
    );
  });

  it("honours an explicit skills override", () => {
    expect(buildSkillsAddArgv(["send-it", "preflight"])).toEqual([
      "npx",
      "skills",
      "add",
      AGENT_SKILLS_SOURCE,
      "--skill",
      "send-it",
      "--skill",
      "preflight",
      "--agent",
      "claude-code",
      "--agent",
      "cursor",
      "--copy",
    ]);
  });
});

describe("pullSharedSkills", () => {
  it("dry-run reports pending and does not invoke the runner", () => {
    const calls = [];
    const result = pullSharedSkills({
      run: (cmd, args, options) => {
        calls.push({ args, cmd, opts: options });
        return { status: 0 };
      },
      write: false,
    });

    expect(result.status).toBe("pending");
    expect(result.skills).toEqual([...SHARED_SKILLS]);
    expect(result.argv).toEqual(buildSkillsAddArgv());
    expect(calls).toEqual([]);
  });

  it("write path spawns npx skills add from repoRoot and reports pulled", () => {
    const calls = [];
    const result = pullSharedSkills({
      repoRoot: "/tmp/spawned-pkg",
      run: (cmd, args, options) => {
        calls.push({ args, cmd, opts: options });
        return { status: 0, stdout: "ok\n" };
      },
      write: true,
    });

    expect(result.status).toBe("pulled");
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("npx");
    expect(calls[0].args[0]).toBe("skills");
    expect(calls[0].args).toContain("--copy");
    expect(calls[0].args).not.toContain("-g");
    expect(calls[0].opts.cwd).toBe("/tmp/spawned-pkg");
  });

  it("write path surfaces a non-zero exit as error with stderr detail", () => {
    const result = pullSharedSkills({
      run: () => ({ status: 1, stderr: "network down\n" }),
      write: true,
    });

    expect(result.status).toBe("error");
    expect(result.detail).toBe("network down");
  });

  it("write path surfaces a signal kill distinctly from a null exit status", () => {
    const result = pullSharedSkills({
      run: () => ({ signal: "SIGTERM", status: null }),
      write: true,
    });

    expect(result.status).toBe("error");
    expect(result.detail).toBe("npx skills add killed by SIGTERM");
  });

  it("honours a skills override on the write path", () => {
    const calls = [];
    const result = pullSharedSkills({
      run: (cmd, args) => {
        calls.push({ args, cmd });
        return { status: 0 };
      },
      skills: ["send-it"],
      write: true,
    });

    expect(result.status).toBe("pulled");
    expect(result.skills).toEqual(["send-it"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      "skills",
      "add",
      AGENT_SKILLS_SOURCE,
      "--skill",
      "send-it",
      "--agent",
      "claude-code",
      "--agent",
      "cursor",
      "--copy",
    ]);
    for (const skill of SHARED_SKILLS) {
      if (skill === "send-it") {
        continue;
      }

      expect(calls[0].args).not.toContain(skill);
    }
  });

  it("matches every skill in skills-lock.json (minus the repo-local scaffolder)", () => {
    const lock = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "skills-lock.json"),
        "utf8",
      ),
    );
    const locked = Object.keys(lock.skills).toSorted();
    expect(locked).not.toContain("initialise-package-repo");
    expect([...SHARED_SKILLS].toSorted()).toEqual(locked);
  });
});
