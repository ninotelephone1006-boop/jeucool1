#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * tools/test-game-smoke.mjs — « le jeu tourne-t-il ? » sans navigateur.
 *
 *   node tools/test-game-smoke.mjs
 *
 * Le jeu est une page HTML : on extrait tous ses scripts (classiques puis le
 * module Three.js) et on les exécute dans un bac à sable Node avec un THREE,
 * un DOM et un navigateur factices (objets passe-partout). On simule ensuite
 * une trentaine d'images, on entre dans le monde (mode='play') et on fait
 * marcher, sprinter, sauter, s'accroupir et voler le joueur.
 *
 * Aucune dépendance. Le but n'est pas de vérifier le rendu (impossible sans
 * WebGL) mais d'attraper les erreurs d'exécution : variable inexistante,
 * propriété mal orthographiée, appel impossible…
 * ------------------------------------------------------------------------- */
import fs from 'node:fs';
import vm from 'node:vm';

import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* tous les scripts, dans l'ordre : classiques d'abord, module à la fin */
const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let mm;
while ((mm = re.exec(html))) {
  const attrs = mm[1] || '', body = mm[2];
  if (/type="importmap"/.test(attrs)) continue;
  const srcm = attrs.match(/src="([^"]+)"/);
  if (srcm) scripts.push({ file: srcm[1], body: null });
  else scripts.push({ file: null, body });
}
const modIdx = scripts.findIndex(s2 => /type="module"/.test('') || false);
let src = scripts.filter(s2 => s2.body && /^import \* as THREE/m.test(s2.body.trim()))
  .map(s2 => s2.body.replace(/^import \* as THREE from 'three';/m, 'const THREE = __THREE__;'))[0];


/* ---------------- THREE : stub automatique (Proxy) ---------------- */
const V3 = (x = 0, y = 0, z = 0) => ({
  x, y, z, isVector3: true,
  set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
  clone() { return V3(this.x, this.y, this.z); },
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; },
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; },
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; },
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
  setScalar(s) { this.x = this.y = this.z = s; return this; },
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; },
  length() { return Math.sqrt(this.lengthSq()); },
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); },
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); },
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; },
  applyMatrix4() { return this; }, transformDirection() { return this; },
  fromBufferAttribute() { return this; },
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; },
  dot: (v) => 0, cross() { return this; }, setScalar(s) { return this.set(s, s, s); },
  setLength() { return this; }, lerpVectors() { return this; }, applyAxisAngle() { return this; },
  angleTo: () => 0, projectOnVector() { return this; }, addVectors() { return this; }, subVectors() { return this; },
  multiply() { return this; }, divide() { return this; }, divideScalar() { return this; },
  min() { return this; }, max() { return this; }, clampLength() { return this; },
  floor() { return this; }, ceil() { return this; }, round() { return this; },
  toArray: () => [0, 0, 0], fromArray() { return this; }, equals: () => false,
  setComponent() { return this; }, getComponent: () => 0, manhattanLength: () => 0,
  distanceToSquared: () => 0, multiplyVectors() { return this; }, addVectors2() { return this; },
  setY(y) { this.y = y; return this; }, setX(x) { this.x = x; return this; }, setZ(z) { this.z = z; return this; },
});
function Box3 (min, max) {
  const b = {
    min: min || V3(0, 0, 0), max: max || V3(0, 0, 0), isBox3: true,
    setFromObject() { return b; }, isEmpty() { return false; }, clone() { return Box3(); },
    getSize: (v) => v.set(1, 1, 1), getCenter: (v) => v.set(0, 0, 0), expandByObject() { return b; },
    setFromCenterAndSize() { return b; }, intersect() { return b; }, intersects() { return false; },
    distanceToPoint() { return 1; }, applyMatrix4() { return b; },
  };
  return b;
}
const AUTO = new Set();
const SKIP = new Set(['then', 'catch', 'finally', 'constructor', 'prototype', 'length', 'name', 'message', 'stack', 'toJSON', 'inspect', 'toString', 'valueOf', 'nodeType', 'tagName']);
function obj3 (name) {
  const base = {
    isObject3D: true, isMesh: !!name, isGroup: !name, name: name || '',
    position: V3(), rotation: Object.assign(V3(), { order: 'XYZ' }), scale: V3(1, 1, 1),
    visible: true, children: [], userData: {}, parent: null,
    matrixWorld: { elements: new Array(16).fill(0) },
    castShadow: false, receiveShadow: false, renderOrder: 0,
    add(...a) { a.filter(Boolean).forEach(c => { c.parent = o; o.children.push(c); }); return o; },
    remove(...a) { o.children = o.children.filter(c => !a.includes(c)); return o; },
    traverse(f) { f(o); o.children.slice().forEach(c => c.traverse && c.traverse(f)); },
    getWorldPosition: (v) => v.set(0, 0, 0), getWorldDirection: (v) => v.set(0, 0, -1),
    updateMatrixWorld() { }, rotateX() { return o; }, rotateY() { return o; }, rotateZ() { return o; },
    translateX() { return o; }, translateY() { return o; }, translateZ() { return o; },
    lookAt() { }, setRotationFromEuler() { }, localToWorld: (v) => v, worldToLocal: (v) => v,
    setScalar() { return o; }, clear() { o.children.length = 0; return o; },
    set() { return o; }, copy() { return o; }, clone() { return obj3(name); },
    dispose() { }, getHex: () => 0, setStyle() { }, getSize: (v) => v.set(1, 1, 1),
    getCenter: (v) => v.set(0, 0, 0), setFromObject() { return o; }, expandByObject() { return o; },
    isEmpty: () => false, intersects: () => false, intersect: () => o, distanceToPoint: () => 1,
    applyMatrix4() { return o; }, setFromCenterAndSize() { return o; },
    needsUpdate: false, count: 0, array: new Float32Array(0), setXYZ() { }, getX: () => 0, getY: () => 0, getZ: () => 0,
    computeBoundingBox() { }, computeBoundingSphere() { }, computeVertexNormals() { },
    setAttribute() { return o; }, getAttribute: () => o, setFromPoints() { return o; },
    rotateX2() { }, translate() { return o; }, scale2() { return o; },
    updateProjectionMatrix() { }, setFromPoints2() { }, setRGB() { }, offset() { return o; },
    contract() { return o; }, extend() { return o; }, intersectsBox: () => false, containsPoint: () => false,
    setFromObject2() { }, toArray: () => [], fromArray() { return o; }, invert() { return o; },
    multiply() { return o; }, premultiply() { return o; }, makeRotationY() { return o; }, identity() { return o; },
    normalize() { return o; }, dot: () => 0, cross() { return o; }, angleTo: () => 0, applyQuaternion() { return o; },
    subV() { return o; }, addV() { return o; }, clamp() { return o; }, lerpV() { return o; }, round() { return o; },
    floor() { return o; }, ceil() { return o; }, divideScalar() { return o; }, min() { return o; }, max() { return o; },
  };
  const fn = function () { return o; };
  for (const k in base) { try { fn[k] = base[k]; } catch (e) { } }
  const o = new Proxy(fn, {
    apply () { return o; },
    construct () { return o; },
    get (t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      if (SKIP.has(k)) return undefined;
      t[k] = obj3(String(k));              // tout le reste : objet passe-partout
      return t[k];
    },
    set (t, k, v) { try { t[k] = v; } catch (e) { } return true; },
    has () { return true; },
  });
  return o;
}
const THREE = new Proxy({}, {
  get (t, k) {
    if (k === 'Vector3') return function (x, y, z) { return V3(x, y, z); };
    if (k === 'Box3') return function (a, b) { return Box3(a, b); };
    if (k === 'Group') return function () { return obj3(); };
    if (k === 'Mesh') return function (g, mt) { const o = obj3('mesh'); o.geometry = g; o.material = mt; return o; };
    if (k === 'Scene') return function () { const o = obj3(); o.fog = obj3('fog'); o.background = null; return o; };
    if (k === 'PerspectiveCamera') return function (fov) { return Object.assign(obj3(), { fov, aspect: 1, near: 0.1, far: 100, updateProjectionMatrix() { }, rotation: Object.assign(V3(), { order: 'YXZ' }) }); };
    if (k === 'Color') return function (c) { const o = { r: 0, g: 0, b: 0, isColor: true,
      set() { return o; }, setRGB() { return o; }, setStyle() { return o; }, copy() { return o; },
      clone() { return new (THREE.Color)(); }, getHex: () => 0, getHexString: () => '000000', getStyle: () => '#000',
      offsetHSL() { return o; }, multiplyScalar() { return o; }, lerp() { return o; }, convertSRGBToLinear() { return o; },
      add() { return o; }, sub() { return o; }, equals: () => false, toArray: () => [0, 0, 0] }; return o; };
    if (k === 'Fog') return function () { const o = obj3('fog'); o.isFog = true; return o; };
    if (k === 'PlaneGeometry' || k === 'BoxGeometry' || /Geometry$/.test(String(k))) {
      return function () {
        const attr = () => ({ count: 0, array: new Float32Array(0), needsUpdate: false, itemSize: 3,
          setXYZ() { }, setXY() { }, setX() { }, setY() { }, setZ() { }, setW() { }, setUsage() { },
          getX: () => 0, getY: () => 0, getZ: () => 0, getW: () => 0, clone() { return attr(); },
          fromBufferAttribute() { }, toArray: () => [] });
        return {
          attributes: new Proxy({}, { get: (t2, k2) => (typeof k2 === 'symbol' ? undefined : (t2[k2] || (t2[k2] = attr()))), has: () => true }),
          setAttribute() { return this; }, getAttribute: () => attr(),
          rotateX() { return this; }, translate() { return this; }, scale() { return this; }, computeBoundingBox() { }, computeBoundingSphere() { },
          computeVertexNormals() { }, dispose() { }, index: null, boundingBox: Box3(), setFromPoints() { return this; },
        };
      };
    }
    if (/Material$/.test(String(k))) { return function () { const o = obj3('material'); o.isMaterial = true; o.opacity = 1; o.transparent = false; return o; }; }
    if (k === 'CanvasTexture') return function () { return { isTexture: true, image: null, needsUpdate: false, magFilter: 0, colorSpace: '', dispose() { } }; };
    if (k === 'Raycaster') return function () { return { ray: { origin: V3(), direction: V3(), at(t, v) { return v.set(0, 0, 0); } }, setFromCamera() { }, intersectObject: () => [], intersectObjects: () => [], far: 100 }; };
    if (k === 'TextureLoader') return function () { return { load: (u, cb, pb, eb) => { const t = { isTexture: true, image: { width: 1, height: 1 }, needsUpdate: false, magFilter: 0, minFilter: 0, colorSpace: '', dispose() { }, wrapS: 0, wrapT: 0, repeat: { set() { } }, offset: { set() { } } }; if (cb) cb(t); return t; } }; };
    if (k === 'Texture') return function () { return { isTexture: true, image: null, needsUpdate: false, dispose() { } }; };
    if (k === 'WebGLRenderer') return function () { return { domElement: {}, shadowMap: {}, outputColorSpace: '', toneMapping: 0, setSize() { }, render() { }, setClearColor() { }, setPixelRatio() { }, getContext: () => ({}), info: { render: {} }, capabilities: { isWebGL2: true }, dispose() { } }; };
    if (k === 'Line' || k === 'Points' || k === 'Sprite') return function () { return obj3('line'); };
    if (typeof k === 'symbol') return undefined;
    // tout le reste : constructeur passe-partout ou constante numérique
    return new Proxy(function () { return obj3(String(k)); }, {
      get: (t2, k2) => (k2 === 'prototype' ? {} : 0),
      apply: () => obj3(String(k)),
    });
  },
});

/* ---------------- DOM / navigateur ---------------- */
function el (id) {
  const e = {
    id, tagName: 'DIV', style: { cssText: '' }, dataset: {}, classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    children: [], value: '', textContent: '', innerHTML: '', checked: false, files: [], width: 0, height: 0,
    append(...a) { e.children.push(...a); }, appendChild(c) { e.children.push(c); }, remove() { },
    addEventListener() { }, removeEventListener() { }, setAttribute() { }, getAttribute: () => null,
    querySelector: () => el('x'), querySelectorAll: () => [], closest: () => null, focus() { }, blur() { },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    getContext: () => new Proxy({
      canvas: null, fillStyle: '', strokeStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
      lineWidth: 1, shadowBlur: 0, shadowColor: '', globalCompositeOperation: '',
      createRadialGradient: () => ({ addColorStop() { } }), createLinearGradient: () => ({ addColorStop() { } }),
      createPattern: () => ({}), measureText: () => ({ width: 10 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      createImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData() { }, drawImage() { }, fillRect() { }, clearRect() { }, strokeRect() { }, beginPath() { },
      arc() { }, fill() { }, stroke() { }, moveTo() { }, lineTo() { }, save() { }, restore() { }, translate() { },
      scale() { }, rotate() { }, fillText() { }, strokeText() { }, setTransform() { }, closePath() { },
      clip() { }, quadraticCurveTo() { }, bezierCurveTo() { }, setLineDash() { }, roundRect() { },
    }, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8Array(4), width: 1, height: 1, addColorStop() { } })), has: () => true }),
    requestPointerLock() { }, setPointerCapture() { }, toDataURL: () => 'data:,', click() { },
    firstChild: { nextSibling: { oninput: null, onchange: null } },
    onclick: null, oninput: null, onchange: null, onkeydown: null, oncontextmenu: null, onmousemove: null, onwheel: null,
    set onpointerdown(v) { }, set onpointerup(v) { }, set onpointermove(v) { },
    parentElement: { classList: { contains: () => false } },
  };
  return e;
}
const els = new Map();
/* les seuls ids qui existent réellement dans la page */
const REAL_IDS = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(mm => mm[1]));
const document = {
  querySelector (s) {
    const base = String(s).trim().split(/[\s>]+/)[0];
    if (base[0] === '#' && !REAL_IDS.has(base.slice(1))) return null;   // fidélité au DOM réel
    if (!els.has(s)) els.set(s, el(s));
    return els.get(s);
  },
  querySelectorAll: () => [], getElementById: (i) => el(i),
  createElement: (t) => el(t), body: el('body'), documentElement: el('html'),
  addEventListener() { }, removeEventListener() { }, activeElement: null, pointerLockElement: null,
  exitPointerLock() { },
};
let rafCbs = [];
const win = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() { }, removeEventListener() { },
  requestAnimationFrame (cb) { rafCbs.push(cb); return rafCbs.length; },
  cancelAnimationFrame() { },
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  performance: { now: () => Date.now() },
  location: { href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost', origin: 'http://localhost' },
  navigator: { userAgent: 'node', mediaDevices: { getUserMedia: () => Promise.reject(new Error('no mic')) }, clipboard: { writeText: () => { } } },
  AudioContext: function () { return { createOscillator: () => ({ connect: () => ({ connect() { } }), start() { }, stop() { }, frequency: { value: 0, setValueAtTime() { } }, type: '' }), createGain: () => ({ gain: { setValueAtTime() { }, exponentialRampToValueAtTime() { } }, connect: () => ({ connect() { } }) }), createAnalyser: () => ({ fftSize: 0, getByteTimeDomainData() { }, connect() { } }), createMediaStreamSource: () => ({ connect() { } }), destination: {}, currentTime: 0, sampleRate: 48000, resume: () => { }, close: () => { } }; },
  WebSocket: function () { return { readyState: 0, send() { }, close() { }, addEventListener() { }, onopen: null, onmessage: null, onclose: null, onerror: null }; },
  Image: function () { return { onload: null, src: '' }; },
  URL: { createObjectURL: () => 'blob:', revokeObjectURL() { } },
  fetch: () => Promise.reject(new Error('no net')),
  alert() { }, confirm: () => true, prompt: () => '', setTimeout, clearTimeout, setInterval, clearInterval,
  matchMedia: () => ({ matches: false, addEventListener() { } }),
  game: null, __ready: 0,
};
win.window = win; win.self = win; win.globalThis = win;
win.document = document;
Object.assign(win, {
  Math, JSON, Date, Object, Array, String, Number, Boolean, Map, Set, Promise, Error, RegExp, Symbol,
  Float32Array, Uint8Array, Uint8ClampedArray, Int32Array, Uint16Array, ArrayBuffer, DataView,
  console, isNaN, isFinite, parseInt, parseFloat, TextDecoder, TextEncoder, Blob, btoa, atob, structuredClone,
});
win.performance = { now: () => Date.now() };

const sandbox = win;
sandbox.__THREE__ = THREE;
vm.createContext(sandbox);

let errors = [];
function runOne (code, name) {
  try { vm.runInContext(code, sandbox, { filename: name }); return true; }
  catch (e) { errors.push(name + ' : ' + e.stack.split("\n").slice(0, 10).join('\n')); return false; }
}
/* scripts classiques (dans l'ordre du document) */
for (const s2 of scripts) {
  if (s2.file) {
    if (!runOne(fs.readFileSync(path.join(ROOT, s2.file), 'utf8'), s2.file)) break;
  } else if (!/import \* as THREE/.test(s2.body)) {
    if (!runOne(s2.body, 'inline-' + scripts.indexOf(s2))) break;
  }
}
/* script module (le jeu) : on injecte des marqueurs pour localiser un blocage */
if (false) {
  const marks = ['if(tdirty)refT();', 'tick(dt);', 'voiceTick(now);', 'mc.tick(PW);',
    'collideModelMeshes();', 'anim(me.c', 'for(const id in RM)', 'gUpd();', 'env();', 'R.render(sc,cam);',
    'prevs.forEach(', 'if(mode===\'play\'){mc.interpolateEyeHeight()'];
  let i = 0;
  for (const mm2 of marks) src = src.replace(mm2, `console.log("MARK ${i++}");` + mm2);
}
if (!errors.length) runOne(src, 'game.js');

/* --- simulation d'images --- */
let tNow = Date.now(), frameNo = 0;
function frames (n) {
  for (let f = 0; f < n; f++) {
    const cbs = rafCbs; rafCbs = [];
    tNow += 16.7;
    for (const cb of cbs) {
      try { cb(tNow); } catch (e) { errors.push(`IMAGE ${frameNo} : ` + e.stack.split("\n").slice(0, 10).join('\n')); }
    }
    frameNo++;
    if (errors.length) return;
  }
}
if (!errors.length) frames(20);
/* --- scénario « en jeu » : on entre dans le monde et on marche --- */
if (!errors.length) {
  const steps = [];
  let sok = 0, sko = 0;
  const check = (n, cond, d = '') => { if (cond) sok++; else sko++; steps.push([(cond ? '  ✅ ' : '  ❌ ') + n, d]); };
  const eq = (n, got, want, tol, u = '') => check(n, Math.abs(got - want) <= tol, `${got}${u} (attendu ${want}${u})`);
  const run = (code) => vm.runInContext(code, sandbox);
  try {
    run(`mode='play';paused=false;me.pos.set(0.5,T.get(0.5,0.5)+6,0.5);mcTP();fly=0;dead=0;hp=20;`);
    /* 1. chute puis atterrissage sur le terrain */
    frames(40);
    const land = JSON.parse(run('JSON.stringify({y:mc.pos.y,sol:T.get(mc.pos.x,mc.pos.z),onG:mc.onGround})'));
    eq('le joueur retombe sur le terrain', land.y, land.sol, 1e-6, ' bloc');
    check('le sol est détecté', land.onG === true);
    /* 2. marche (touche Z) */
    run('K.z=1');
    frames(60);
    const w = JSON.parse(run('JSON.stringify({sp:me.c.st.sp,swing:mc.limbSwing,amt:mc.limbSwingAmount})'));
    eq('marche : 4,317 m/s', w.sp, 4.317, 0.02, ' m/s');
    check('animation des membres active', w.swing > 5 && w.amt > 0.5, `limbSwing ${w.swing.toFixed(1)}`);
    /* 3. sprint (Ctrl) */
    run('K.Control=1');
    frames(60);
    const sp = JSON.parse(run('JSON.stringify({sp:me.c.st.sp,sprint:mc.isSprinting,fov:mc.getFov(alpha)})'));
    eq('sprint : 5,612 m/s', sp.sp, 5.612, 0.02, ' m/s');
    check('sprint actif', sp.sprint === true);
    eq('FOV dynamique du sprint : 70 × 1,15', sp.fov, 80.5, 0.05, '°');
    /* 4. saut */
    run('K.Control=0;K[" "]=1');
    let h0 = run('mc.pos.y'), top = h0;
    for (let i = 0; i < 40; i++) { frames(1); top = Math.max(top, run('mc.pos.y')); }
    eq('hauteur du saut', top - h0, 1.2522, 0.001, ' bloc');
    run('K[" "]=0;K.z=0');
    /* 5. accroupi (Maj) + vol créatif */
    run('K[" "]=0');
    frames(20);
    run('gm="creative";K.Shift=1;K.z=1');
    frames(30);
    frames(40);
    const sn = JSON.parse(run('JSON.stringify({sp:me.c.st.sp,sn:mc.isSneaking,eye:mc.eyeHeight})'));
    eq('accroupi : 1,295 m/s', sn.sp, 1.295, 0.02, ' m/s');
    check('accroupi actif', sn.sn === true);
    eq('hauteur des yeux accroupi', sn.eye, 1.27, 0.01, ' bloc');
    run('K.Shift=0;fly=1;K[" "]=1');
    frames(30);
    const fl = JSON.parse(run('JSON.stringify({y:mc.pos.y,fly:mc.isFlying})'));
    check('vol créatif : le joueur monte', fl.fly === true && fl.y > 1, `y = ${fl.y.toFixed(2)}`);
    run('fly=0;K.z=0;K[" "]=0');
    frames(30);
    /* 6. écran de débogage (F3) */
    run('dbgOn=1');
    frames(3);
    const dbg = JSON.parse(run('JSON.stringify({len:($("#dbg").innerHTML||"").length})'));
    check('écran de débogage F3 rempli', dbg.len > 300, `${dbg.len} caractères`);
  } catch (e) { errors.push('SCÉNARIO : ' + e.stack.split('\n').slice(0, 6).join('\n')); }
  console.log('\n▸ Scénario en jeu (mode play)');
  for (const [n, v] of steps) console.log(n + (v ? '  ' + v : ''));
  if (sko) errors.push(sko + ' vérification(s) de jeu en échec');
  else console.log('  (' + sok + ' vérifications)');
}

if (errors.length) {
  console.log('❌\n' + errors.join('\n\n'));
  try {
    const probe = `
      (() => {
        try { me.c.armR.add(me.c.held); } catch (e) { return 'add throws: ' + e.message; }
        return JSON.stringify({ afterManualAdd: me.c.armR.children.length,
          parent: !!me.c.held.parent, addType: typeof me.c.armR.add,
          torsoKids: me.c.torso.children.length, rootKids: me.c.g.children.length });
      })()`;
    console.log('DIAG ' + vm.runInContext(probe, sandbox));
  } catch (e) { console.log('DIAG indisponible: ' + e.message); }

  process.exit(1);
}
console.log('\n✅ jeu exécuté en entier et scénario de jeu simulé sans erreur');
process.exit(0);
