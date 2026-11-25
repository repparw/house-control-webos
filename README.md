# House Control for webOS

Standalone 3D Home Assistant controller for LG webOS TVs (`dev.housecontrol.webos`). Installs without root and stays independent of LG Home and third-party launchers.

Based on [House Control TV](https://github.com/0xProbabillity/house-control-tv) by [@0xProbabillity](https://github.com/0xProbabillity) and the shared [`@house-control/visuals`](https://github.com/0xProbabillity/house-control/pull/29) Three.js renderer.

## Features

- Interactive 3D floor-plan model rendered with WebGL 2 via `@house-control/visuals`, tuned for TV GPUs
- D-pad, OK, Back, and Magic Remote pointer navigation
- Direct Home Assistant `/api/websocket` authentication, live `state_changed` updates, and device/scene control
- Hardware-backed credential encryption via LG Keymanager3 (webOS TV 24+)
- Confirmed in-app floor-plan JSON import with isolated demo mode

## Build and verify

From `web/` with Node 24 and pnpm 10.28.1:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` runs `lint`, `typecheck`, `test` (including the BFS state-machine check), `build`, and headless Chromium `test:acceptance`.

Package an `.ipk`:

```sh
npx --yes --package=@webos-tools/cli@3.2.6 ares-package dist --outdir ../.local/webos
```

Prebuilt `.ipk` files are attached to GitHub Releases and every CI run. See [docs/webos.md](docs/webos.md) for architecture, Keymanager3 constraints, and installation notes (including the warning against enabling LG Developer Mode on already-rooted TVs).

## License and attribution

- Application code: MIT License ([LICENSE](LICENSE)), preserving upstream attribution to 0xProbability ([UPSTREAM-LICENSE](UPSTREAM-LICENSE), [UPSTREAM-REVISION](UPSTREAM-REVISION)).
- LG `webOSTV.js` 1.2.13: Apache License 2.0 ([web/webos/vendor/LICENSE-2.0.txt](web/webos/vendor/LICENSE-2.0.txt)), bundled with the packaged IPK.
