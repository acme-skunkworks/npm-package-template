---
title: Trim the initialise-package-repo skill description under the 1024-byte limit
release_note: Shorten the initialise-package-repo skill description so skill-aware editors no longer warn about its length.
version:
created_at: "2026-07-15T10:37:14Z"
merged_at:
branch: fix-initialise-package-repo-skill-description
pr:
commit:
author: hello@robeasthope.com
co_authors: []
category: fix
breaking: false
issues: []
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Fixed

- Trimmed the `initialise-package-repo` skill's `description` frontmatter from
  1042 bytes to 972 bytes so it clears the 1024-byte skill-description limit. Skill
  loaders (e.g. the Zed editor) warn that over-long descriptions consume extra
  model-context tokens; the template seeded every spawned repo with the over-limit
  description, so each inherited the warning. The rewrite keeps the same meaning and
  trigger phrasing — just tighter wording (dropped filler, condensed the GitHub-
  settings list and the "Use right after…" clause). Applied in lockstep to both the
  `.claude/skills/` copy and the `.agents/skills/` Cursor mirror, and the skill's
  `package.json` + `SKILL.md` `metadata.version` are bumped `0.4.0` → `0.4.1`.
