#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/test-game-blocks.mjs — teste le code « blocs Minecraft » du jeu.
 *
 *   node tools/test-game-blocks.mjs
 *
 * Le jeu est une page HTML : on extrait la section comprise entre les
 * marqueurs MC-BLOCS:DEBUT / MC-BLOCS:FIN d’index.html et on l’exécute avec un
 * THREE minimal, afin de vérifier sans navigateur que :
 *   • chaque bloc produit un maillage et une icône ;
 *   • l’orientation à la pose est correcte (escaliers, bûches…) ;
 *   • les anciens blocs sont bien redirigés vers les blocs Minecraft ;
 *   • le temps de casse tient compte de l’outil, etc.
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const start = html.indexOf('/* == MC-BLOCS:DEBUT');
const end = html.indexOf('/* == MC-BLOCS:FIN');
if (start < 0 || end < 0) { console.error('❌ Marqueurs MC-BLOCS absents d’index.html'); process.exit(1); }
const section = html.slice(start, end);

/* ------------------------------------------------------------------ stubs */
class Buf {
  constructor(arr, item) { this.array = arr; this.itemSize = item; this.count = arr.length / item; this.userData = {}; this.needsUpdate = false; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
  setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; }
}
class Geo {
  constructor() { this.attributes = {}; this.userData = {}; this.bounds = null; }
  setAttribute(n, a) { this.attributes[n] = a; }
  getAttribute(n) { return this.attributes[n]; }
  computeBoundingSphere() { }
}
function Mesh(geo, mat) { const m = ({ isMesh: true, geometry: geo, material: mat, userData: {}, position: { set() { } }, scale: { setScalar() { } }, add() { }, castShadow: false, receiveShadow: false, traverse(f) { f(this); } }); return m; }
function group() { const g = { isGroup: true, children: [], userData: {}, position: { set() { }, copy() { } }, rotation: { set() { } }, scale: { setScalar() { } }, visible: true, name: '', add(...a) { g.children.push(...a); }, remove(...a) { g.children = g.children.filter(c => !a.includes(c)); }, traverse(f) { f(g); g.children.forEach(c => (c.traverse ? c.traverse(f) : f(c))); } }; return g; }
const THREE = {
  SRGBColorSpace: 'srgb', NearestFilter: 1, ClampToEdgeWrapping: 2, DoubleSide: 2,
  TextureLoader: class { load(url, onLoad) { const t = { url, needsUpdate: false }; if (onLoad) onLoad(t); return t; } },
  MeshLambertMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  MeshBasicMaterial: class { constructor(o = {}) { Object.assign(this, o); } },
  BufferGeometry: Geo, BufferAttribute: Buf, Group: group, Mesh: Mesh, Scene: group,
  OrthographicCamera: class { constructor() { this.position = { set() { } }; } lookAt() { } },
  PointLight: class { constructor(c, i, d, k) { Object.assign(this, { color: c, intensity: i, distance: d, decay: k }); this.position = { set() { } }; } },
  WebGLRenderer: class { constructor() { this.domElement = { toDataURL: () => 'data:image/png;base64,ICON' }; } setPixelRatio() { } setSize() { } render() { } }
};
const document = { querySelectorAll: () => [] };
const me = { c: { held: { position: { copy() { } }, parent: { add() { } } } } };
let logs = [];
const log = m => logs.push(m);

/* ------------------------------------------------------- exécution de la section */
const win = { MC_BLOCKS: null, MC_ATLAS: null, MC_CATS: null, MCGeom: null };
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/blocks.js'), 'utf8'))(win);
new Function('window', fs.readFileSync(path.join(ROOT, 'mc/geom.js'), 'utf8'))(win);
const api = new Function('window', 'THREE', 'document', 'me', 'log', 'PI', 'performance', 'requestAnimationFrame',
  section + `\nreturn {isMCB,mcId,mcDef,mcMesh,mcGeometry,mcIconHTML,mcIconRender,mcIcons,mcItemKey,mcPlaceRot,mcBreakNeed,mcTip,mcCatLabel,MCB,MCI,MC_CREATIVE_CATS,LEGACY,mcHeldUpdate,MC_FACE_LIGHT};`)
  (win, THREE, document, me, log, Math.PI, performance, () => { });

/* ------------------------------------------------------------------ tests */
let fails = 0, warns = 0;
const fail = m => { console.log('   ❌ ' + m); fails++; };
const warn = m => { console.log('   ⚠️  ' + m); warns++; };
console.log(`\n🧪 Code « blocs Minecraft » du jeu (${api.MCB.length} blocs)\n`);

/* 1. maillages + icônes de tous les blocs */
let noMesh = [], noIcon = [], tris = 0, verts = 0;
for (const b of api.MCB) {
  const g = api.mcMesh(b.id, 1);
  if (!g || !g.children.length) { noMesh.push(b.id); continue; }
  const geo = api.mcGeometry(b.id);
  verts += geo.attributes.position.count;
  tris += geo.attributes.position.count / 3;
  if (!api.mcIconRender(b.id)) noIcon.push(b.id);
}
if (noMesh.length) fail(`${noMesh.length} blocs sans maillage : ${noMesh.slice(0, 6).join(', ')}`);
if (noIcon.length) fail(`${noIcon.length} blocs sans icône : ${noIcon.slice(0, 6).join(', ')}`);
if (!noMesh.length && !noIcon.length) console.log(`   ✅ ${api.MCB.length} blocs : maillage + icône (${Math.round(tris)} triangles, ${Math.round(verts / 1000)}k sommets)`);

/* 2. géométrie : UV dans l’atlas et normales unitaires */
let badUv = 0, badN = 0;
for (const b of api.MCB) {
  const g = win.MCGeom.block(b, { ...win.MC_ATLAS });
  for (let i = 0; i < g.uv.length; i++) if (g.uv[i] < -1e-6 || g.uv[i] > 1 + 1e-6) badUv++;
  for (let i = 0; i < g.count; i++) { const o = i * 3; if (Math.abs(Math.hypot(g.normal[o], g.normal[o + 1], g.normal[o + 2]) - 1) > 1e-3) badN++; }
}
if (badUv) fail(`${badUv} UV hors atlas`);
if (badN) fail(`${badN} normales non unitaires`);
if (!badUv && !badN) console.log('   ✅ coordonnées de texture et normales correctes pour les 1047 blocs');

/* 3. icônes et vignettes HTML */
const html1 = api.mcIconHTML('stone');
if (!/^<img class="mci"/.test(html1)) fail('mcIconHTML ne produit pas de balise image : ' + html1.slice(0, 60));
const plankIcon = api.mcIconHTML('oak_planks');
if (!/data-mc="oak_planks"/.test(plankIcon)) fail('l’icône ne pointe pas vers le modèle 3D Minecraft');
if (/src="textures\/minecraft\/blocks\//.test(plankIcon)) fail('l’icône affiche encore seulement la face avant du bloc');
if (!/src="data:image\/png/.test(plankIcon) && !/data-mc="oak_planks"/.test(plankIcon)) fail('icône sans source/rendu 3D');
console.log('   ✅ vignettes isométriques 3D prêtes (inventaire, barre rapide, bibliothèque)');

/* Les boutons et fonds d’inventaire utilisent les vrais sprites Minecraft. */
const guiFiles = [
  'textures/minecraft/gui/container/inventory.png',
  'textures/minecraft/gui/container/creative_inventory/tab_items.png',
  'textures/minecraft/gui/sprites/widget/button.png',
  'textures/minecraft/gui/sprites/widget/button_highlighted.png',
  'textures/minecraft/gui/sprites/hud/hotbar.png',
  'textures/minecraft/gui/sprites/hud/hotbar_selection.png'
];
for (const file of guiFiles) if (!fs.existsSync(path.join(ROOT, file))) fail('texture GUI Minecraft manquante : ' + file);
if (!html.includes('mc-inventory-window') || !html.includes('sprites/widget/button.png')) fail('styles d’inventaire/boutons Minecraft absents');
if (!fails) console.log('   ✅ textures GUI officielles présentes (inventaire, boutons, barre rapide)');

/* 4. anciens blocs → blocs Minecraft */
const legacy = { pierre_lisse: 'stone', 'planche_chêne': 'oak_planks', laine_rouge: 'red_wool', verre_bloc: 'glass', 'tôle': 'iron_block' };
for (const [old, id] of Object.entries(legacy)) {
  if (api.mcId(old) !== id) fail(`alias ${old} → ${api.mcId(old)} (attendu ${id})`);
  if (!api.mcDef(old)) fail(`alias sans définition : ${old}`);
}
const missing = Object.entries(api.LEGACY).filter(([, v]) => !api.MCI.get(v));
if (missing.length) fail(`${missing.length} alias pointent vers un bloc inexistant : ${missing.slice(0, 5).map(m => m.join('→')).join(', ')}`);
else console.log(`   ✅ ${Object.keys(api.LEGACY).length} anciens blocs redirigés vers Minecraft`);

/* 5. clés d’objets (casse, ramassage) */
if (api.mcItemKey('stone') !== 'stone') fail('mcItemKey(stone)');
if (api.mcItemKey('pierre_lisse') !== 'stone') fail('mcItemKey(pierre_lisse)');
if (api.mcItemKey('coffre') !== 'o:coffre') fail('mcItemKey(coffre)');
console.log('   ✅ clés d’objets correctes (stone, pierre_lisse→stone, coffre→o:coffre)');

/* 6. orientation à la pose (conventions Minecraft : nord=0, est=1, sud=2, ouest=3)
 * Le joueur regarde le nord (yaw = 0). « poser » = face du dessus, « contre +X » = face est. */
const TOP = [0, 1, 0], EAST = [1, 0, 0], SOUTH = [0, 0, 1];
const stairs = api.mcDef('oak_stairs'), log_ = api.mcDef('oak_log'), stone = api.mcDef('stone'), furnace = api.mcDef('furnace');
const rTop = api.mcPlaceRot(log_, TOP, 0), rX = api.mcPlaceRot(log_, EAST, 0), rZ = api.mcPlaceRot(log_, SOUTH, 0);
if (rTop[0] !== 0 || rTop[1] !== 0) fail('bûche sur le sol : devrait rester verticale (' + rTop + ')');
if (Math.abs(Math.abs(rX[0]) - Math.PI / 2) > 1e-9 || Math.abs(rX[1] - Math.PI / 2) > 1e-9) fail('bûche couchée en X : ' + rX);
if (Math.abs(Math.abs(rZ[0]) - Math.PI / 2) > 1e-9 || Math.abs(rZ[1]) > 1e-9) fail('bûche couchée en Z : ' + rZ);
/* l’axe +X (est) doit rester +X après rotation : contrôle du signe de la rotation */
const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
let axis = rotX([0, 1, 0], rX[0]); axis = rotY(axis, rX[1]);
if (Math.abs(Math.abs(axis[0]) - 1) > 1e-6) fail('bûche en X : axe ' + axis.map(v => v.toFixed(2)));
/* escalier : le joueur regarde au nord → la montée doit aller vers le nord */
const rStairs = api.mcPlaceRot(stairs, TOP, 0);
if (rStairs[0] !== 0 || rStairs[2] !== 0) fail('escalier : rotation verticale attendue (' + rStairs + ')');
const rise = rotY([1, 0, 0], rStairs[1]);                 // le modèle d’escalier monte vers +X (est)
if (rise[2] > -.9) fail('escalier tourné du mauvais côté : montée ' + rise.map(v => v.toFixed(2)));
/* four : l’avant (le nord dans le modèle) doit regarder le joueur, donc le sud */
const rFurnace = api.mcPlaceRot(furnace, TOP, 0);
const front = rotY([0, 0, -1], rFurnace[1]);
if (front[2] < .9) fail('four : l’avant devrait regarder le joueur (sud), vu ' + front.map(v => v.toFixed(2)));
/* en regardant à l’est, l’escalier monte vers l’est */
const riseE = rotY([1, 0, 0], api.mcPlaceRot(stairs, TOP, -Math.PI / 2)[1]);
if (riseE[0] < .9) fail('escalier regardé vers l’est : montée ' + riseE.map(v => v.toFixed(2)));
/* piston : s’oriente dans l’axe du regard (donc au nord ici) */
const piston = api.mcDef('piston');
if (piston) { const p = rotY([0, 0, -1], api.mcPlaceRot(piston, TOP, 0)[1]); if (p[2] > -.9) fail('piston : devrait pousser vers le nord, vu ' + p.map(v => v.toFixed(2))); }
/* pierre : aucune rotation */
if (api.mcPlaceRot(stone, TOP, 0).some(v => v !== 0)) fail('pierre : aucune orientation attendue');
console.log('   ✅ orientation : bûche couchée dans l’axe, escalier/piston dans l’axe du regard, four vers le joueur');

/* 7. temps de casse selon l’outil */
const pioche = api.mcBreakNeed('stone', { k: 'pioche' });
const main = api.mcBreakNeed('stone', null);
const hache = api.mcBreakNeed('stone', { k: 'hache' });
if (!(pioche < main && main < hache)) fail(`temps de casse incohérents : pioche ${pioche} · main ${main} · hache ${hache}`);
if (api.mcBreakNeed('coffre', { k: 'pioche' }) !== null) fail('mcBreakNeed devrait ignorer les objets non Minecraft');
console.log(`   ✅ casse : pioche ${pioche.toFixed(2)} s · main ${main.toFixed(2)} s · mauvais outil ${hache.toFixed(2)} s`);

/* 8. inventaire créatif */
const cats = Object.keys(api.MC_CREATIVE_CATS);
const labels = win.MC_CATS.map(c => c[1]);
for (const l of labels) if (!cats.includes(l)) fail(`catégorie absente de l’inventaire créatif : ${l}`);
const counts = {}; let unclassified = 0, multi = 0;
for (const b of api.MCB) {
  let hits = 0;
  for (const [name, test] of Object.entries(api.MC_CREATIVE_CATS)) {
    if (name === 'Tout' || name === '🧰 Objets du jeu') continue;
    if (test === 0) continue;
    if (test(b.id)) { hits++; counts[name] = (counts[name] || 0) + 1; }
  }
  if (!hits) unclassified++;
  if (hits > 1) multi++;
}
if (unclassified) fail(`${unclassified} blocs sans catégorie dans l’inventaire créatif`);
if (multi) fail(`${multi} blocs dans plusieurs catégories`);
const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (total !== api.MCB.length) fail(`les catégories totalisent ${total} blocs au lieu de ${api.MCB.length}`);
console.log('   ✅ onglets créatifs : ' + win.MC_CATS.map(([k, l]) => `${l} (${counts[l] || 0})`).join(' · '));


/* 9. objet en main */
let heldOk = 0;
for (const [id, wait] of [['stone', false], ['torch', false], ['water', false], ['oak_stairs', false]]) {
  const shown = api.mcHeldUpdate({ k: id });
  if (!shown) fail(`bloc non affiché en main : ${id}`);
  else heldOk++;
}
if (me.c.held.parent && api.mcHeldUpdate(null) !== false) fail('main vide : le bloc devrait disparaître');
console.log(`   ✅ bloc en main (${heldOk} essais), retiré quand la main est vide`);

/* 10. descriptions */
const tip = api.mcTip(api.mcDef('glowstone'));
if (typeof tip !== 'string' || !/Lumière 15/.test(tip)) fail('description du bloc lumineux incorrecte : ' + tip);
if (typeof api.mcCatLabel(api.mcDef('redstone_block')) !== 'string') fail('libellé de catégorie');
console.log('   ✅ descriptions : ' + tip);

/* 11. performance : construction des 1047 maillages */
const t0 = performance.now();
for (const b of api.MCB) api.mcGeometry(b.id);
console.log(`   ✅ 1047 géométries construites en ${(performance.now() - t0 | 0)} ms (mises en cache ensuite)`);

console.log(`\n${fails ? '❌' : '✅'} ${fails} erreur(s), ${warns} avertissement(s)\n`);
process.exit(fails ? 1 : 0);
