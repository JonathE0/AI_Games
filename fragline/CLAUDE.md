# Fragline — working agreement

## Roles
- **Opus (the main session) is the architect.** It talks with the user, plans features, designs data models,
  messages and interfaces, splits work into clear specs, reviews what comes back, runs the final checks and
  reports to the user.
- **Builder agents do most of the heavy programming** through the `fragline-builder` agent
  (`.claude/agents/fragline-builder.md`). Pick the model by the task's weight (the user has the Max plan): heavy,
  subtle or multi-file work (new systems, networking, refactors) runs on Opus via the Agent tool's `model: "opus"`
  override; light mechanical edits (numbers, small UI tweaks, fixtures) can stay on the default Sonnet. Hand it self-contained specs: goal, files to touch, exact behavior and
  numbers, message/data shapes, edge cases, and which tests to add. Independent pieces can go to separate
  builder runs in parallel; pieces that touch the same files go to one run or run in sequence.
- Opus still does small fixes (a few lines), cross-cutting integration, debugging tricky failures and anything
  that needs the user's decision. Always review the builder's diff and test result before telling the user it's done.

## Reporting
Keep output minimal while working; give the user one compact summary at the end: what changed, problems hit,
and how they were solved.

## Checks
- `npm test` must pass before a task is called done.
- Browser checks use a debug server on port 3001; mute page audio while testing. The user's own server runs on
  port 3000 — restart it with the new code only when a task is finished.

## Releasing
- `origin` is https://github.com/JonathE0/zombie-holdout (branch `master`). Netlify builds the browser solo
  version from it on every push (`netlify.toml` → `npm run build:static` → `dist/`), so pushing is deploying.
- After pushing, mirror the tracked files into `../AI_Games/fragline/` and commit + push that repo too.
