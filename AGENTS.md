# Agent guide

## Where to look

- **Architecture, invariants, backlog, opt-in TV deploy:** [`docs/webos.md`](docs/webos.md).
- **Product Owner coordinator workflow:** [`.agents/skills/product-owner/SKILL.md`](.agents/skills/product-owner/SKILL.md) when scoping, delegating, or cutting releases.
- **Review judgment calls:** [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
- **Headless WebGL UI verification:** [`web/webos/acceptance.mjs`](web/webos/acceptance.mjs), run via `pnpm run test:acceptance` from `web/`.

## Environment rules

- **TV access is opt-in.** Verify locally with `pnpm run check` from `web/`. SSH to, install on, or relaunch the LG C3 only when the user explicitly requests hardware verification.
- **Browser choice for WebGL and SSO.** The T3 embedded preview cannot create WebGL2 contexts or complete Authelia passkey sign-in. Use `pnpm run test:acceptance` (headless Chromium + SwiftShader) for automated WebGL checks, and Browse MCP for interactive WebGL or SSO pages.
