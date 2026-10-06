/* ===========================================================================
 * mc/geom.js — géométrie des blocs Minecraft
 * ---------------------------------------------------------------------------
 * Transforme la description d'un bloc (mc/blocks.js) en triangles prêts pour
 * WebGL : positions, normales et coordonnées de texture dans l'atlas.
 *
 * Fichier partagé : le jeu s'en sert pour construire ses maillages, et
 * tools/preview-blocks.mjs pour dessiner les planches d'aperçu.
 *
 * Repère d'un bloc : x,z ∈ [-0,5 ; 0,5] (centre du bloc), y ∈ [0 ; 1]
 * (le sol du bloc est à y = 0, comme les objets du jeu).
 * Les coordonnées de la description sont en 1/16 de bloc, origine en bas,
 * au nord-ouest : x → est, y → haut, z → sud.
 * =========================================================================== */
(function (g) {
  'use strict';

  // ordre des 4 coins de chaque face, identique aux modèles Mojang :
  // le 1er coin reçoit (u1,v1) de la description, puis (u2,v1), (u2,v2), (u1,v2)
  const CORNERS = {
    d: [[1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1]],
    u: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    n: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]],
    s: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]],
    w: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]],
    e: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]]
  };
  const NORMALS = { u: [0, 1, 0], d: [0, -1, 0], n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0] };

  // position normalisée dans la face → (s,t) : mêmes conventions que Mojang
  function faceST(face, x, y, z) {
    switch (face) {
      case 'u': return [x, 1 - z];
      case 'd': return [1 - x, z];
      case 'n': return [1 - x, 1 - y];
      case 's': return [x, 1 - y];
      case 'e': return [1 - z, 1 - y];
      default: return [z, 1 - y];                       // ouest
    }
  }
  function rotateST(r, s, t) {
    if (r === 90) return [t, 1 - s];
    if (r === 180) return [1 - s, 1 - t];
    if (r === 270) return [1 - t, s];
    return [s, t];
  }

  /** limites de la tuile d'une texture dans l'atlas, en pixels */
  function tileRect(atlas, name) {
    const i = atlas.idx[name];
    if (i === undefined) return null;
    return { x: (i % atlas.cols) * atlas.tile, y: Math.floor(i / atlas.cols) * atlas.tile, s: atlas.tile };
  }

  /**
   * Triangles d'un bloc.
   * @returns {{position:Float32Array, normal:Float32Array, uv:Float32Array, count:number, min:number[], max:number[]}}
   */
  function block(def, atlas) {
    const P = [], N = [], U = [];
    let min = [9e9, 9e9, 9e9], max = [-9e9, -9e9, -9e9];
    const push = (p, n, uv) => {
      P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); U.push(uv[0], uv[1]);
      for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; }
    };
    const v3 = {
      sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
      cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
      dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    };
    for (const box of def.boxes) {
      const [bx0, by0, bz0, bx1, by1, bz1, faces, rot] = box;
      // 1/16 → unités de bloc, puis recentrage sur le centre du bloc
      const x0 = bx0 / 16 - .5, x1 = bx1 / 16 - .5;
      const y0 = by0 / 16, y1 = by1 / 16;
      const z0 = bz0 / 16 - .5, z1 = bz1 / 16 - .5;
      const size = [x1 - x0, y1 - y0, z1 - z0];
      // rotation du pavé (autour d'un point donné, en degrés)
      let R = null;
      if (rot) {
        const a = rot[4] * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        const o = [rot[0] / 16 - .5, rot[1] / 16, rot[2] / 16 - .5], ax = rot[3];
        const spin = d => ax === 'x' ? [d[0], d[1] * c - d[2] * s, d[1] * s + d[2] * c]
          : ax === 'y' ? [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c]
            : [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]];
        R = {
          point: p => { const q = spin([p[0] - o[0], p[1] - o[1], p[2] - o[2]]); return [q[0] + o[0], q[1] + o[1], q[2] + o[2]]; },
          dir: d => spin(d)
        };
      }
      for (const key of Object.keys(faces)) {
        const f = faces[key];
        const name = typeof f === 'string' ? f : f.t;
        const tile = tileRect(atlas, name);
        if (!tile) continue;
        const uv = typeof f === 'string' || !f.uv ? [0, 0, 16, 16] : f.uv;
        const r = (typeof f === 'object' && f.r) || 0;
        const corners = CORNERS[key].map(c => {
          const p = [x0 + c[0] * size[0], y0 + c[1] * size[1], z0 + c[2] * size[2]];
          const [s0, t0] = rotateST(r, ...faceST(key, c[0], c[1], c[2]));
          const texelU = uv[0] + s0 * (uv[2] - uv[0]);
          const texelV = uv[1] + t0 * (uv[3] - uv[1]);
          return { p: R ? R.point(p) : p, uv: [(tile.x + texelU) / atlas.w, 1 - (tile.y + texelV) / atlas.h] };
        });
        // normale extérieure de la face (tournée avec le pavé)
        const out = R ? R.dir(NORMALS[key]) : NORMALS[key];
        const len = Math.hypot(out[0], out[1], out[2]) || 1;
        const normal = [out[0] / len, out[1] / len, out[2] / len];
        // sens antihoraire vu de l'extérieur (sinon WebGL supprimerait la face)
        const geoN = v3.cross(v3.sub(corners[1].p, corners[0].p), v3.sub(corners[2].p, corners[0].p));
        const order = v3.dot(geoN, out) < 0
          ? [corners[1], corners[0], corners[3], corners[2]]
          : [corners[0], corners[1], corners[2], corners[3]];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
          const c = order[idx];
          push(c.p, normal, c.uv);
        }
      }
    }
    return {
      position: new Float32Array(P), normal: new Float32Array(N), uv: new Float32Array(U),
      count: P.length / 3, min, max
    };
  }

  /* ---------------------------------------------------------------- pose
   * Rotation à appliquer au maillage quand le joueur pose le bloc, exactement
   * comme dans Minecraft : la plupart des blocs orientables présentent leur
   * avant au joueur ; les escaliers, pistons, répéteurs… s’orientent au
   * contraire dans l’axe de son regard. La bûche et les blocs « à axe » se
   * couchent dans l’axe de la face visée.
   *
   * @param def    description du bloc (mc/blocks.js)
   * @param n      normale de la face visée [x, y, z]
   * @param yaw    regard du joueur (yaw de la caméra du jeu)
   * @returns [rx, ry, rz] en radians
   */
  const AWAY = /stairs|piston|repeater|comparator|observer|hopper|lightning_rod|_door$|trapdoor|_gate$|rail|_sign$|_banner$/;
  function placeRot(def, n, yaw) {
    if (!def) return [0, 0, 0];
    const nx = n ? n[0] : 0, ny = n ? n[1] : 1, nz = n ? n[2] : 0;
    const side = Math.abs(ny) < .5;
    const q = ((-Math.round((yaw || 0) / (Math.PI / 2)) % 4) + 4) % 4;   // 0 nord, 1 est, 2 sud, 3 ouest
    if (def.pillar && side) {
      const a = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? Math.PI / 2 : -Math.PI / 2) : (nz > 0 ? 0 : Math.PI);
      return [Math.PI / 2, a, 0];
    }
    if (def.facing) {
      if (def.face0 === undefined) {           // modèle « debout » : l’avant est vers le haut
        if (ny > .5) return [0, 0, 0];
        if (ny < -.5) return [0, 0, Math.PI];
        return [Math.PI / 2, Math.atan2(-nx, -nz), 0];
      }
      const want = (AWAY.test(def.id) ? q : q + 2) % 4;
      const turn = (((want - def.face0) % 4) + 4) % 4;
      return [0, -turn * Math.PI / 2, 0];
    }
    return [0, 0, 0];
  }

  g.MCGeom = { block, tileRect, faceST, placeRot, CORNERS, NORMALS };
})(typeof window !== 'undefined' ? window : globalThis);
