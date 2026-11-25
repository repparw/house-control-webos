---
name: product-owner
description: Thin Product Owner coordinator for House Control for webOS. Use when planning slices, delegating implementation to OpenCode developer subagents, integrating branches, or cutting a release.
---

# Product Owner coordinator

Keep this thread lean: own scope, interface contracts, mechanical guardrails, branch integration, and release gating. Delegate implementation slices to disposable OpenCode developer subagents in isolated worktrees, and keep large diffs, raw logs, and exploration noise out of coordinator context.

## Developer pool (OpenCode via `delegate_task`)

Call `orchestrator_capabilities` once per thread before the first `delegate_task`. Assign narrow, disjoint slices (`isolation: "worktree"`, `role: "implementation"`) to:

- `orcarouter/deepseek/deepseek-v4-flash-free` (or `nvidia/deepseek-ai/deepseek-v4.1-flash` if free quota hits)
- `nvidia/minimaxai/minimax-m3.1-flash`
- `nous-portal/meituan/longcat-2.5:free`

## Operating loop

1. **Contract & guardrail first.** Before fanning out parallel worktrees, land any shared payload/state contract in JSDoc types (`web/src/webos.js`, `web/src/api.js`) or mechanical checks (`web/webos/lint.mjs`, `web/webos/state-machine.test.mjs`) on `main` so parallel slices never collide on interfaces.
2. **Mechanical checks over prose reviews.** Let `pnpm run check` (`lint`, `typecheck`, `test`, `build`, `test:acceptance`) do the bulk of developer correction. Require every developer subagent to pass `corepack pnpm run check` and commit cleanly before returning; only check `CODING_STANDARDS.md` judgment calls during integration.
3. **Disjoint ownership.** Give each subagent an explicit file list, acceptance test requirement, and red-on-bug expectation. Never let two parallel subagents edit the same file (`web/src/main.js` or `web/src/style.css` should be owned by one slice at a time, or split into small helper modules such as `web/src/webos-theme.js` / `web/src/webos-light-modal.js`).
4. **Stay lean.** Do not dump full file contents or long logs into coordinator replies. Report concise 3–5 bullet deltas per completed slice (commit SHA, `pnpm run check` result, remaining v1 items).
5. **Hardware stays opt-in.** Never SSH to, install on, or relaunch the LG C3 unless the user explicitly asks for an on-TV test.
6. **Release gate (`v1.0.0`).** Before tagging `v1.0.0`, confirm: all 4 v1 backlog items in `docs/webos.md` pass `pnpm run check`, `web/webos/appinfo.json` and `web/package.json` are `1.0.0`, MIT + Apache-2.0 notices are intact in `dist/`, and the user approves tagging/pushing `v1.0.0`.
