#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/build-mc-blocks.mjs — génère les données de blocs Minecraft du jeu.
 *
 * Entrée  : tools/mcdata/  (voir tools/fetch-mcdata.sh)
 * Sortie  : textures/minecraft/blocks/*.png   (textures officielles, 16×16)
 *           textures/minecraft/atlas.png      (feuille de textures = 1 seule image)
 *           textures/minecraft/atlas.json     (plan de l'atlas)
 *           mc/blocks.js                      (base de données des blocs, lue par le jeu)
 *
 * Le script :
 *   1. résout chaque bloc Minecraft (état par défaut → modèle → parents) en
 *      géométrie (liste de pavés 3D) + texture par face ;
 *   2. récupère les propriétés de gameplay (solidité, lumière, dureté, outil,
 *      résistance) depuis minecraft-data ;
 *   3. classe chaque bloc dans une catégorie d'inventaire créatif ;
 *   4. cuit les teintes (herbe, feuilles, eau…) dans l'atlas : plus besoin de
 *      logique de biome côté jeu ;
 *   5. écrit mc/blocks.js.
 *
 * Usage :  node tools/build-mc-blocks.mjs
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'tools/mcdata');
const TEX_SRC = path.join(DATA, 'textures');
const TEX_OUT = path.join(ROOT, 'textures/minecraft/blocks');
const ATLAS_OUT = path.join(ROOT, 'textures/minecraft/atlas.png');
const MC_OUT = path.join(ROOT, 'mc');
const VERSION = process.env.MC_VERSION || '1.21.4';
const TILE = 16;               // taille d'une tuile de l'atlas
const ATLAS_COLS = 32;         // colonnes de l'atlas
const warn = [];
const read = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ 1. données */
const models = read('blocks_models.json');
const states = read('blocks_states.json');
const reps = read('blocks_textures.json');
const mcprops = read('mcdata_blocks.json');
const fr = read('fr_fr.json');
const en = read('en_us.json');

const TEX_AVAILABLE = new Set(fs.readdirSync(TEX_SRC).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)));
const clean = v => String(v).replace(/^minecraft:/, '').replace(/^blocks?\//, '');
const parentKey = v => clean(String(v || '')).replace(/^block\//, '');

/* ------------------------------------------------------- 2. teintes (biomes)
 * Minecraft colore par biome certaines textures grises (herbe, feuilles, eau…).
 * On les cuit directement dans l'atlas avec la couleur du biome « plaine ». */
const TINT_COLORS = {
  grass: [0x91, 0xbd, 0x59], foliage: [0x77, 0xab, 0x2f], spruce: [0x61, 0x99, 0x61],
  birch: [0x80, 0xa7, 0x55], water: [0x3f, 0x76, 0xe4], lilypad: [0x20, 0x80, 0x30],
  stem: [0x7f, 0xaf, 0x3a], redstone: [0xff, 0x00, 0x00]
};
// modèle de base qui introduit un tintindex → type de teinte
const TINT_TEMPLATES = {
  leaves: { all: 'foliage' }, tinted_cross: { cross: 'grass' }, grass_block: { top: 'grass', overlay: 'grass' },
  vine: { vine: 'foliage' }, lily_pad: { texture: 'lilypad' }, template_cauldron_full: { content: 'water' },
  tinted_flower_pot_cross: { plant: 'grass' }, stem_fruit: { stem: 'stem', upperstem: 'stem' },
  template_single_face: {}, stonecutter: {}
};

/* ---------------------------------------------------- 3. résolution des modèles */
function resolveModel(key) {
  const textures = {}, elems = [], chain = [];
  let cur = key, guard = 0;
  while (cur && guard++ < 24) {
    const m = models[cur];
    if (!m) { chain.push('(base:' + cur + ')'); break; }
    chain.push(cur);
    if (m.textures) for (const [k, v] of Object.entries(m.textures)) if (!(k in textures)) textures[k] = clean(v);
    if (m.elements && !elems.length) elems.push(...m.elements);
    cur = m.parent ? parentKey(m.parent) : null;
  }
  // références indirectes  #all -> textures.all
  const deref = (v, depth = 0) => {
    if (typeof v !== 'string' || depth > 8) return null;
    if (!v.startsWith('#')) return TEX_AVAILABLE.has(v) ? v : null;
    const key = v.slice(1);
    return key in textures ? deref(textures[key], depth + 1) : null;
  };
  // teinte héritée : (modèle, variable) -> type
  const tintOf = new Map();
  for (const c of chain) {
    const t = TINT_TEMPLATES[c];
    if (t) for (const [k, v] of Object.entries(t)) tintOf.set(k, v);
  }
  return { textures, elems, chain, deref, tintOf };
}

/* état par défaut d'un bloc : on veut le modèle « debout », fermé, éteint… */
const VARIANT_SCORE = [
  [/axis=y/, 120], [/facing=north/, 60], [/half=bottom/, 40], [/shape=straight/, 40],
  [/lit=false/, 25], [/open=false/, 25], [/powered=false/, 25], [/extended=false/, 25],
  [/snowy=false/, 10], [/waterlogged=false/, 10], [/up=false/, 8],
  [/(age|stage|bites|moisture|power|distance|level)=0/, 6]
];
function pickModel(id) {
  const rep = reps[Object.keys(reps).find(k => reps[k].name === id)];
  const st = states[id];
  const candidates = [];
  if (st?.variants) for (const [k, v] of Object.entries(st.variants)) {
    const list = Array.isArray(v) ? v : [v];
    let s = 0;
    for (const [re, add] of VARIANT_SCORE) if (re.test(k)) s += add;
    for (const item of list) {
      const mod = parentKey(item.model);
      candidates.push({ mod, score: s + (mod === id ? 1000 : 0) });
    }
  }
  // multipart (barrières, murets, vitres, bambou…) : on prend les morceaux
  // toujours présents (le poteau central) plutôt qu'un modèle inexistant.
  if (st?.multipart) {
    const parts = st.multipart.flatMap(part =>
      (Array.isArray(part.apply) ? part.apply : [part.apply]).map(a => ({ mod: parentKey(a.model), always: !part.when })));
    const chosen = parts.find(p => p.always && models[p.mod]) || parts.find(p => models[p.mod]);
    if (chosen) candidates.push({ mod: chosen.mod, score: 500 });
  }
  if (rep) candidates.push({ mod: parentKey(rep.model), score: 400 });
  candidates.push({ mod: id, score: 0 });
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) if (models[c.mod]) return c.mod;
  return candidates[0].mod;
}

/* blocs volontairement absents : invisibles, techniques ou non posables */
const EXCLUDE = new Set(['air', 'cave_air', 'void_air', 'moving_piston', 'piston_head', 'bubble_column',
  'light', 'barrier', 'structure_void', 'flowing_water', 'flowing_lava', 'end_portal', 'end_gateway',
  // rendus par des entités dans Minecraft (aucun modèle de bloc) : le jeu a son
  // propre coffre fonctionnel à 27 cases, on n’affiche pas ces deux-là.
  'chest', 'trapped_chest']);

/* ------------------------------------------------------------- 4. géométrie */
const FACE_KEYS = { down: 'd', up: 'u', north: 'n', south: 's', east: 'e', west: 'w' };
function buildGeometry(id, R) {
  const el = R.elems;
  if (!el.length) return null;
  const boxes = [];
  for (const e of el) {
    if (!Array.isArray(e.from) || !Array.isArray(e.to)) continue;
    const faces = {};
    for (const [fk, fv] of Object.entries(e.faces || {})) {
      const short = FACE_KEYS[fk];
      const tex = R.deref(fv.texture);
      if (!short || !tex) continue;
      const uv = Array.isArray(fv.uv) ? fv.uv.slice(0, 4).map(Number) : [0, 0, 16, 16];
      const tint = 'tintindex' in fv ? (R.tintOf.get(String(fv.texture).replace(/^#/, '')) || 'grass') : null;
      faces[short] = { t: tex, uv, r: +fv.rotation || 0, ...(tint ? { tint } : {}) };
    }
    if (!Object.keys(faces).length) continue;
    let from = e.from.map(Number), to = e.to.map(Number);
    let rot = null;
    if (e.rotation && Number.isFinite(Number(e.rotation.angle))) {
      const o = e.rotation.origin.map(Number), ax = e.rotation.axis, ang = Number(e.rotation.angle);
      if (e.rotation.rescale && ang) {          // agrandit la pièce pour qu'elle ne paraisse pas étirée
        const k = Math.min(4, 1 / Math.abs(Math.cos(ang * Math.PI / 180)));
        for (let i = 0; i < 3; i++) if ('xyz'[i] !== ax) {
          from[i] = o[i] + (from[i] - o[i]) * k;
          to[i] = o[i] + (to[i] - o[i]) * k;
        }
      }
      rot = [o[0], o[1], o[2], ax, ang];
    }
    boxes.push({ from, to, faces, rot });
  }
  return boxes.length ? boxes : null;
}

/* noms des faces d'un cube (modèles sans éléments : eau, lave, portails…) */
const CUBE_FACES = {
  u: ['up', 'top', 'end', 'all', 'texture', 'particle'], d: ['down', 'bottom', 'end', 'all', 'texture', 'particle'],
  n: ['north', 'front', 'side', 'all', 'texture', 'particle'], s: ['south', 'side', 'back', 'all', 'texture', 'particle'],
  e: ['east', 'side', 'all', 'texture', 'particle'], w: ['west', 'side', 'all', 'texture', 'particle']
};
const SPECIAL_TEX = {   // blocs rendus par un moteur maison chez Mojang (pas de modèle)
  water: 'water_still', flowing_water: 'water_flow', lava: 'lava_still', flowing_lava: 'lava_flow',
  fire: 'fire_0', soul_fire: 'soul_fire_0', nether_portal: 'nether_portal', end_portal: 'end_portal',
  bubble_column: 'water_still', light: 'light', moving_piston: 'piston_top', piston_head: 'piston_top'
};
const SPECIAL_TINT = { water: 'water', flowing_water: 'water', lava: null, bubble_column: 'water' };
function buildCube(id, R) {
  const t = {};
  for (const [short, keys] of Object.entries(CUBE_FACES)) {
    let tex = null;
    for (const k of keys) { tex = R.deref(R.textures[k]); if (tex) break; }
    if (tex) t[short] = tex;
  }
  if (!Object.keys(t).length && SPECIAL_TEX[id]) t.u = t.d = t.n = t.s = t.e = t.w = SPECIAL_TEX[id];
  if (!Object.keys(t).length) return null;
  const fill = t.u || t.n || Object.values(t)[0];
  for (const k of ['u', 'd', 'n', 's', 'e', 'w']) if (!t[k]) t[k] = fill;
  const tint = SPECIAL_TINT[id] || (R.tintOf.get('all') || null);
  const faces = {};
  for (const k of ['u', 'd', 'n', 's', 'e', 'w']) faces[k] = { t: t[k], uv: [0, 0, 16, 16], r: 0, ...(tint ? { tint } : {}) };
  return [{ from: [0, 0, 0], to: [16, 16, 16], faces, rot: null }];
}

/* --------------------------------------------------------- 5. propriétés jeu */
const propByName = new Map(mcprops.map(p => [p.name, p]));
const TOOLS = { 'mineable/pickaxe': 'pioche', 'mineable/axe': 'hache', 'mineable/shovel': 'pelle', 'mineable/hoe': 'houe', 'mineable/shears': 'cisailles', 'growable': 'main', 'default': 'main' };
function propsOf(id) {
  const p = propByName.get(id) || {};
  const bb = p.boundingBox;
  const solid = bb !== 'empty' && bb !== undefined ? 1 : (bb === undefined ? 1 : 0);
  return {
    solid,
    light: Math.max(0, Math.min(15, +(p.emitLight || 0))),
    hard: typeof p.hardness === 'number' ? p.hardness : 1,
    res: typeof p.resistance === 'number' ? p.resistance : 1,
    tool: TOOLS[p.material] || 'main',
    diggable: p.diggable === false ? 0 : 1
  };
}

/* drapeaux d'orientation : « facing » (se tourne vers le joueur) et
 * « pillar » (axe vertical/horizontal selon la face visée) */
const FACING_Q = { north: 0, east: 1, south: 2, west: 3 };
function orientFlags(id) {
  const st = states[id];
  let facing = 0, pillar = 0;
  if (st?.variants) for (const k of Object.keys(st.variants)) {
    if (/facing=(north|south|east|west)/.test(k)) facing = 1;
    if (/axis=(x|y|z)/.test(k)) pillar = 1;
  }
  return { facing, pillar };
}
/* Direction « avant » du modèle non tourné (0 = nord, 1 = est, 2 = sud, 3 = ouest).
 * Le modèle d'un bloc orientable est le même pour les 4 orientations : l'état
 * fait tourner le modèle (y = 90° par quart). On retrouve donc l'orientation
 * d'origine en cherchant l'état qui utilise ce modèle sans rotation. */
function canonicalFace(id, model) {
  const st = states[id];
  if (!st?.variants) return null;
  for (const [key, v] of Object.entries(st.variants)) {
    const items = Array.isArray(v) ? v : [v];
    for (const it of items) {
      if (parentKey(it.model) !== model || it.x || it.y) continue;
      const m = /(^|,)facing=(north|east|south|west)/.exec(key);
      if (m) return FACING_Q[m[2]];             // « facing=up/down » ne compte pas
      const any = /(^|,)facing=([a-z]+)/.exec(key);
      if (any && !(any[2] in FACING_Q)) continue;
    }
  }
  return null;
}

/* -------------------------------------------------------- 6. noms français */
function nameOf(id) {
  return fr['block.minecraft.' + id] || en['block.minecraft.' + id] ||
    id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

/* ----------------------------------------------------- 7. catégories créatif */
const CATS = [
  ['construction', '🧱 Blocs de construction'],
  ['nature', '🌿 Blocs naturels'],
  ['minerais', '🪨 Pierres & Minerais'],
  ['deco', '🪴 Décorations'],
  ['redstone', '🔴 Redstone & Mécanismes'],
  ['couleurs', '🎨 Laine, Béton & Couleurs'],
  ['fonctionnel', '🧰 Fonctionnel'],
  ['special', '✨ Spéciaux']
];
/* listes explicites : plus lisible qu'une méga-expression régulière */
const FLOWERS = `allium azure_bluet blue_orchid cornflower dandelion lily_of_the_valley oxeye_daisy poppy
 orange_tulip red_tulip white_tulip pink_tulip torchflower wither_rose sunflower lilac rose_bush peony
 pitcher_plant pitcher_crop spore_blossom pink_petals wildflowers open_eyeblossom closed_eyeblossom
 golden_dandelion cactus_flower big_dripleaf small_dripleaf mangrove_propagule chorus_flower`.split(/\s+/);
const NATURAL = `grass_block dirt coarse_dirt rooted_dirt podzol mycelium farmland dirt_path sand red_sand
 gravel suspicious_sand suspicious_gravel clay mud packed_mud snow_block snow powder_snow ice packed_ice blue_ice
 frost ice water lava netherrack soul_sand soul_soil magma_block end_stone obsidian crying_obsidian sculk
 cobweb dead_bush sponge wet_sponge hay_block moss_block moss_carpet pale_moss_block pale_moss_carpet
 mangrove_roots muddy_mangrove_roots big_dripleaf small_dripleaf dripleaf_plant vine glow_lichen
 cave_vines cave_vines_plant weeping_vines twisting_vines kelp kelp_plant seagrass tall_seagrass
 sugar_cane bamboo bamboo_sapling cactus melon pumpkin carved_pumpkin jack_o_lantern
 crimson_nylium warped_nylium crimson_roots warped_roots nether_sprouts nether_wart
 crimson_fungus warped_fungus red_mushroom brown_mushroom crimson_stem warped_stem
 warped_wart_block nether_wart_block shroomlight frogspawn turtle_egg sniffer_egg dragon_egg
 amethyst_cluster large_amethyst_bud medium_amethyst_bud small_amethyst_bud pointed_dripstone
 sea_pickle lily_pad glow_berries sweet_berry_bush beetroots carrots potatoes wheat
 fire soul_fire nether_portal dark_prismarine`.split(/\s+/);
const ORE_MATERIALS = `iron gold diamond emerald copper coal redstone lapis netherite amethyst quartz
 bone slime honey`.split(/\s+/);
const FUNCTIONAL = `chest trapped_chest ender_chest barrel furnace smoker blast_furnace crafting_table
 cartography_table fletching_table smithing_table loom stonecutter grindstone anvil chipped_anvil
 damaged_anvil enchanting_table brewing_stand cauldron water_cauldron lava_cauldron powder_snow_cauldron
 composter beacon conduit jukebox respawn_anchor decorated_pot bell campfire soul_campfire beehive bee_nest
 bookshelf chiseled_bookshelf scaffolding lodestone lectern flower_pot bed red_bed white_bed orange_bed
 magenta_bed light_blue_bed yellow_bed lime_bed pink_bed gray_bed light_gray_bed cyan_bed purple_bed
 blue_bed brown_bed green_bed black_bed`.split(/\s+/);
const BUILDING = `planks stairs slab wall fence fence_gate door trapdoor glass glass_pane bars bricks
 copper copper_block cut_copper copper_grate copper_bulb chiseled_copper copper_door copper_trapdoor
 sandstone red_sandstone brick terracotta concrete wool iron_bars chain lantern torch`.split(/\s+/);

const CAT_RULES = [
  ['special', id => /command_block|structure_block|structure_void|jigsaw|barrier|^bedrock$|spawner|trial_spawner|^vault$|^light$|budding_amethyst|heavy_core|end_portal_frame|reinforced_deepslate|creaking_heart|^nether_portal$|^fire$|^soul_fire$/.test(id)],
  ['fonctionnel', id => FUNCTIONAL.includes(id)],
  ['redstone', id => /_button$|_pressure_plate$|^lever$|redstone|_rail$|^rail$|piston|^observer$|dispenser|dropper|^hopper$|note_block|^tnt$|^target$|daylight_detector|sculk_sensor|calibrated_sculk_sensor|tripwire|lightning_rod|^crafter$|_bulb$|^repeater$|^comparator$/.test(id)],
  ['couleurs', id => /_wool$|_carpet$|_concrete$|_concrete_powder$|_terracotta$|_glazed_terracotta$|_stained_glass(_pane)?$|_shulker_box$/.test(id)],
  ['nature', id => NATURAL.includes(id) || FLOWERS.includes(id) || /(_log|_wood|_leaves|_sapling|_stem|_hyphae|_wart_block|_coral|_coral_block|_coral_fan|_roots|_sprouts|_seeds|_berries|_vine|_bush|_wart|_grass|_fern|_mushroom|_mushroom_block|_petals|_flower|_blossom|_lily|_fungus|_azalea|_dripleaf|_pickle|_kelp|_cactus|_canes|_propagule|_wheat|_carrots|_potatoes|_beetroots|_amyl|_snow|_ice|_sand|_gravel|_dirt|_clay|_mud|_moss)$/.test(id)],
  ['deco', id => /torch|lantern|_candle|_candle_cake|flower_pot|potted_|_sign$|_sign$|_wall_sign$|_hanging_sign|_banner|_bed$|^bell$|_head$|_skull|_wall_|^ladder$|end_rod|_cluster$|frame|^glass$|_pane$|painting|flowering_azalea|^chain$|^rail$|_wall$|^wall$|scaffolding/.test(id)],
  ['minerais', id => /_ore$|deepslate|^stone$|_stone$|^stone_|granite|diorite|andesite|^tuff|calcite|dripstone|amethyst|obsidian|netherrack|end_stone|purpur|quartz|prismarine|sea_lantern|glowstone|sculk|_bricks$|bricks$|ancient_debris|^basalt$|^blackstone$|^gilded|_block$|^polished_|^chiseled_|^cut_|^cracked_|^mossy_|^smooth_|^raw_/.test(id)],
  ['construction', id => BUILDING.some(w => id.includes(w)) || /_planks|_bricks|_tiles|_pillar|_mosaic/.test(id)],
  ['construction', () => true]
];
function categoryOf(id) {
  for (const [cat, test] of CAT_RULES) if (test(id)) return cat;
  return 'construction';
}

/* ============================================================== TRAITEMENT */
log(`\n📦 Minecraft ${VERSION} — construction de la base de blocs\n`);

/* --- 1. copie des textures officielles --- */
fs.mkdirSync(TEX_OUT, { recursive: true });
let copied = 0;
for (const f of fs.readdirSync(TEX_SRC)) {
  if (!f.endsWith('.png')) continue;
  const dst = path.join(TEX_OUT, f);
  const src = path.join(TEX_SRC, f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) { fs.copyFileSync(src, dst); copied++; }
}
log(`🖼  ${fs.readdirSync(TEX_OUT).length} textures officielles (${copied} copiées) dans textures/minecraft/blocks/`);

/* --- 2. un bloc par identifiant déclaré dans les données Mojang --- */
const ids = [...new Set(Object.values(reps).map(r => r.name))].sort();
log(`🧱 ${ids.length} blocs déclarés par les données`);

const blocks = [], skipped = [];
for (const id of ids) {
  if (EXCLUDE.has(id)) continue;
  const model = pickModel(id);
  const R = resolveModel(model);
  let boxes = buildGeometry(id, R) || buildCube(id, R);
  if (!boxes) { skipped.push(`${id} (aucune texture résolue)`); continue; }
  if (!boxes.length) { skipped.push(`${id} (géométrie vide)`); continue; }
  if (!boxes.some(b => Object.keys(b.faces).length)) { skipped.push(`${id} (aucune face texturée)`); continue; }
  const p = propsOf(id);
  const first = boxes[0].faces;
  const main = (first.u || first.n || first.s || Object.values(first)[0]).t;
  const orient = orientFlags(id);
  const face0 = orient.facing ? canonicalFace(id, model) : null;
  blocks.push({
    id, name: nameOf(id), cat: categoryOf(id), model: R.chain[0],
    solid: p.solid, light: p.light, hard: p.hard, res: p.res, tool: p.tool, dig: p.diggable,
    ...orient, face0, main, boxes
  });
}
log(`✅ ${blocks.length} blocs conservés` + (skipped.length ? `, ${skipped.length} écartés` : ''));

/* --- 3. atlas de textures --- */
const used = new Map();   // texture -> teinte
const addTex = (name, tint) => {
  if (!name || !TEX_AVAILABLE.has(name)) return;
  const cur = used.get(name);
  if (!cur) used.set(name, tint || null);
  else if (!cur && tint) used.set(name, tint);   // une texture teintée reste teintée
};
for (const b of blocks) for (const box of b.boxes) for (const f of Object.values(box.faces)) addTex(f.t, f.tint);
for (const [id, t] of Object.entries(SPECIAL_TEX)) addTex(t, SPECIAL_TINT[id] || null);

const names = [...used.keys()].sort();
const rows = Math.ceil(names.length / ATLAS_COLS);
const W = ATLAS_COLS * TILE, H = rows * TILE;
log(`\n🎨 Atlas : ${names.length} textures → ${ATLAS_COLS}×${rows} tuiles (${W}×${H} px)`);

const atlas = new PNG({ width: W, height: H });
atlas.data.fill(0);
const index = {};
names.forEach((n, i) => { index[n] = i; });

function loadTile(name) {
  const src = PNG.sync.read(fs.readFileSync(path.join(TEX_SRC, name + '.png')));
  const out = new PNG({ width: TILE, height: TILE });
  out.data.fill(0);
  // Les textures animées sont des images carrées empilées verticalement :
  // ne pas réduire toute l'animation en une seule tuile (cela rend, par
  // exemple, fire_0 et soul_fire_0 transparents). On ne prend que la première.
  const frame = Math.max(1, Math.min(src.width, src.height));
  for (let y = 0; y < TILE; y++) {
    const sy = Math.min(frame - 1, Math.floor(y * frame / TILE));
    for (let x = 0; x < TILE; x++) {
      const sx = Math.min(frame - 1, Math.floor(x * frame / TILE));
      const s = (sy * src.width + sx) * 4, d = (y * TILE + x) * 4;
      out.data[d] = src.data[s]; out.data[d + 1] = src.data[s + 1]; out.data[d + 2] = src.data[s + 2]; out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}
const tinted = [];
const texAlpha = {};                       // texture -> 0 opaque / 1 découpe / 2 translucide
names.forEach((name, i) => {
  const tile = loadTile(name);
  let cut = 0, semi = 0;
  for (let k = 3; k < tile.data.length; k += 4) { const a = tile.data[k]; if (a === 0) cut = 1; else if (a < 250) semi = 1; }
  texAlpha[name] = semi ? 2 : cut ? 1 : 0;
  const tint = used.get(name);
  if (tint && TINT_COLORS[tint]) {
    const [tr, tg, tb] = TINT_COLORS[tint];
    for (let k = 0; k < tile.data.length; k += 4) { tile.data[k] = tile.data[k] * tr / 255 | 0; tile.data[k + 1] = tile.data[k + 1] * tg / 255 | 0; tile.data[k + 2] = tile.data[k + 2] * tb / 255 | 0; }
    tinted.push(name);
  }
  const px = (i % ATLAS_COLS) * TILE, py = Math.floor(i / ATLAS_COLS) * TILE;
  PNG.bitblt(tile, atlas, 0, 0, TILE, TILE, px, py);
});
fs.mkdirSync(path.dirname(ATLAS_OUT), { recursive: true });
fs.writeFileSync(ATLAS_OUT, PNG.sync.write(atlas));
fs.writeFileSync(path.join(ROOT, 'textures/minecraft/atlas.json'), JSON.stringify({
  version: VERSION, tile: TILE, cols: ATLAS_COLS, rows, width: W, height: H,
  note: 'Tuile i → colonne i%cols, ligne floor(i/cols). Voir mc/blocks.js (MC_ATLAS.idx).',
  textures: index
}, null, 0) + '\n');
log(`   ${fs.statSync(ATLAS_OUT).size / 1024 | 0} Ko · ${tinted.length} textures teintées (herbe, feuilles, eau…)`);

/* --- 3a. couleur moyenne de la texture principale (icônes, main, objets au sol) --- */
function tileAvg(name) {
  try {
    const p = PNG.sync.read(fs.readFileSync(path.join(TEX_SRC, name + '.png')));
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      if (p.data[i + 3] < 24) continue;
      r += p.data[i]; g += p.data[i + 1]; b += p.data[i + 2]; n++;
    }
    if (!n) return '#8a8a8a';
    return '#' + [r / n, g / n, b / n].map(v => Math.min(255, Math.round(v)).toString(16).padStart(2, '0')).join('');
  } catch { return '#8a8a8a'; }
}

/* --- 3b. classe alpha de chaque bloc (opaque / découpe / translucide) --- */
for (const b of blocks) {
  let pix = 0;
  for (const box of b.boxes) for (const f of Object.values(box.faces)) pix = Math.max(pix, texAlpha[f.t] ?? 0);
  b.pix = pix;
  const tint = used.get(b.main);
  const avg = tileAvg(b.main);
  b.col = tint && TINT_COLORS[tint] && avg !== '#8a8a8a'
    ? '#' + [1, 3, 5].map(i => Math.round(parseInt(avg.slice(i, i + 2), 16) * TINT_COLORS[tint][(i - 1) / 2] / 255).toString(16).padStart(2, '0')).join('')
    : avg;
}

/* --- 3c. atlas du terrain : les 8 matières du sol avec les textures Minecraft.
 * Chaque texture est divisée par sa couleur moyenne (« texture de détail ») :
 * la couleur de la matière du terrain reste visible, la texture ajoute le grain. */
const TERRAIN_TILES = ['calcite', 'grass_block_top', 'dirt', 'sand', 'stone', 'mud', 'snow', 'gray_concrete'];
(function terrainAtlas() {
  const TILE = 128, COLS = 4, ROWS = 2;
  const out = new PNG({ width: COLS * TILE, height: ROWS * TILE });
  out.data.fill(0);
  TERRAIN_TILES.forEach((name, i) => {
    const src = PNG.sync.read(fs.readFileSync(path.join(TEX_SRC, name + '.png')));
    const tint = used.get(name);
    const tinted0 = (tint && TINT_COLORS[tint]) || [255, 255, 255];
    // 1. moyenne de la texture (après teinte)
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < src.data.length; k += 4) {
      if (src.data[k + 3] < 24) continue;
      const R = src.data[k] * tinted0[0] / 255, G = src.data[k + 1] * tinted0[1] / 255, B = src.data[k + 2] * tinted0[2] / 255;
      r += R; g += G; b += B; n++;
    }
    const avg = n ? [r / n, g / n, b / n] : [128, 128, 128];
    // 2. texture de détail : la luminance moyenne de la tuile est ramenée à 128,
    //    ce qui garde la teinte (le grain) et laisse la couleur du terrain
    //    visible, puis ×8 (le sol dessine 128 px par 3 m)
    const Y = Math.max(1, .299 * avg[0] + .587 * avg[1] + .114 * avg[2]);
    const k = 128 / Y;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const sx = Math.min(src.width - 1, Math.round(x * src.width / TILE));
      const sy = Math.min(src.height - 1, Math.round(y * src.height / TILE));
      const so = (sy * src.width + sx) * 4, d = ((i >> 2) * TILE + y) * (COLS * TILE) + ((i % COLS) * TILE + x);
      const o = d * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.min(245, Math.max(15, Math.round(src.data[so + c] * tinted0[c] / 255 * k)));
      out.data[o + 3] = 255;
    }
  });
  const file = path.join(ROOT, 'textures/minecraft/terrain-atlas.png');
  fs.writeFileSync(file, PNG.sync.write(out));
  log(`🌍 Atlas du terrain : ${TERRAIN_TILES.length} matières → ${path.relative(ROOT, file)} (${fs.statSync(file).size / 1024 | 0} Ko)`);
  log('   ' + TERRAIN_TILES.join(' · '));
})();

/* --- 4. mc/blocks.js --- */
const b64 = o => JSON.stringify(o).replace(/\n/g, '');
const out = [];
out.push('/* ===========================================================================');
out.push(' * mc/blocks.js — BASE DE DONNÉES DES BLOCS MINECRAFT  (généré automatiquement)');
out.push(' * ---------------------------------------------------------------------------');
out.push(` * Source : Minecraft ${VERSION} (textures et modèles officiels, teintes de biome cuites).`);
out.push(' * Générateur : tools/build-mc-blocks.mjs — NE PAS ÉDITER À LA MAIN.');
out.push(' *');
out.push(' * MC_ATLAS  : feuille de textures (atlas.png) + index des tuiles 16×16.');
out.push(' * MC_CATS   : catégories de l’inventaire créatif  [clé, libellé].');
out.push(' * MC_BLOCKS : un objet par bloc :');
out.push(' *   id      identifiant Minecraft (ex. « oak_planks »)');
out.push(' *   name    nom affiché (français officiel)');
out.push(' *   cat     catégorie de l’inventaire créatif');
out.push(' *   solid   1 = solide (collision), 0 = traversable (fleur, eau, torche…)');
out.push(' *   light   émission de lumière 0-15');
out.push(' *   hard    dureté (temps de casse), res = résistance, tool = outil efficace');
out.push(' *   facing  1 = orientable (l’avant se tourne vers le joueur au moment de la pose)');
out.push(' *   face0   direction du modèle au repos : 0 nord · 1 est · 2 sud · 3 ouest');
out.push(' *   pillar  1 = bloc à axe (bûche, pilier…) : couché si posé contre une face latérale');
out.push(' *   pix     0 = opaque, 1 = découpe (alphaTest), 2 = translucide (verre teinté, eau, glace)');
out.push(' *   col     couleur moyenne du bloc (icônes, objet en main, objet au sol)');
out.push(' *   main    texture principale (icône, barre rapide)');
out.push(' *   boxes   géométrie : [x0,y0,z0,x1,y1,z1, faces, rotation?] en 1/16 de bloc');
out.push(' *           faces = {u,d,n,s,e,w} → {t:texture, uv:[u1,v1,u2,v2]?, r:0|90|180|270?}');
out.push(' *           (uv et r sont omis quand ils valent la tuile entière / 0 ;');
out.push(' *            la rotation d’un pavé vaut [ox,oy,oz,axe,angle] en 1/16 et degrés)');
out.push(' * =========================================================================== */');
out.push(`window.MC_VERSION=${JSON.stringify(VERSION)};`);
out.push(`window.MC_ATLAS=${JSON.stringify({ file: 'textures/minecraft/atlas.png', tile: TILE, cols: ATLAS_COLS, rows, w: W, h: H, idx: index })};`);
out.push(`window.MC_CATS=${JSON.stringify(CATS)};`);
out.push('window.MC_BLOCKS=[');
for (const b of blocks) {
  const boxes = b.boxes.map(bx => {
    const faces = {};
    for (const [k, f] of Object.entries(bx.faces)) {
      const full = f.uv[0] === 0 && f.uv[1] === 0 && f.uv[2] === 16 && f.uv[3] === 16;
      if (full && !f.r) faces[k] = f.t;
      else { const o = { t: f.t }; if (!full) o.uv = f.uv; if (f.r) o.r = f.r; faces[k] = o; }
    }
    return [bx.from[0], bx.from[1], bx.from[2], bx.to[0], bx.to[1], bx.to[2], faces, bx.rot || 0];
  });
  out.push(`{id:${JSON.stringify(b.id)},name:${JSON.stringify(b.name)},cat:${JSON.stringify(b.cat)},solid:${b.solid},light:${b.light},hard:${b.hard},res:${b.res},tool:${JSON.stringify(b.tool)},dig:${b.dig}` +
    (b.facing ? ',facing:1' : '') + (b.pillar ? ',pillar:1' : '') +
    (b.facing && b.face0 !== null && b.face0 !== undefined ? `,face0:${b.face0}` : '') + (b.pix ? `,pix:${b.pix}` : '') + `,col:${JSON.stringify(b.col)}` +
    `,main:${JSON.stringify(b.main)},model:${JSON.stringify(b.model)},boxes:[${boxes.map(JSON.stringify).join(',')}]},`);
}
out.push('];');
out.push('window.MC_COUNT=' + blocks.length + ';');
fs.mkdirSync(MC_OUT, { recursive: true });
fs.writeFileSync(path.join(MC_OUT, 'blocks.js'), out.join('\n') + '\n');
log(`💾 mc/blocks.js : ${(fs.statSync(path.join(MC_OUT, 'blocks.js')).size / 1024).toFixed(0)} Ko`);

/* --- 5. rapport --- */
const byCat = {};
for (const b of blocks) (byCat[b.cat] = byCat[b.cat] || []).push(b.id);
log('\n📊 Catégories :');
for (const [k, label] of CATS) {
  const l = byCat[k] || [];
  log(`   ${label.padEnd(30)} ${String(l.length).padStart(4)}`);
  if (process.env.MC_REPORT) log('        ' + l.slice(0, 60).join(', '));
}
log(`   ${blocks.filter(b => b.facing).length} orientables · ${blocks.filter(b => b.pillar).length} blocs à axe · ` +
  `pix : ${blocks.filter(b => b.pix === 0).length} opaques / ${blocks.filter(b => b.pix === 1).length} découpe / ${blocks.filter(b => b.pix === 2).length} translucides`);
const heavy = blocks.filter(b => b.boxes.length > 12).sort((a, b) => b.boxes.length - a.boxes.length).slice(0, 8);
if (heavy.length) log('\n⚠  Blocs les plus complexes (nb de pavés) : ' + heavy.map(b => `${b.id}:${b.boxes.length}`).join(' · '));
const noName = blocks.filter(b => !fr['block.minecraft.' + b.id]);
if (noName.length) log(`\nℹ  ${noName.length} blocs sans traduction française officielle (nom anglais utilisé) : ` + noName.slice(0, 8).map(b => b.id).join(', '));
const noProp = blocks.filter(b => !propByName.has(b.id));
if (noProp.length) warn.push(`${noProp.length} blocs sans propriétés minecraft-data : ` + noProp.slice(0, 8).map(b => b.id).join(', '));
if (skipped.length) log(`\n⚠  Blocs écartés faute de textures : ${skipped.length}\n   ` + skipped.slice(0, 20).join('\n   '));
for (const w of warn) log('⚠  ' + w);
log('\n✨ Terminé.\n');
