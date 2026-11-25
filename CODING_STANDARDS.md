# Coding standards

Judgment calls for reviewers. Mechanical rules (banned browser dialogs, credential storage isolation, Android/Mac legacy bans, Keymanager3 parameter shapes, `/api/import` confirmation, module size caps) are enforced by `pnpm run check`; extend `web/webos/lint.mjs`, JSDoc types, or `web/webos/state-machine.test.mjs` instead of adding prose here.

## UI minimalism

- Show device status badges only for abnormal or actionable states: `Unavailable`, `Stale`, `Offline`. Routine states (`Live`, `Simulated`) carry no label.
- The setup trigger reads `Sync & connect` until Home Assistant is connected, then `Settings`.
- OLED Dark (`#000000` canvas, low-luminance panels) is the default TV appearance once theme selection ships.

## Atomic contract changes

When an adapter endpoint payload changes (for example `/api/import` or light control actions), update every caller and the acceptance fixtures in the same PR. Verify state transitions across `demo`/`standalone` × `visible`/`hidden` × `connected`/`offline`.

## Renderer boundary

Put TV-specific renderer hooks in `web/src/vendor/three/tv.js` or in upstream PRs to `repparw/house-control`. Keep `web/patches/@house-control__visuals@0.0.0.patch` limited to WIP `world.js` hooks and shrinking.
