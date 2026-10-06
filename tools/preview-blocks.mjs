#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/preview-blocks.mjs — planche d'aperçu des blocs Minecraft du jeu.
 *
 * Dessine (rendu logiciel, sans WebGL) une vignette isométrique de chaque bloc
 * demandé, à partir des données réellement livrées au jeu (mc/blocks.js +
 * textures/minecraft/atlas.png) et du même code de géométrie (mc/geom.js).
 * Sert à vérifier d'un coup d'œil que textures, orientation et géométrie sont
 * bonnes.
 *
 *   node tools/preview-blocks.mjs                       # 96 blocs emblématiques
 *   node tools/preview-blocks.mjs stone oak_stairs …    # blocs choisis
 *   node tools/preview-blocks.mjs --all                 # tous les blocs
 *   SIZE=48 COLS=12 node tools/preview-blocks.mjs       # taille / colonnes
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SIZE = +(process.env.SIZE || 64);
const COLS = +(process.env.COLS || 16);

/* --- charge les données du jeu (mc/blocks.js + mc/geom.js) --- */
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/blocks.js'), 'utf8'))(win);
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/geom.js'), 'utf8'))(win);
const { MC_BLOCKS, MC_ATLAS } = win;
const MCGeom = win.MCGeom;

const atlasPNG = PNG.sync.read(fs.readFileSync(path.join(ROOT, 'textures/minecraft/atlas.png')));
const atlas = { ...MC_ATLAS, pixels: atlasPNG.data };

/* --- choix des blocs --- */
const args = process.argv.slice(2);
let blocks;
if (args.includes('--all')) blocks = MC_BLOCKS;
else if (args.length) {
  const byId = new Map(MC_BLOCKS.map(b => [b.id, b]));
  blocks = args.map(a => byId.get(a)).filter(Boolean);
  for (const a of args) if (!byId.has(a)) console.warn('⚠ bloc inconnu : ' + a);
} else {
  const demo = `stone granite diorite andesite deepslate cobblestone oak_planks spruce_planks oak_log oak_leaves
  grass_block dirt sand red_sand gravel clay bricks stone_bricks mossy_stone_bricks sandstone smooth_stone
  glass glass_pane tinted_glass iron_bars oak_door oak_trapdoor oak_fence oak_fence_gate oak_slab oak_stairs
  torch soul_torch lantern chain campfire flower_pot potted_dandelion dandelion poppy blue_orchid oak_sapling
  short_grass fern sugar_cane cactus bamboo vine lily_pad dead_bush crimson_fungus brown_mushroom
  chest crafting_table furnace bookshelf jukebox note_block tnt sponge hay_block pumpkin melon
  iron_ore diamond_ore redstone_ore ancient_debris redstone_block iron_block gold_block diamond_block
  coal_block copper_block amethyst_block quartz_block obsidian crying_obsidian glowstone sea_lantern
  sculk_sensor lever repeater comparator piston sticky_piston rail redstone_lamp target hopper
  white_wool red_wool lime_wool blue_wool black_concrete white_concrete red_terracotta lime_glazed_terracotta
  beacon conduit respawn_anchor end_rod pointed_dripstone sea_pickle coral_block brain_coral
  snow_block ice packed_ice blue_ice water lava netherrack soul_sand magma_block end_stone purpur_block
  bell barrel bee_nest sculk_catalyst sculk_shrieker trial_spawner vault command_block bedrock
  pink_petals torchflower big_dripleaf hanging_roots glow_lichen sculk_vein cave_vines
  copper_bulb copper_grate cut_copper chiseled_copper exposed_copper weathered_copper oxidized_copper
  white_bed red_bed white_banner oak_sign white_candle cake pumpkin_pie`.split(/\s+/);
  const byId = new Map(MC_BLOCKS.map(b => [b.id, b]));
  blocks = demo.map(d => byId.get(d)).filter(Boolean);
}

/* --- outil de rendu : projection isométrique + z-buffer --- */
const ANG = Math.PI / 180;
const yaw = 30 * ANG, pitch = 26.57 * ANG;       // vue « icône Minecraft »
const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
const RIGHT = [cy, 0, -sy];
const UP = [-sy * sp, cp, -cy * sp];
const FWD = [sy * cp, sp, cy * cp];              // du centre vers la caméra
function project(p) {
  const x = p[0], y = p[1] - .5, z = p[2];
  return [x * RIGHT[0] + y * RIGHT[1] + z * RIGHT[2], x * UP[0] + y * UP[1] + z * UP[2], x * FWD[0] + y * FWD[1] + z * FWD[2]];
}
const SCALE = SIZE / 1.85;

function render(def) {
  const img = new PNG({ width: SIZE, height: SIZE });
  img.data.fill(0);
  const zbuf = new Float32Array(SIZE * SIZE).fill(-1e9);
  const geo = MCGeom.block(def, atlas);
  if (!geo.count) return img;
  const pos = geo.position, nor = geo.normal, uv = geo.uv;
  // petite ombre douce sous le bloc, comme les icônes du jeu
  for (let t = 0; t < geo.count; t += 3) {
    const v = [0, 1, 2].map(i => {
      const o = (t + i) * 3, p = project([pos[o], pos[o + 1], pos[o + 2]]);
      return { s: [p[0] * SCALE + SIZE / 2, SIZE / 2 - p[1] * SCALE], z: p[2], u: uv[(t + i) * 2], v: uv[(t + i) * 2 + 1], n: [nor[o], nor[o + 1], nor[o + 2]] };
    });
    const area = (v[1].s[0] - v[0].s[0]) * (v[2].s[1] - v[0].s[1]) - (v[2].s[0] - v[0].s[0]) * (v[1].s[1] - v[0].s[1]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(v[0].s[0], v[1].s[0], v[2].s[0])));
    const x1 = Math.min(SIZE - 1, Math.ceil(Math.max(v[0].s[0], v[1].s[0], v[2].s[0])));
    const y0 = Math.max(0, Math.floor(Math.min(v[0].s[1], v[1].s[1], v[2].s[1])));
    const y1 = Math.min(SIZE - 1, Math.ceil(Math.max(v[0].s[1], v[1].s[1], v[2].s[1])));
    // éclairage simple par face, comme l'onglet créatif du jeu
    const nl = v[0].n, shade = .62 + .38 * Math.max(0, nl[1] * .55 + Math.abs(nl[0]) * .3 + Math.abs(nl[2]) * .15) +
      (nl[1] > .5 ? .06 : 0);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const cx = px + .5, cyy = py + .5;
      // poids barycentriques : b2 → v1, b3 → v2, b1 → v0
      const b2 = ((v[1].s[0] - v[0].s[0]) * (cyy - v[0].s[1]) - (v[1].s[1] - v[0].s[1]) * (cx - v[0].s[0])) / area;
      const b3 = ((cx - v[0].s[0]) * (v[2].s[1] - v[0].s[1]) - (v[2].s[0] - v[0].s[0]) * (cyy - v[0].s[1])) / area;
      const b1 = 1 - b2 - b3;
      if (b1 < 0 || b2 < 0 || b3 < 0) continue;
      const z = b1 * v[0].z + b2 * v[1].z + b3 * v[2].z;
      const o = py * SIZE + px;
      if (z <= zbuf[o]) continue;
      const u = b1 * v[0].u + b2 * v[1].u + b3 * v[2].u, vv = b1 * v[0].v + b2 * v[1].v + b3 * v[2].v;
      const tx = Math.min(atlas.w - 1, Math.max(0, Math.floor(u * atlas.w)));
      const ty = Math.min(atlas.h - 1, Math.max(0, Math.floor((1 - vv) * atlas.h)));
      const s = (ty * atlas.w + tx) * 4;
      const a = atlas.pixels[s + 3];
      if (a < 8) continue;
      zbuf[o] = z;
      const d = o * 4;
      for (let k = 0; k < 3; k++) img.data[d + k] = Math.min(255, atlas.pixels[s + k] * shade) | 0;
      img.data[d + 3] = a;
    }
  }
  return img;
}

/* --- composition de la planche --- */
const rows = Math.ceil(blocks.length / COLS);
const sheet = new PNG({ width: COLS * SIZE, height: rows * SIZE });
sheet.data.fill(0);
blocks.forEach((b, i) => {
  const img = render(b);
  const ox = (i % COLS) * SIZE, oy = Math.floor(i / COLS) * SIZE;
  PNG.bitblt(img, sheet, 0, 0, SIZE, SIZE, ox, oy);
});
const out = path.join(ROOT, 'tools/preview-blocks.png');
fs.writeFileSync(out, PNG.sync.write(sheet));
console.log(`🖼  ${blocks.length} blocs → ${path.relative(ROOT, out)} (${COLS * SIZE}×${rows * SIZE}, ${fs.statSync(out).size / 1024 | 0} Ko)`);
console.log('   ' + blocks.map(b => b.id).join(', '));
