import {
  readPackageVersion,
  stampVersion,
} from "../scripts/stamp-changelog-version.js";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";

function entry(versionLine: string): string {
  return [
    "---",
    'title: "x"',
    'created_at: "2026-05-23T14:55:37Z"',
    versionLine,
    "category: fix",
    "breaking: false",
    "---",
    "",
    "## Fixed",
    "",
    "- x",
    "",
  ].join("\n");
}

describe("stampVersion", () => {
  it("stamps the version onto an entry with an empty placeholder", () => {
    const out = stampVersion(entry("version:"), "1.2.0");
    expect(out).not.toBeNull();
    expect(matter(out as string).data.version).toBe("1.2.0");
  });

  it("returns null (no write) when the entry already has a version", () => {
    expect(stampVersion(entry('version: "1.0.0"'), "1.2.0")).toBeNull();
  });

  it("stamps when the version field is entirely absent", () => {
    const raw =
      '---\ntitle: x\ncreated_at: "2026-05-23T14:55:37Z"\ncategory: fix\nbreaking: false\n---\n\n## Fixed\n\n- x\n';
    const out = stampVersion(raw, "2.0.0");
    expect(matter(out as string).data.version).toBe("2.0.0");
  });
});

describe("readPackageVersion", () => {
  it("reads a string version", () => {
    expect(
      readPackageVersion(JSON.stringify({ name: "p", version: "3.4.5" })),
    ).toBe("3.4.5");
  });

  it("throws when version is missing", () => {
    expect(() => readPackageVersion(JSON.stringify({ name: "p" }))).toThrow(
      /missing a string `version`/,
    );
  });
});
