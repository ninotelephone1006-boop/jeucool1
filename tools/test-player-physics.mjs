#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/test-player-physics.mjs — vérifie que la physique, la caméra et
 * l’animation du joueur reproduisent bien Minecraft Java Édition.
 *
 *   node tools/test-player-physics.mjs
 *
 * Deux parties :
 *   1. moteur (mc/playerphysics.js) : valeurs officielles — vitesses de
 *      marche / sprint / accroupi, hauteur de saut, gravité, cooldown du
 *      saut, FOV dynamique, hauteurs d’œil, rythme des membres.
 *   2. branchement au jeu : la section MC-PHYSIQUE d’index.html est extraite
 *      et exécutée avec un monde factice (heightmap + blocs posés) pour
 *      vérifier l’adaptateur (boîtes de collision, glissance, liquides,
 *      rebond du slime, montée de marche).
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MCPhys = require(path.join(ROOT, 'mc', 'playerphysics.js'));
const { MC, MCPlayer, MCAnim } = MCPhys;

let ok = 0, ko = 0;
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
function check (name, cond, detail = '') {
  if (cond) { ok++; console.log('  ✅ ' + name + (detail ? '  ' + detail : '')); }
  else { ko++; console.log('  ❌ ' + name + '  ' + detail); }
}
function eq (name, got, want, tol, unit = '') {
  check(name, near(got, want, tol), `obtenu ${got}${unit}, attendu ${want}${unit} (±${tol})`);
}

/* =========================================================================
 * 1. MOTEUR — valeurs officielles
 * ========================================================================= */

/* Monde factice : sol plat à y = 64, pas de mur. */
const flat = {
  groundHeight: () => 64,
  getCollisionBoxes: () => [],
  getSlipperiness: (x, y, z) => (y < 64 ? 0.6 : 0.6),
  isBouncy: () => false,
  isClimbable: () => false,
  getFluid: () => ({ water: 0, lava: 0, height: 0 }),
};
function run (opts, ticks, world = flat) {
  const p = new MCPlayer();
  p.pos.x = 0.5; p.pos.y = 64; p.pos.z = 0.5;
  p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
  const { each, ...inp } = opts;
  Object.assign(p.input, inp);
  for (let i = 0; i < ticks; i++) { p.tick(world); if (each) each(p, i); }
  return p;
}
const hold = (o) => o;
/* Vitesse affichée par Minecraft (F3) : le déplacement réel du tick.
 * Attention : la variable de vitesse, elle, est amortie par la friction
 * APRES le déplacement (LivingEntity.travel), donc plus faible. */
const speed = (p) => p.stats.moveSpeed;

console.log('\n▸ Vitesses (Minecraft Java : marche 4,317 · sprint 5,612 · accroupi 1,295 m/s)');
{
  const w = run({ forward: true }, 60);
  eq('marche', speed(w), 4.317, 0.01, ' m/s');
  const s = run(hold({ forward: true, sprint: true }), 60);
  eq('sprint', speed(s), 5.612, 0.01, ' m/s');
  const c = run(hold({ forward: true, sneak: true }), 60);
  eq('accroupi', speed(c), 1.295, 0.01, ' m/s');
  /* Quirk vanilla : l'entrée (0,98 ; 0,98) a une norme > 1, elle est donc
   * normalisée à 1 au lieu de 0,98 → la diagonale est 1/0,98 ≈ 2 % plus
   * rapide. C'est le comportement exact de LivingEntity.travel. */
  const d = run(hold({ forward: true, right: true }), 60);
  eq('diagonale (+2 % comme dans le jeu)', speed(d), 4.4053, 0.01, ' m/s');
  check('le sprint est conservé après 1 tick', run(hold({ forward: true, sprint: true }), 2).isSprinting);
  check('l’accroupi annule le sprint', !run(hold({ forward: true, sprint: true, sneak: true }), 30).isSprinting);
}

console.log('\n▸ Glissance (glace 0,98 · glace bleue 0,989)');
{
  const ice = { ...flat, getSlipperiness: () => 0.98 };
  const bi = { ...flat, getSlipperiness: () => 0.989 };
  const a = run(hold({ forward: true }), 60, ice);
  eq('glace', speed(a), 4.1572, 0.01, ' m/s');
  const b = run(hold({ forward: true }), 60, bi);
  eq('glace bleue', speed(b), 4.3760, 0.01, ' m/s');
}

console.log('\n▸ Saut (0,42 b/t → 1,2522 bloc)');
{
  let max = 64, air = 0;
  const q = new MCPlayer();
  q.pos.x = 0.5; q.pos.y = 64; q.pos.z = 0.5;
  q.prevPos.x = q.pos.x; q.prevPos.y = q.pos.y; q.prevPos.z = q.pos.z;
  for (let i = 0; i < 3; i++) q.tick(flat);      // on se pose
  q.input.jump = true;
  q.tick(flat);
  q.input.jump = false;
  for (let i = 0; i < 30; i++) { q.tick(flat); max = Math.max(max, q.pos.y); if (!q.onGround) air++; }
  eq('hauteur du saut', max - 64, 1.25220, 0.0005, ' bloc');
  check('durée du saut = 11 ticks', air === 10 || air === 11, `${air} ticks en l’air`);
  check('atterrissage', q.onGround);
  eq('cooldown du saut', MC.JUMP_TICKS, 10, 0, ' ticks');
}

console.log('\n▸ Gravité (0,08 b/t² · traînée 0,98 · vitesse terminale 78,4 m/s)');
{
  eq('gravité', MC.GRAVITY, 0.08, 0);
  eq('traînée de l’air', MC.GRAVITY_DRAG, 0.98, 0);
  const p = new MCPlayer();
  p.pos.y = 1000; p.prevPos.y = 1000;
  for (let i = 0; i < 400; i++) p.tick({ getCollisionBoxes: () => [], getFluid: () => ({}) });
  eq('vitesse terminale', -p.vel.y * MC.TPS, 78.4, 0.2, ' m/s');
}

console.log('\n▸ Vol créatif (vitesse de vol 0,05 · ×2 en sprint)');
{
  const q = new MCPlayer();
  q.isFlying = true; q.abilities.allowFlying = true;
  q.pos.y = 100; q.prevPos.y = 100;
  q.input.forward = true; q.input.sprint = true;
  for (let i = 0; i < 200; i++) q.tick({ getCollisionBoxes: () => [], getFluid: () => ({}) });
  eq('vol + sprint', q.stats.moveSpeed, 21.7778, 0.05, ' m/s');
}

console.log('\n▸ Caméra et champ de vision');
{
  eq('hauteur des yeux (debout)', MC.EYE_HEIGHT, 1.62, 0);
  eq('hauteur des yeux (accroupi)', MC.EYE_HEIGHT_SNEAK, 1.27, 0);
  eq('hauteur des yeux (nage)', MC.EYE_HEIGHT_SWIM, 0.4, 0);
  const p = run(hold({ forward: true, sprint: true }), 40);
  eq('FOV en sprint (×1,15)', p.getFovModifierRaw(), 1.15, 1e-6);
  const w = run(hold({ forward: true }), 40);
  eq('FOV à pied (×1)', w.getFovModifierRaw(), 1, 1e-6);
  const f = new MCPlayer();
  f.isFlying = true; f.input.sprint = false;
  eq('FOV en vol (×1,1)', f.getFovModifierRaw(), 1.1, 1e-6);
  /* Balancement : nul à l’arrêt, borné à 0,1 en marchant */
  const st = new MCPlayer();
  for (let i = 0; i < 40; i++) st.tick(flat);
  eq('balancement à l’arrêt', st.bobView(0).x, 0, 1e-6);
  const g = run(hold({ forward: true }), 60);
  const bob = g.bobView(0.5);
  check('balancement en marche', Math.abs(bob.x) <= 0.05 + 1e-9 && Math.abs(bob.y) <= 0.1 + 1e-9,
    `x=${bob.x.toFixed(4)} y=${bob.y.toFixed(4)}`);
  check('le balancement descend toujours (y ≤ 0)', bob.y <= 0);
}

console.log('\n▸ Animation des membres (BipedModel.setRotationAngles)');
{
  eq('fréquence des membres', MC.LIMB_SWING_FREQUENCY, 0.6662, 0);
  eq('amplitude des jambes', MC.LIMB_LEG_AMPLITUDE, 1.4, 0);
  eq('amplitude des bras', MC.LIMB_ARM_AMPLITUDE * MC.LIMB_ARM_SCALE, 1.0, 0);
  const a = MCAnim.limbAngles(0, 1);
  eq('jambe droite à limbSwing = 0', a.legR, 1.4, 1e-9);
  eq('jambe gauche (opposée)', a.legL, -1.4, 1e-9);
  eq('bras droit (opposé à la jambe droite)', a.armR, -1.0, 1e-9);
  check('bras et jambes en opposition', Math.sign(a.legR) === -Math.sign(a.armR));
  /* Le pas : limbSwing avance d’autant plus que l’on marche vite */
  const p = run(hold({ forward: true, sprint: true }), 40);
  const l = run(hold({ forward: true }), 40);
  check('le cycle va plus vite en sprint', p.limbSwing > l.limbSwing,
    `sprint ${p.limbSwing.toFixed(2)} > marche ${l.limbSwing.toFixed(2)}`);
  /* Un joueur immobile ne bouge plus les jambes */
  const i0 = new MCPlayer();
  for (let k = 0; k < 60; k++) i0.tick(flat);
  check('immobile : membres arrêtés', i0.limbSwingAmount < 1e-3, `${i0.limbSwingAmount.toExponential(2)}`);
}

/* =========================================================================
 * 2. BRANCHEMENT AU JEU — adaptateur monde (index.html)
 * ========================================================================= */
console.log('\n▸ Adaptateur monde (extrait d’index.html)');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const A = html.indexOf('/* == MC-PHYSIQUE:DEBUT');
const B = html.indexOf('/* == MC-PHYSIQUE:FIN');
if (A < 0 || B < 0) { console.log('  ❌ marqueurs MC-PHYSIQUE absents'); process.exit(1); }
const section = html.slice(A, B);

/* --- monde factice --- */
const OB = {};
let terrain = (x, z) => 64;
const T = { get: (x, z) => terrain(x, z) };
const mcId = (t) => ({ glace: 'ice', eau_bloc: 'water', slime_bloc: 'slime_block', 'échelle': 'ladder', dalle_pierre: 'stone_slab' }[t] || null);
const me = { pos: { x: 0, y: 64, z: 0 } };
function box (x0, y0, z0, x1, y1, z1) {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, isEmpty: () => false };
}
function addBlock (id, type, x, y, z, solid = 1, h = 1) {
  OB[id] = { o: { type, tch: 1 }, g: { userData: { def: { solid } } }, bx: box(x, y, z, x + 1, y + h, z + 1) };
}
const api = new Function('MCPhys', 'OB', 'mcId', 'T', 'me',
  section + '\n return { MCSTEP, SLIP, MW, PW, mc, mwBuild, mwAt, mcTP, fallDmg, obVerSet: v => { obVer = v; } };'
)(MCPhys, OB, mcId, T, me);

eq('durée d’un tick', api.MCSTEP, 0.05, 0);
eq('glissance de la glace', api.SLIP.ice, 0.98, 0);
eq('glissance de la glace bleue', api.SLIP.blue_ice, 0.989, 0);
eq('glissance du bloc de slime', api.SLIP.slime_block, 0.8, 0);

/* terrain : le sol est bien solide sous la surface */
{
  const q = { minX: 0.5, minY: 63.5, minZ: 0.5, maxX: 0.5, maxY: 63.5, maxZ: 0.5 };
  const b = api.PW.getCollisionBoxes({ minX: 0, minY: 63, minZ: 0, maxX: 1, maxY: 64, maxZ: 1 });
  check('le terrain produit des boîtes sous la surface', b.some(e => e.terrain && e.maxY === 64 && e.minY === 63), `${b.length} boîte(s)`);
}
/* terrain en pente : le bloc du dessus est coupé à la hauteur exacte */
{
  terrain = () => 64.5;
  const b = api.PW.getCollisionBoxes({ minX: 0, minY: 63, minZ: 0, maxX: 1, maxY: 66, maxZ: 1 });
  check('bloc supérieur coupé à la hauteur du terrain', b.some(e => e.terrain && e.minY === 64 && Math.abs(e.maxY - 64.5) < 1e-9),
    JSON.stringify(b.filter(e => e.terrain).map(e => [e.minY, e.maxY])));
  eq('hauteur du sol renvoyée par l’adaptateur', api.PW.groundHeight(0.5, 0.5), 64.5, 1e-9);
  terrain = () => 64;
}
/* blocs posés : collision, glissance, liquide, rebond */
{
  addBlock('b1', 'glace', 2, 64, 2);
  addBlock('b2', 'eau_bloc', 5, 64, 5, 0);
  addBlock('b3', 'slime_bloc', 8, 63, 8);
  addBlock('b4', 'échelle', 11, 64, 11);
  addBlock('b5', 'dalle_pierre', 14, 64, 14, 1, 0.5);
  api.obVerSet(-1);
  api.mwBuild();
  const hit = api.PW.getCollisionBoxes({ minX: 2, minY: 64, minZ: 2, maxX: 3, maxY: 65, maxZ: 3 });
  check('un bloc posé est une boîte de collision', hit.some(e => e.id === 'ice'), JSON.stringify(hit.map(e => e.id)));
  eq('glissance sous les pieds (glace)', api.PW.getSlipperiness(2, 64, 2), 0.98, 1e-9);
  eq('glissance par défaut (terrain)', api.PW.getSlipperiness(50, 64, 50), 0.6, 1e-9);
  check('l’eau est un liquide', api.PW.getFluid({ minX: 5, minY: 64, minZ: 5, maxX: 6, maxY: 65.8, maxZ: 6 }).water === 1);
  check('l’échelle est grimpable', api.PW.isClimbable(11, 64, 11));
  check('le bloc de slime rebondit', api.PW.isBouncy(8, 63, 8));
  /* montée de marche : une dalle de 0,5 bloc se franchit sans sauter */
  const p = api.mc;
  api.mcTP();
  p.pos.x = 13.2; p.pos.y = 64; p.pos.z = 14.5;
  p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
  p.input.forward = true; p.yaw = -Math.PI / 2;  // avancer vers +X
  let topY = 64;
  for (let i = 0; i < 40 && p.pos.x < 15.2; i++) { p.tick(api.PW); topY = Math.max(topY, p.pos.y); }
  check('montée de marche sur une dalle (0,5 bloc)', Math.abs(topY - 64.5) < 1e-6, `y = ${topY.toFixed(3)}`);
  /* un bloc entier bloque : il faut sauter */
  addBlock('b6', 'pierre', 20, 64, 2, 1, 1);
  api.obVerSet(-1); api.mwBuild(); api.mcTP();
  p.input.forward = true; p.pos.x = 19.2; p.pos.y = 64; p.pos.z = 2.5;
  p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
  for (let i = 0; i < 30; i++) p.tick(api.PW);
  check('un bloc entier n’est pas franchi sans sauter', p.pos.x < 19.71 && p.pos.y === 64,
    `x = ${p.pos.x.toFixed(2)} y = ${p.pos.y.toFixed(2)}`);
  /* rebond sur le slime */
  api.mcTP();
  p.input.forward = false;
  p.pos.x = 8.5; p.pos.y = 70; p.pos.z = 8.5;
  p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
  let bounced = 0;
  for (let i = 0; i < 80; i++) { p.tick(api.PW); if (p.vel.y > 0.05) bounced = p.vel.y; }
  check('le slime renvoie le joueur vers le haut', bounced > 0.05, `vel.y = ${bounced.toFixed(4)} b/t`);
  /* eau : on y nage */
  api.mcTP();
  p.pos.x = 5.5; p.pos.y = 64; p.pos.z = 5.5;
  p.prevPos.x = p.pos.x; p.prevPos.y = p.pos.y; p.prevPos.z = p.pos.z;
  p.tick(api.PW);
  check('le joueur est dans l’eau', p.isInWater, `hauteur ${p.fluidHeight.toFixed(2)}`);
}

/* ======================================================================= */
console.log(`\n${ko ? '❌' : '✅'} ${ok} test(s) réussi(s), ${ko} échec(s)\n`);
process.exit(ko ? 1 : 0);
