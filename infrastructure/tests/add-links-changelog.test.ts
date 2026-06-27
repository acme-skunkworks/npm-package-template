import {
  rewriteBody,
  splitFrontmatter,
} from "../scripts/add-links-changelog.js";
import { describe, expect, it } from "vitest";

describe("rewriteBody", () => {
  it("links bare A issue IDs", () => {
    expect(rewriteBody("Closes A-123 and A-7.")).toBe(
      "Closes [A-123](https://linear.app/acme-skunkworks/issue/A-123) and [A-7](https://linear.app/acme-skunkworks/issue/A-7).",
    );
  });

  it("leaves IDs inside inline code untouched", () => {
    expect(rewriteBody("Use `A-123` literally.")).toBe(
      "Use `A-123` literally.",
    );
  });

  it("leaves IDs inside fenced code blocks untouched", () => {
    const body = "```\nA-123\n```\n";
    expect(rewriteBody(body)).toBe(body);
  });

  it("does not double-link an already-linked ID", () => {
    const body = "[A-123](https://linear.app/acme-skunkworks/issue/A-123)";
    expect(rewriteBody(body)).toBe(body);
  });

  it("does not match unknown team keys", () => {
    expect(rewriteBody("See ZZZ-1.")).toBe("See ZZZ-1.");
  });

  it("leaves literal text that looks like a mask token untouched", () => {
    // Pre-sentinel, the restore pass would have mangled bare "FENCE0"/"LINK0".
    expect(rewriteBody("Set placeholder FENCE0 and LINK0 in the doc.")).toBe(
      "Set placeholder FENCE0 and LINK0 in the doc.",
    );
  });

  it("links an ID even when a mask-token-like string is also present", () => {
    expect(rewriteBody("FENCE0 — closes A-9.")).toBe(
      "FENCE0 — closes [A-9](https://linear.app/acme-skunkworks/issue/A-9).",
    );
  });
});

describe("splitFrontmatter", () => {
  it("splits leading frontmatter from the body", () => {
    const raw = '---\ntitle: "x"\n---\n\n## Added\n\n- y\n';
    const { body, fm } = splitFrontmatter(raw);
    expect(fm).toBe('---\ntitle: "x"\n---\n');
    expect(body).toBe("\n## Added\n\n- y\n");
  });

  it("returns the whole string as body when there's no frontmatter", () => {
    const { body, fm } = splitFrontmatter("no frontmatter here");
    expect(fm).toBe("");
    expect(body).toBe("no frontmatter here");
  });

  it("splits an empty frontmatter block (closing fence at index 3)", () => {
    const { body, fm } = splitFrontmatter("---\n---\n\n## Added\n\n- y\n");
    expect(fm).toBe("---\n---\n");
    expect(body).toBe("\n## Added\n\n- y\n");
  });
});
