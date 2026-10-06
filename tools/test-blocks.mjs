#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/test-blocks.mjs — vérifie les données de blocs livrées au jeu.
 *
 *   node tools/test-blocks.mjs
 *
 * Contrôle :
 *   1. cohérence de mc/blocks.js (identifiants, noms, catégories, propriétés) ;
 *   2. cohérence de l’atlas (index ↔ image, dimensions) ;
 *   3. géométrie de chacun des blocs via mc/geom.js (le code utilisé en jeu) :
 *      triangles, normales unitaires, UV dans l’atlas, boîte englobante ;
 *   4. que chaque texture déclarée dans les blocs existe bien dans l’atlas.
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/blocks.js'), 'utf8'))(win);
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/geom.js'), 'utf8'))(win);
const { MC_BLOCKS: B, MC_ATLAS: A, MC_CATS: CATS, MC_VERSION } = win;
const Geom = win.MCGeom;

let fails = 0, warns = 0;
const fail = (m) => { console.log('   ❌ ' + m); fails++; };
const warn = (m) => { console.log('   ⚠️  ' + m); warns++; };
const ok = (m) => console.log('   ✅ ' + m);

/* ---------------------------------------------------------------- 1. données */
console.log(`\n📦 Vérification des blocs Minecraft ${MC_VERSION} (${B.length} blocs)\n`);
const ids = new Set(), names = new Set();
const byCat = {};
for (const b of B) {
  if (ids.has(b.id)) fail(`identifiant en double : ${b.id}`);
  ids.add(b.id);
  if (!/^[a-z0-9_]+$/.test(b.id)) fail(`identifiant invalide : ${b.id}`);
  if (!b.name || typeof b.name !== 'string') fail(`nom manquant : ${b.id}`);
  names.add(b.name);
  if (!CATS.some(([k]) => k === b.cat)) fail(`catégorie inconnue (${b.cat}) : ${b.id}`);
  byCat[b.cat] = (byCat[b.cat] || 0) + 1;
  if (b.name !== names.values().next().value && !/[\u00a0-\uffff]/.test(b.name) && b.name === b.id) warn(`nom non traduit : ${b.id}`);
  for (const k of ['solid', 'light', 'hard', 'res']) if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) fail(`${k} invalide (${b[k]}) : ${b.id}`);
  if (b.light < 0 || b.light > 15) fail(`lumière hors bornes (${b.light}) : ${b.id}`);
  if (!Array.isArray(b.boxes) || !b.boxes.length) fail(`aucune géométrie : ${b.id}`);
  if (A.idx[b.main] === undefined) fail(`texture principale absente de l’atlas (${b.main}) : ${b.id}`);
}
ok(`${B.length} blocs, ${ids.size} identifiants uniques`);
ok(`catégories : ` + CATS.map(([k, l]) => `${l} ${byCat[k] || 0}`).join(' · '));

/* ----------------------------------------------------------------- 2. atlas */
const atlasFile = path.join(ROOT, 'textures/minecraft/atlas.png');
let atlasPng = null;
if (!fs.existsSync(atlasFile)) fail('textures/minecraft/atlas.png manquant');
else {
  atlasPng = PNG.sync.read(fs.readFileSync(atlasFile));
  if (atlasPng.width !== A.w || atlasPng.height !== A.h) fail(`taille de l’atlas ${atlasPng.width}×${atlasPng.height} ≠ décrite ${A.w}×${A.h}`);
  else ok(`atlas ${atlasPng.width}×${atlasPng.height}, ${Object.keys(A.idx).length} tuiles de ${A.tile}px`);
  const maxIdx = Object.keys(A.idx).length;
  if (maxIdx > A.cols * A.rows) fail(`${maxIdx} textures pour ${A.cols * A.rows} tuiles`);
}
if (atlasPng) for (const name of ['fire_0', 'soul_fire_0']) {
  const i = A.idx[name];
  if (i === undefined) { fail(`texture animée absente de l’atlas : ${name}`); continue; }
  const ox = (i % A.cols) * A.tile, oy = Math.floor(i / A.cols) * A.tile;
  let visible = false;
  for (let y = 0; y < A.tile && !visible; y++) for (let x = 0; x < A.tile; x++) {
    if (atlasPng.data[((oy + y) * atlasPng.width + ox + x) * 4 + 3] > 7) { visible = true; break; }
  }
  if (!visible) fail(`première image animée transparente dans l’atlas : ${name}`);
}
const blocksDir = path.join(ROOT, 'textures/minecraft/blocks');
if (!fs.existsSync(blocksDir)) fail('textures/minecraft/blocks/ manquant (textures officielles)');
else ok(`${fs.readdirSync(blocksDir).length} textures officielles dans textures/minecraft/blocks/`);
const iconFile = path.join(ROOT, 'textures/minecraft/block-icons.png');
if (!fs.existsSync(iconFile)) fail('textures/minecraft/block-icons.png manquant (icônes 3D pré-calculées)');
else {
  const icons = PNG.sync.read(fs.readFileSync(iconFile)), size = 64, cols = 16, rows = Math.ceil(B.length / cols);
  if (icons.width !== cols * size || icons.height !== rows * size) fail(`taille de l’atlas d’icônes ${icons.width}×${icons.height} (attendu ${cols * size}×${rows * size})`);
  else {
    const blank = [];
    for (let i = 0; i < B.length; i++) {
      const ox = (i % cols) * size, oy = Math.floor(i / cols) * size;
      let visible = false;
      for (let y = 0; y < size && !visible; y++) for (let x = 0; x < size; x++) {
        if (icons.data[((oy + y) * icons.width + ox + x) * 4 + 3] > 7) { visible = true; break; }
      }
      if (!visible) blank.push(B[i].id);
    }
    if (blank.length) fail(`${blank.length} icônes transparentes : ${blank.slice(0, 6).join(', ')}`);
    else ok(`atlas d’icônes 3D : ${B.length} vignettes visibles (${cols}×${rows}, tuiles ${size}px)`);
  }
}

/* --------------------------------------------------------------- 3. géométrie */
let tris = 0, heavy = null, emptyBoxes = 0, badUv = 0, badNormal = 0, outOfRange = 0, missingTex = new Set();
const atlas = { ...A, pixels: null };
for (const b of B) {
  const g = Geom.block(b, atlas);
  if (!g.count) fail(`géométrie vide : ${b.id}`);
  tris += g.count / 3;
  if (!heavy || g.count > heavy.count) heavy = { id: b.id, count: g.count };
  for (let i = 0; i < g.uv.length; i++) if (g.uv[i] < -1e-6 || g.uv[i] > 1 + 1e-6) badUv++;
  for (let i = 0; i < g.count; i++) {
    const o = i * 3;
    const n = Math.hypot(g.normal[o], g.normal[o + 1], g.normal[o + 2]);
    if (Math.abs(n - 1) > 1e-3) badNormal++;
  }
  for (let i = 0; i < g.count * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = g.position[i + k];
      if (!Number.isFinite(v) || Math.abs(v) > 2.2) outOfRange++;
    }
  }
  if (g.min[1] > 1.001 || g.max[1] < -0.001) emptyBoxes++;
  for (const box of b.boxes) for (const f of Object.values(box[6])) {
    const t = typeof f === 'string' ? f : f.t;
    if (A.idx[t] === undefined) missingTex.add(t);
  }
}
if (badUv) fail(`${badUv} coordonnées de texture hors de l’atlas`);
if (badNormal) fail(`${badNormal} normales non unitaires`);
if (outOfRange) fail(`${outOfRange} sommets en dehors de la zone du bloc`);
if (emptyBoxes) warn(`${emptyBoxes} blocs sans géométrie dans la case`);
if (missingTex.size) fail(`${missingTex.size} textures utilisées absentes de l’atlas : ${[...missingTex].slice(0, 5).join(', ')}`);
if (!badUv && !badNormal && !outOfRange && !missingTex.size) ok(`géométrie valide : ${Math.round(tris)} triangles, max ${heavy.id} (${heavy.count / 3} triangles)`);

/* --------------------------------------------------- 4. propriétés remarquables */
const expect = {
  stone: { solid: 1, light: 0 },
  torch: { solid: 0, light: 14 },
  water: { solid: 0 },
  glowstone: { light: 15 },
  oak_stairs: { facing: 1 },
  oak_log: { pillar: 1 },
  glass: { pix: 1 },
  tinted_glass: { pix: 2 },
  dandelion: { solid: 0, pix: 1 }
};
const byId = new Map(B.map(b => [b.id, b]));
for (const [id, checks] of Object.entries(expect)) {
  const b = byId.get(id);
  if (!b) { fail(`bloc attendu absent : ${id}`); continue; }
  for (const [k, v] of Object.entries(checks)) if (b[k] !== v) fail(`${id} : ${k} = ${b[k]} (attendu ${v})`);
}
ok('blocs témoins conformes (torche lumineuse, eau traversable, escalier orientable, bûche à axe…)');
for (const id of ['chest', 'trapped_chest', 'air', 'barrier']) if (byId.has(id)) fail(`${id} ne devrait pas être dans l’inventaire`);

/* ------------------------------------------------------------------- 5. résumé */
console.log(`\n${fails ? '❌' : '✅'} ${fails} erreur(s), ${warns} avertissement(s)\n`);
process.exit(fails ? 1 : 0);
