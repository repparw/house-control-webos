import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize, linkOf, createWorld, FURNITURE_TYPES, FURNITURE_VARIANTS, WINDOW_SASHES, footprint, surfaceHeight, isWallMounted } from '@house-control/visuals';
import { buildFurniture } from '@house-control/visuals/three/furniture';
import { normalize as compatibilityNormalize } from '../src/vendor/config.js';

test('TV uses PR #29 shared plan parser, including linked devices and levels', async () => {
  const raw = JSON.parse(await readFile(new URL('../public/plans/demo-loft.json', import.meta.url)));
  raw.lights[0].link = { service: 'homeassistant', id: 'light.kitchen' };
  raw.scenes[0].toggle = true;
  const plan = normalize(raw);
  assert.ok(Array.isArray(plan.levels) && plan.levels.length);
  assert.equal(plan.scenes[0].toggle, true);
  assert.deepEqual(linkOf(plan.lights[0]), { service: 'homeassistant', id: 'light.kitchen' });
  assert.deepEqual(compatibilityNormalize(raw), plan);
  assert.equal(typeof createWorld, 'function');
});

test('shared visuals preserve showPlinth, window sashes, variants, and stacked primitives', () => {
  const plan = normalize({
    name: 'Fixture check',
    showPlinth: false,
    rooms: [{ id: 'main', name: 'Main', rect: [0, 0, 5, 4], floor: 'stone' }],
    openings: [
      { type: 'window', from: [5, 1], to: [5, 2], sill: 0.6, head: 2.0, sash: 'casement' },
      { type: 'window', from: [1, 0], to: [2, 0], sill: 1.3, head: 1.8, frosted: true, sash: 'upperSliding' },
    ],
    furniture: [
      { type: 'tv', pos: [2, 0.2], width: 1.05, variant: 'wall', y: 1.02 },
      { type: 'sofa', pos: [2, 2], width: 2.2, variant: 'plain' },
      { type: 'pillow', pos: [1.6, 2], y: 0.47 },
      { type: 'bed', pos: [3.5, 3], width: 1.4, depth: 1.95 },
      { type: 'glassCupboard', pos: [4, 2], width: 1.13, height: 1.7, color: '#48485e' },
      { type: 'wardrobe', pos: [4, 3.2], width: 1.58, height: 1.85, color: '#bc966b' },
      { type: 'cabinet', pos: [1, 0.4], width: 0.62, depth: 0.44, height: 0.94 },
      { type: 'oven', pos: [1, 0.4], y: 0.94 },
      { type: 'airFryer', pos: [1, 0.4], y: 1.272 },
      { type: 'wallShelf', pos: [1.8, 0.2], y: 0.98 },
      { type: 'kettle', pos: [1.96, 0.2], y: 1.008 },
      { type: 'coffeeGrinder', pos: [1.61, 0.215], y: 1.008 },
      { type: 'coffeeBag', pos: [1.755, 0.184], y: 1.008 },
      { type: 'vanity', pos: [0.6, 3], width: 0.55, variant: 'pedestal' },
      { type: 'toilet', pos: [0.6, 2.2], variant: 'concealed' },
      { type: 'coffeeTable', pos: [2, 1.0], width: 0.66, depth: 0.38, height: 0.43, variant: 'woodShelf' },
    ],
    lights: [
      { id: 'l1', room: 'main', type: 'ceiling', pos: [2, 2], shade: 'paperDrum' },
      { id: 'l2', room: 'main', type: 'bulkhead', pos: [0.5, 3] },
    ],
  });

  assert.equal(plan.showPlinth, false);
  assert.deepEqual(WINDOW_SASHES, ['fixed', 'casement', 'upperSliding']);
  assert.deepEqual(FURNITURE_VARIANTS.tv, ['console', 'wall']);
  assert.equal(isWallMounted(plan.furniture[0]), true);
  assert.equal(surfaceHeight(plan.furniture[1]), 0.47);
  assert.equal(surfaceHeight(plan.furniture[6]), 0.94);
  assert.ok(FURNITURE_TYPES.includes('airFryer'));
  assert.deepEqual(footprint(plan.furniture[0]), [1.05, 0.055]);
  assert.deepEqual(footprint(plan.furniture[3]), [1.5, 1.95]);
  assert.deepEqual(footprint(plan.furniture[4]), [1.13, 0.32]);
  const built = buildFurniture(plan.furniture, { interiorWallHeight: 1.25 });
  assert.equal(built.children.length, plan.furniture.length);
});
