---
trigger: manual
description: "Rules for writing Git commit messages following Conventional Commits: short, modern and friendly."
---

# Git Commit Rules

Commit message convention for the Yumebako Startpage project:

## 1. Standard Structure (Conventional Commits)
Syntax:
```text
type(scope): subject

[optional body: bullet points]
```

### Type (kind of change):
- `feat`: New feature or improvement to a user-facing feature.
- `fix`: Bug fix, fixing a defect.
- `refactor`: Restructuring the source code (no change in external behavior).
- `style`: CSS, layout or animation changes (no logic change).
- `perf`: Performance optimization, less lag, optimized rendering.
- `docs`: Documentation, rules or README updates.
- `chore`: Config, build tool, dependencies, sort locales.

### Scope (area of impact):
Written in parentheses, lowercase:
- `widgets`, `wallpaper`, `settings`, `storage`, `ui`, `i18n`, `particles`, `core`.

### Subject (commit title):
- **Language:** English.
- **Tone:** Short, direct and easy to understand (even a newcomer / low-code reader knows instantly what changed).
- **Rules:**
  - Start with a lowercase letter.
  - Use the imperative mood: `add` (not `added`), `fix` (not `fixed`), `update`, `enhance`, `remove`, `support`, `prevent`.
  - Do not put a period (`.`) at the end of the title line.

---

## 2. Body (when a commit contains many big changes)
If a single commit contains many small changes, add a body with short bullet points:
```bash
git commit -m "feat(widgets): enhance edit mode

- Add 9 resize handles with boundary clamping
- Upgrade anchor selector with SVG icons and dropdown style
- Support custom width and height in settings"
```

---

## 3. AI behavior when asked to commit
Whenever the user asks for a commit (or mentions writing a commit):
1. **Check the changed files:** Review the actual list of modified/added files.
2. **Provide a ready-to-copy command:**
   - List the files that should be `git add`-ed explicitly (avoid careless `git add .`).
   - Include the complete `git commit -m "..."` command following the convention above.
3. **Provide 2 options (when suitable):**
   - Option 1: a short one-liner.
   - Option 2: a detailed version with bullet points.
