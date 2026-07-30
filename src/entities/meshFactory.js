/**
 * Low-poly stationery models.
 *
 * Rules of the house style:
 *   · everything is a box, cylinder, cone, sphere, torus or the paper dart
 *   · +Z is forward, y = 0 is the ground the unit stands on
 *   · a team-coloured base disc under every unit makes ownership readable
 *     from the default RTS camera height without any UI
 *   · geometries and materials come from the shared cache, never `new`
 */
import * as THREE from 'three';
import {
  box, cyl, cone, sphere, torus, plane, ring, solid, glow, unlit, translucent,
  PAL, paperPlaneGeometry, radialTexture, mergeStaticGroup,
} from '../scene/materials.js';
import { TEAM_COLORS } from '../core/constants.js';
import { shade } from '../core/utils.js';

/* ── helpers ─────────────────────────────────────────────────────────── */

function m(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

/** Flat team disc + soft blob shadow that sits under every unit. */
function teamBase(team, radius = 1.25) {
  const g = new THREE.Group();
  const col = TEAM_COLORS[team].primary;

  const disc = m(cyl(radius, radius * 0.92, 0.16, 12), solid(col, { rough: 0.5, ei: 0.25, emissive: col }), 0, 0.08, 0);
  g.add(disc);

  const shadow = new THREE.Mesh(
    plane(radius * 3.2, radius * 3.2),
    new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)'),
      transparent: true, depthWrite: false, opacity: 0.75,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = -1;
  g.add(shadow);
  return g;
}

function castAll(obj) {
  obj.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; } });
  return obj;
}

/* ─────────────────────────────────────────────────────────────────────
   Ground units
   ───────────────────────────────────────────────────────────────────── */

const UNIT_BUILDERS = {

  /* ✏️ hexagonal barrel, exposed lead, painted ferrule */
  grunt(team, accent) {
    const g = new THREE.Group();
    const body = m(cyl(0.46, 0.5, 2.5, 6), solid(PAL.brass), 0, 1.42, 0);
    body.rotation.z = 0.1;
    g.add(body);
    g.add(m(cone(0.47, 0.62, 6), solid(0xe8c79a), 0.03, 2.92, 0));
    g.add(m(cone(0.2, 0.26, 6), solid(PAL.graphite), 0.04, 3.32, 0));
    g.add(m(cyl(0.52, 0.52, 0.32, 6), solid(PAL.steel, { metal: 0.6, rough: 0.35 }), -0.02, 0.4, 0));
    g.add(m(cyl(0.5, 0.5, 0.18, 6), solid(accent, { ei: 0.3, emissive: accent }), -0.02, 0.62, 0));
    g.userData.muzzle = new THREE.Vector3(0, 3.1, 0.4);
    return g;
  },

  /* 🖊️ slim barrel, conical tip, pocket clip */
  scout(team, accent) {
    const g = new THREE.Group();
    g.add(m(cyl(0.34, 0.36, 2.4, 8), solid(PAL.inkBlack, { rough: 0.35 }), 0, 1.5, 0));
    g.add(m(cyl(0.37, 0.37, 0.8, 8), solid(accent, { ei: 0.25, emissive: accent }), 0, 2.9, 0));
    g.add(m(cone(0.3, 0.5, 8), solid(PAL.steel, { metal: 0.7, rough: 0.25 }), 0, 0.42, 0.0, Math.PI, 0, 0));
    g.add(m(cone(0.09, 0.2, 6), solid(PAL.steelDark, { metal: 0.8 }), 0, 0.12, 0, Math.PI, 0, 0));
    const clip = m(box(0.1, 0.9, 0.16), solid(PAL.steel, { metal: 0.75, rough: 0.2 }), 0, 2.85, -0.42);
    clip.rotation.x = 0.1;
    g.add(clip);
    g.userData.muzzle = new THREE.Vector3(0, 0.6, 0.5);
    return g;
  },

  /* 📏 flat blade carried like a lance */
  lancer(team, accent) {
    const g = new THREE.Group();
    g.add(m(cyl(0.55, 0.62, 1.5, 8), solid(shade(accent, -0.35)), 0, 0.9, 0));
    const blade = m(box(0.52, 0.16, 6.4), translucent(0xd9f0a8, 0.82, 0.15), 0.35, 1.55, 1.9);
    blade.rotation.x = -0.16;
    blade.rotation.z = 0.12;
    g.add(blade);
    for (let i = 0; i < 5; i++) {
      g.add(m(box(0.56, 0.02, 0.07), unlit(0x2f3a22), 0.35, 1.66 + 0.02, i * 1.1 - 0.7));
    }
    g.add(m(sphere(0.42, 8), solid(PAL.eraserWhite), 0, 1.85, -0.15));
    g.userData.muzzle = new THREE.Vector3(0.35, 1.6, 4.4);
    return g;
  },

  /* 📎 bent wire loop plus a flat shield plate */
  clipShield(team, accent) {
    const g = new THREE.Group();
    const steel = solid(PAL.steel, { metal: 0.85, rough: 0.22 });
    const outer = m(torus(1.05, 0.14, 6, 16), steel, 0, 1.15, 0, Math.PI / 2, 0, 0);
    outer.scale.set(1, 1.65, 1);
    g.add(outer);
    const inner = m(torus(0.6, 0.12, 6, 14), steel, 0, 1.05, 0.12, Math.PI / 2, 0, 0);
    inner.scale.set(1, 1.5, 1);
    g.add(inner);
    const shield = m(box(2.5, 2.1, 0.22), solid(accent, { metal: 0.4, rough: 0.4 }), 0, 1.25, 0.72);
    g.add(shield);
    g.add(m(box(2.5, 0.2, 0.3), solid(shade(accent, 0.35)), 0, 2.3, 0.72));
    g.userData.muzzle = new THREE.Vector3(0, 1.3, 1.1);
    return g;
  },

  /* ✂️ two crossed blades over ring handles */
  scissor(team, accent) {
    const g = new THREE.Group();
    const steel = solid(PAL.steel, { metal: 0.9, rough: 0.16 });
    for (const s of [-1, 1]) {
      const blade = m(box(0.24, 0.1, 3.0), steel, s * 0.22, 2.3, 0.95);
      blade.rotation.x = -0.42;
      blade.rotation.z = s * 0.09;
      g.add(blade);
      const handle = m(torus(0.5, 0.14, 6, 12), solid(accent), s * 0.55, 0.75, -0.75, 0, 0, 0);
      handle.rotation.x = 0.5;
      handle.scale.set(1, 1.25, 1);
      g.add(handle);
      const arm = m(box(0.2, 0.18, 1.5), solid(accent), s * 0.4, 1.25, -0.15);
      arm.rotation.x = 0.5;
      g.add(arm);
    }
    g.add(m(cyl(0.2, 0.2, 0.7, 8), solid(PAL.steelDark, { metal: 0.9 }), 0, 1.7, 0.3, 0, 0, Math.PI / 2));
    g.userData.muzzle = new THREE.Vector3(0, 2.6, 2.1);
    return g;
  },

  /* 🩹 pink block with a white sleeve and a medical cross */
  medic(team, accent) {
    const g = new THREE.Group();
    const body = m(box(1.5, 1.9, 0.95), solid(PAL.eraserPink, { rough: 0.85 }), 0, 1.05, 0);
    g.add(body);
    g.add(m(box(1.56, 0.72, 1.0), solid(PAL.paperWhite, { rough: 0.9 }), 0, 1.0, 0));
    g.add(m(box(0.7, 0.2, 0.06), unlit(0xd9484a), 0, 1.05, 0.52));
    g.add(m(box(0.2, 0.7, 0.06), unlit(0xd9484a), 0, 1.05, 0.52));
    g.add(m(cyl(0.62, 0.7, 0.24, 10), solid(accent, { ei: 0.3, emissive: accent }), 0, 0.16, 0));
    g.userData.muzzle = new THREE.Vector3(0, 1.6, 0.4);
    return g;
  },

  /* 🖍️ chunky barrel with a chisel tip and a glowing nib */
  highlighter(team, accent) {
    const g = new THREE.Group();
    g.add(m(cyl(0.56, 0.58, 2.3, 8), glow(PAL.highYellow, 0.35), 0, 1.35, 0));
    g.add(m(cyl(0.6, 0.6, 0.4, 8), solid(shade(PAL.highYellow, -0.4)), 0, 0.35, 0));
    const nib = m(box(0.62, 0.5, 0.62), glow(PAL.highGreen, 0.7), 0, 2.72, 0.12);
    nib.rotation.x = -0.5;
    g.add(nib);
    g.add(m(cyl(0.5, 0.5, 0.2, 8), solid(accent, { ei: 0.3, emissive: accent }), 0, 0.14, 0));
    g.userData.muzzle = new THREE.Vector3(0, 2.7, 0.55);
    return g;
  },

  /* 🧴 fat white tube with an orange twist cap */
  glue(team, accent) {
    const g = new THREE.Group();
    g.add(m(cyl(0.7, 0.74, 2.0, 10), solid(PAL.glueWhite, { rough: 0.5 }), 0, 1.05, 0));
    g.add(m(cyl(0.6, 0.72, 0.7, 10), solid(PAL.glueCap), 0, 2.35, 0));
    g.add(m(cone(0.34, 0.7, 8), solid(PAL.glueCap), 0, 2.95, 0));
    g.add(m(cyl(0.78, 0.78, 0.22, 10), solid(accent, { ei: 0.3, emissive: accent }), 0, 0.12, 0));
    g.add(m(box(0.86, 0.7, 0.04), unlit(0xdfe6ef), 0, 1.2, 0.72));
    g.userData.muzzle = new THREE.Vector3(0, 3.1, 0.3);
    return g;
  },

  /* 📐 two hinged legs — one pencil, one needle */
  compass(team, accent) {
    const g = new THREE.Group();
    const steel = solid(PAL.steel, { metal: 0.85, rough: 0.2 });
    const legA = m(box(0.22, 3.2, 0.22), steel, -0.42, 1.6, 0);
    legA.rotation.z = 0.24;
    g.add(legA);
    const legB = m(box(0.22, 3.0, 0.22), solid(PAL.brass), 0.42, 1.55, 0);
    legB.rotation.z = -0.24;
    g.add(legB);
    g.add(m(cone(0.13, 0.5, 6), solid(PAL.graphite), 0.8, 0.24, 0, Math.PI, 0, 0));
    g.add(m(cone(0.1, 0.55, 6), solid(PAL.steelDark, { metal: 0.9 }), -0.82, 0.26, 0, Math.PI, 0, 0));
    g.add(m(sphere(0.34, 8), solid(accent, { metal: 0.4, ei: 0.25, emissive: accent }), 0, 3.15, 0));
    const wheel = m(torus(0.24, 0.07, 6, 10), steel, 0, 2.2, 0, Math.PI / 2, 0, 0);
    g.add(wheel);
    g.userData.muzzle = new THREE.Vector3(0, 3.3, 0.5);
    return g;
  },

  /* 🪃 chassis with two prongs and a stretched band */
  catapult(team, accent) {
    const g = new THREE.Group();
    g.add(m(box(2.2, 0.55, 2.8), solid(PAL.cardboard), 0, 0.5, 0));
    for (const s of [-1, 1]) {
      const prong = m(box(0.28, 2.0, 0.28), solid(PAL.woodDark), s * 0.85, 1.5, -0.6);
      prong.rotation.x = -0.28;
      g.add(prong);
    }
    const band = m(box(2.0, 0.16, 0.16), solid(PAL.rubberTan, { rough: 0.9 }), 0, 2.3, -1.15);
    g.add(band);
    const pouch = m(box(0.55, 0.4, 0.2), solid(shade(PAL.rubberTan, -0.3)), 0, 2.28, -1.2);
    g.add(pouch);
    g.add(m(box(2.3, 0.2, 0.5), solid(accent, { ei: 0.25, emissive: accent }), 0, 0.82, 1.1));
    for (const s of [-1, 1]) g.add(m(cyl(0.34, 0.34, 0.24, 8), solid(PAL.graphite), s * 1.05, 0.34, 0.9, 0, 0, Math.PI / 2));
    g.userData.muzzle = new THREE.Vector3(0, 2.4, -0.4);
    return g;
  },

  /* 📌 long body, hinged jaw, heavy base */
  breacher(team, accent) {
    const g = new THREE.Group();
    g.add(m(box(1.5, 0.7, 4.2), solid(PAL.steelDark, { metal: 0.7, rough: 0.35 }), 0, 0.4, 0));
    const top = m(box(1.35, 0.75, 3.7), solid(accent, { metal: 0.4, rough: 0.4 }), 0, 1.2, 0.25);
    top.rotation.x = -0.09;
    g.add(top);
    g.add(m(cyl(0.34, 0.34, 1.5, 8), solid(PAL.steel, { metal: 0.9 }), 0, 1.05, -1.85, 0, 0, Math.PI / 2));
    g.add(m(box(1.0, 0.3, 0.5), solid(PAL.steel, { metal: 0.9, rough: 0.2 }), 0, 0.85, 2.15));
    g.add(m(box(1.6, 0.16, 0.7), solid(shade(accent, 0.4)), 0, 1.68, 0.6));
    g.userData.muzzle = new THREE.Vector3(0, 1.0, 2.4);
    return g;
  },

  /* 🩶 a roll of tape on a dispenser sled */
  engineer(team, accent) {
    const g = new THREE.Group();
    g.add(m(box(1.7, 0.5, 1.9), solid(shade(accent, -0.2)), 0, 0.35, 0));
    const roll = m(torus(0.75, 0.34, 8, 16), translucent(PAL.tape, 0.9, 0.4), 0, 1.15, 0, 0, 0, Math.PI / 2);
    g.add(roll);
    g.add(m(cyl(0.4, 0.4, 0.6, 10), solid(PAL.paperWhite), 0, 1.15, 0, 0, 0, Math.PI / 2));
    const strip = m(box(0.66, 0.04, 1.3), translucent(PAL.tape, 0.7, 0.3), 0, 0.62, 1.15);
    strip.rotation.x = 0.36;
    g.add(strip);
    g.add(m(box(0.9, 0.16, 0.14), solid(PAL.steel, { metal: 0.8 }), 0, 0.5, 1.7));
    g.userData.muzzle = new THREE.Vector3(0, 1.2, 1.4);
    return g;
  },

  /* 📍 tiny disc with a downward spike */
  tack(team, accent) {
    const g = new THREE.Group();
    g.add(m(cyl(0.62, 0.66, 0.28, 10), solid(accent, { rough: 0.4, ei: 0.2, emissive: accent }), 0, 0.5, 0));
    g.add(m(cyl(0.24, 0.24, 0.5, 8), solid(PAL.steel, { metal: 0.9 }), 0, 0.24, 0));
    g.add(m(cone(0.16, 0.5, 6), solid(PAL.steelDark, { metal: 0.95 }), 0, 0.78, 0));
    return g;
  },

  /* 🗒️ a curled square of sticky note */
  spy(team, accent) {
    const g = new THREE.Group();
    const sheet = m(box(1.8, 1.8, 0.08), solid(0xf6ee7a, { rough: 0.95 }), 0, 1.0, 0);
    sheet.rotation.x = -0.22;
    g.add(sheet);
    const curl = m(box(1.8, 0.5, 0.08), solid(0xe8dd60, { rough: 0.95 }), 0, 1.86, 0.18);
    curl.rotation.x = -0.85;
    g.add(curl);
    g.add(m(box(1.8, 0.34, 0.1), solid(accent, { ei: 0.3, emissive: accent }), 0, 0.28, -0.02));
    for (let i = 0; i < 3; i++) g.add(m(box(1.1 - i * 0.2, 0.06, 0.02), unlit(0x6b6440), -0.1, 1.28 - i * 0.28, 0.06));
    g.userData.muzzle = new THREE.Vector3(0, 1.2, 0.3);
    return g;
  },

  /* 🧭 upright half-disc with a sweeping arm */
  radar(team, accent) {
    const g = new THREE.Group();
    g.add(m(box(2.2, 0.35, 1.5), solid(shade(accent, -0.25)), 0, 0.28, 0));
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.12, 24, 1, false, 0, Math.PI),
      translucent(0xbfe9ff, 0.72, 0.2)
    );
    disc.rotation.set(Math.PI / 2, 0, 0);
    disc.position.set(0, 1.5, 0);
    g.add(disc);
    for (let i = 1; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      const tick = m(box(0.05, 0.03, 0.3), unlit(0x2b4a5e), Math.cos(a) * 1.15, 1.57, Math.sin(a) * 1.15);
      g.add(tick);
    }
    const arm = m(box(0.1, 0.06, 1.25), glow(PAL.screenGlow, 1.2), 0, 1.62, 0.62);
    g.add(arm);
    g.userData.sweep = arm;
    g.userData.muzzle = new THREE.Vector3(0, 1.7, 0.4);
    return g;
  },
};

/* ─────────────────────────────────────────────────────────────────────
   Aircraft
   ───────────────────────────────────────────────────────────────────── */

function paperPlane(team, accent, size, thickness = 1) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    paperPlaneGeometry(size, size * 0.78, size * 0.18 * thickness),
    solid(PAL.paperWhite, { rough: 0.94, flat: true })
  );
  body.material.side = THREE.DoubleSide;
  g.add(body);

  // team stripe along the keel
  const stripe = m(box(size * 0.1, size * 0.03, size * 0.62), solid(accent, { ei: 0.35, emissive: accent }), 0, size * 0.055, -size * 0.1);
  g.add(stripe);
  return g;
}

const AIR_BUILDERS = {
  glider(team, accent) {
    const g = paperPlane(team, accent, 3.4, 0.7);
    g.userData.muzzle = new THREE.Vector3(0, 0, 1.6);
    return g;
  },
  dart(team, accent) {
    const g = paperPlane(team, accent, 3.0, 1.2);
    for (const s of [-1, 1]) g.add(m(sphere(0.28, 6), solid(PAL.graphite), s * 0.5, -0.42, -0.1));
    g.userData.muzzle = new THREE.Vector3(0, -0.4, 0.6);
    return g;
  },
  heavyWing(team, accent) {
    const g = paperPlane(team, accent, 5.0, 1.6);
    for (const s of [-1, 1]) {
      g.add(m(box(0.1, 0.16, 2.6), solid(PAL.paperCream), s * 0.9, 0.12, -0.6));
      g.add(m(sphere(0.42, 6), solid(PAL.graphite), s * 0.78, -0.62, -0.2));
    }
    g.add(m(sphere(0.5, 6), solid(PAL.graphite), 0, -0.7, 0.4));
    g.userData.muzzle = new THREE.Vector3(0, -0.6, 0.8);
    return g;
  },
};

/* ─────────────────────────────────────────────────────────────────────
   Buildings
   ───────────────────────────────────────────────────────────────────── */

const BUILDING_BUILDERS = {

  /* 🧮 flat calculator: keypad grid, angled display */
  hq(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(box(15, 1.5, 10), solid(0x2f3742, { rough: 0.55 }), 0, 0.75, 0));
    g.add(m(box(15.4, 0.5, 10.4), solid(shade(primary, -0.45)), 0, 0.25, 0));

    const screen = m(box(11.5, 0.35, 2.9), solid(PAL.screen, { rough: 0.25 }), 0, 1.62, -3.0);
    g.add(screen);
    const glass = m(box(10.6, 0.1, 2.1), glow(PAL.screenGlow, 1.05), 0, 1.83, -3.0);
    g.add(glass);
    g.userData.screen = glass;

    const keyMat = solid(0x4d5866, { rough: 0.6 });
    const accentKey = solid(accent, { ei: 0.35, emissive: accent });
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 5; c++) {
        const isAccent = (r === 3 && c === 4) || (r === 0 && c === 0);
        const k = m(box(1.9, 0.42, 1.35), isAccent ? accentKey : keyMat,
          (c - 2) * 2.35, 1.6, (r - 1.1) * 1.75 + 0.9);
        g.add(k);
      }
    }
    g.add(m(box(15.2, 0.3, 0.5), solid(primary, { ei: 0.2, emissive: primary }), 0, 1.35, 5.1));
    g.add(m(box(15.2, 0.3, 0.5), solid(primary, { ei: 0.2, emissive: primary }), 0, 1.35, -5.1));
    return g;
  },

  /* ✏️ open pencil case with pencils poking out */
  infantry(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(box(12, 2.6, 6.4), solid(shade(primary, -0.3), { rough: 0.9 }), 0, 1.3, 0));
    g.add(m(box(12.3, 0.4, 6.7), solid(PAL.graphite), 0, 2.6, 0));

    const lid = m(box(12, 0.5, 6.2), solid(primary, { rough: 0.85 }), 0, 3.4, -3.6);
    lid.rotation.x = -1.05;
    g.add(lid);
    // zip teeth
    for (let i = -5; i <= 5; i++) g.add(m(box(0.4, 0.22, 0.28), solid(PAL.steel, { metal: 0.8 }), i * 1.05, 2.72, 3.15));

    const pencilCols = [PAL.brass, 0xd85f5f, 0x5f8fd8, 0x63c07a, 0xd8b25f];
    for (let i = 0; i < 5; i++) {
      const p = m(cyl(0.34, 0.34, 5.2, 6), solid(pencilCols[i % pencilCols.length]),
        (i - 2) * 1.8 + 0.4, 3.4, -0.4 + (i % 2) * 0.8);
      p.rotation.set(-0.24 + i * 0.05, 0, 0.14 - i * 0.06);
      g.add(p);
      const tip = p.clone();
      tip.geometry = cone(0.34, 0.7, 6);
      tip.material = solid(PAL.graphite);
      tip.position.y += 2.85;
      g.add(tip);
    }
    g.add(m(box(3.4, 0.5, 0.3), solid(accent, { ei: 0.4, emissive: accent }), 0, 1.6, 3.3));
    return g;
  },

  /* 🖋️ a mug bristling with pens */
  ink(team, accent, primary) {
    const g = new THREE.Group();
    const mug = m(cyl(3.4, 2.9, 5.0, 16), solid(PAL.paperWhite, { rough: 0.4 }), 0, 2.5, 0);
    g.add(mug);
    g.add(m(cyl(3.5, 3.5, 0.5, 16), solid(primary, { ei: 0.2, emissive: primary }), 0, 1.1, 0));
    const handle = m(torus(1.25, 0.38, 6, 14), solid(PAL.paperWhite, { rough: 0.4 }), 3.5, 3.0, 0, 0, Math.PI / 2, 0);
    g.add(handle);

    const inkCols = [PAL.inkBlue, PAL.inkBlack, 0xc23b6d, 0x2f9e6a, PAL.highYellow, 0xe08b2f];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const pen = m(cyl(0.24, 0.24, 6.4, 6), solid(inkCols[i % inkCols.length]),
        Math.cos(a) * 1.5, 6.4, Math.sin(a) * 1.5);
      pen.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      g.add(pen);
      const nib = pen.clone();
      nib.geometry = cone(0.22, 0.6, 6);
      nib.material = solid(PAL.steel, { metal: 0.8 });
      nib.position.y += 3.3;
      g.add(nib);
    }
    g.add(m(box(2.4, 1.0, 0.12), solid(accent, { ei: 0.4, emissive: accent }), 0, 2.6, 3.0));
    return g;
  },

  /* 🥫 a biscuit tin workshop */
  siege(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(cyl(4.6, 4.6, 4.0, 18), solid(PAL.steel, { metal: 0.65, rough: 0.35 }), 0, 2.0, 0));
    g.add(m(cyl(4.9, 4.9, 0.55, 18), solid(shade(primary, -0.1), { metal: 0.4 }), 0, 4.3, 0));
    g.add(m(cyl(4.75, 4.75, 1.4, 18), solid(primary, { rough: 0.5 }), 0, 2.1, 0));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.add(m(sphere(0.22, 6), solid(PAL.steelDark, { metal: 0.85 }), Math.cos(a) * 4.62, 0.6, Math.sin(a) * 4.62));
    }
    const arm = m(box(0.5, 0.5, 5.5), solid(PAL.steelDark, { metal: 0.7 }), 0, 5.0, 1.4);
    arm.rotation.x = 0.22;
    g.add(arm);
    g.add(m(box(1.6, 0.8, 1.0), solid(accent, { ei: 0.35, emissive: accent }), 0, 5.3, 4.0));
    return g;
  },

  /* 💻 a tablet on its kickstand */
  tech(team, accent, primary) {
    const g = new THREE.Group();
    const slab = m(box(11.5, 0.55, 7.6), solid(0x3b4350, { rough: 0.35, metal: 0.35 }), 0, 4.3, -0.6);
    slab.rotation.x = -0.32;
    g.add(slab);
    // cloned: the lab pulses its own screen while researching
    const screen = m(box(10.6, 0.12, 6.8), glow(PAL.screenGlow, 0.85).clone(), 0, 4.66, -0.5);
    screen.rotation.x = -0.32;
    screen.userData.noMerge = true;
    g.add(screen);
    g.userData.screen = screen;

    const stand = m(box(10.6, 0.4, 5.6), solid(0x333b46, { metal: 0.4 }), 0, 2.2, 1.9);
    stand.rotation.x = 0.75;
    g.add(stand);
    g.add(m(box(12, 0.5, 1.0), solid(0x2b323c), 0, 0.25, 2.8));
    g.add(m(box(11.6, 0.35, 3.0), solid(shade(primary, -0.2)), 0, 0.3, -1.6));
    g.add(m(box(2.2, 0.1, 0.5), solid(accent, { ei: 0.5, emissive: accent }), 0, 0.5, -3.0));
    return g;
  },

  /* 🛩️ a paper tray with a finished dart on the rail */
  hangar(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(box(13, 0.4, 10, 1), solid(shade(primary, -0.35)), 0, 0.2, 0));
    for (const [w, h, d, x, y, z] of [
      [13, 2.2, 0.5, 0, 1.1, -5], [13, 1.2, 0.5, 0, 0.6, 5],
      [0.5, 2.2, 10, -6.4, 1.1, 0], [0.5, 2.2, 10, 6.4, 1.1, 0],
    ]) g.add(m(box(w, h, d), solid(PAL.steelDark, { metal: 0.6 }), x, y, z));

    // stacked paper
    for (let i = 0; i < 6; i++) {
      g.add(m(box(11.4, 0.14, 8.4), solid(i % 2 ? PAL.paperWhite : PAL.paperCream, { rough: 0.95 }), 0, 0.5 + i * 0.15, 0));
    }
    const dart = paperPlane(team, accent, 4.2, 1.1);
    dart.position.set(0, 2.1, 1.2);
    dart.rotation.set(-0.12, 0, 0);
    dart.userData.noMerge = true;
    g.add(dart);
    g.userData.dart = dart;
    g.add(m(box(3.0, 0.1, 0.4), solid(accent, { ei: 0.45, emissive: accent }), 0, 1.4, 5.2));
    return g;
  },

  /* 🥤 water bottle turret */
  tower(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(cyl(2.3, 2.5, 0.6, 14), solid(shade(primary, -0.3)), 0, 0.3, 0));
    const body = m(cyl(1.85, 2.0, 6.4, 14), translucent(PAL.bottleBlue, 0.55, 0.12), 0, 3.6, 0);
    g.add(body);
    // water inside
    g.add(m(cyl(1.7, 1.85, 4.2, 14), translucent(0x62b8d8, 0.72, 0.1), 0, 2.6, 0));
    g.add(m(cyl(1.1, 1.85, 1.3, 14), translucent(PAL.bottleBlue, 0.5, 0.12), 0, 7.35, 0));
    g.add(m(cyl(1.05, 1.05, 0.9, 12), solid(primary, { rough: 0.5 }), 0, 8.4, 0));
    const label = m(cyl(2.03, 2.03, 2.0, 14, 1), solid(accent, { rough: 0.75 }), 0, 3.2, 0);
    g.add(label);

    const head = new THREE.Group();
    head.position.set(0, 9.1, 0);
    head.add(m(sphere(0.85, 10), solid(PAL.steelDark, { metal: 0.8 }), 0, 0, 0));
    head.add(m(cyl(0.24, 0.24, 2.6, 8), solid(PAL.steel, { metal: 0.9 }), 0, 0.15, 1.3, Math.PI / 2, 0, 0));
    head.userData.noMerge = true;
    g.add(head);
    g.userData.turret = head;
    g.userData.muzzle = new THREE.Vector3(0, 9.25, 2.6);
    return g;
  },

  /* 📌 pin cushion flak battery */
  flak(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(cyl(2.2, 2.4, 0.6, 12), solid(shade(primary, -0.3)), 0, 0.3, 0));
    g.add(m(sphere(1.75, 12), solid(0xa8455f, { rough: 0.95 }), 0, 1.7, 0));
    const head = new THREE.Group();
    head.position.set(0, 2.2, 0);
    const pinCols = [0xf2d94e, 0x4ec2f2, 0xf24e6e, 0x8ef24e, 0xf2924e];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tilt = 0.5 + (i % 3) * 0.12;
      const pin = new THREE.Group();
      pin.add(m(cyl(0.07, 0.07, 2.4, 5), solid(PAL.steel, { metal: 0.9 }), 0, 1.2, 0));
      pin.add(m(sphere(0.3, 8), solid(pinCols[i % pinCols.length], { ei: 0.15, emissive: pinCols[i % pinCols.length] }), 0, 2.5, 0));
      pin.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
      pin.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      head.add(pin);
    }
    head.userData.noMerge = true;
    g.add(head);
    g.userData.turret = head;
    g.add(m(cyl(2.45, 2.45, 0.24, 12), solid(accent, { ei: 0.4, emissive: accent }), 0, 0.68, 0));
    g.userData.muzzle = new THREE.Vector3(0, 4.4, 0);
    return g;
  },

  /* ⛏️ clamp + drum straddling a node */
  extractor(team, accent, primary) {
    const g = new THREE.Group();
    g.add(m(box(5.2, 0.5, 5.2), solid(shade(primary, -0.35)), 0, 0.25, 0));
    for (const s of [-1, 1]) {
      const arm = m(box(0.7, 3.2, 0.7), solid(PAL.steelDark, { metal: 0.75 }), s * 2.1, 1.7, 0);
      arm.rotation.z = -s * 0.14;
      g.add(arm);
      g.add(m(box(1.6, 0.6, 1.6), solid(PAL.steel, { metal: 0.8 }), s * 1.85, 3.3, 0));
    }
    const drum = m(cyl(1.1, 1.1, 2.6, 12), solid(accent, { metal: 0.35, ei: 0.2, emissive: accent }), 0, 3.4, 0, 0, 0, Math.PI / 2);
    drum.userData.noMerge = true;
    g.add(drum);
    g.userData.drum = drum;
    g.add(m(cyl(0.5, 0.5, 1.5, 8), solid(PAL.steel, { metal: 0.85 }), 0, 1.4, 0));
    return g;
  },

  /* 🗂️ a stacking letter tray */
  tray(team, accent, primary) {
    const g = new THREE.Group();
    const wire = solid(PAL.steelDark, { metal: 0.8, rough: 0.3 });
    for (let lvl = 0; lvl < 2; lvl++) {
      const y = 0.4 + lvl * 1.9;
      for (let i = -3; i <= 3; i++) g.add(m(box(0.16, 0.16, 6.0), wire, i * 1.2, y, 0));
      for (let i = -2; i <= 2; i++) g.add(m(box(8.4, 0.16, 0.16), wire, 0, y, i * 1.4));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(m(box(0.24, 1.9, 0.24), wire, sx * 4.1, y + 0.95, sz * 2.9));
      }
      const stack = m(box(7.6, 0.9, 5.2), solid(lvl ? PAL.paperCream : PAL.paperWhite, { rough: 0.95 }), 0, y + 0.6, 0);
      g.add(stack);
    }
    g.add(m(box(2.0, 0.5, 0.14), solid(accent, { ei: 0.4, emissive: accent }), 0, 0.9, 3.05));
    return g;
  },
};

/* ─────────────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────────────── */

export function buildUnitMesh(defId, def, team) {
  const colors = TEAM_COLORS[team];
  const builder = UNIT_BUILDERS[defId] || AIR_BUILDERS[defId];
  const g = new THREE.Group();

  const model = builder
    ? builder(team, colors.accent, colors.primary)
    : m(box(1.4, 2.4, 1.4), solid(colors.primary), 0, 1.2, 0);

  if (!def.air) g.add(teamBase(team, Math.max(0.85, (def.radius || 1) * 1.05)));
  g.add(model);
  g.userData.model = model;
  g.userData.muzzle = model.userData.muzzle || new THREE.Vector3(0, (def.height || 2) * 0.7, 0.5);
  castAll(model);
  return g;
}

export function buildBuildingMesh(defId, def, team) {
  const colors = TEAM_COLORS[team];
  const builder = BUILDING_BUILDERS[defId];
  const g = new THREE.Group();
  const model = builder
    ? builder(team, colors.accent, colors.primary)
    : m(box(def.footprint[0] * 2, def.height, def.footprint[1] * 2), solid(colors.primary), 0, def.height / 2, 0);

  // A calculator HQ is twenty-odd little boxes; bake the static ones together
  // so a base full of structures is not a base full of draw calls.
  const turret = model.userData.turret || null;
  const muzzle = model.userData.muzzle || null;
  const extras = { screen: model.userData.screen, drum: model.userData.drum, dart: model.userData.dart };
  mergeStaticGroup(model);
  model.userData.turret = turret;
  model.userData.muzzle = muzzle;
  Object.assign(model.userData, extras);

  g.add(model);
  g.userData.model = model;
  g.userData.turret = turret;
  g.userData.muzzle = muzzle || new THREE.Vector3(0, def.height * 0.8, 0);
  model.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return g;
}

/** A translucent copy used for the build-placement ghost. */
export function makeGhost(defId, def, team, valid = true) {
  const g = buildBuildingMesh(defId, def, team);
  const col = valid ? 0x74e08a : 0xe2564a;
  // clone: the ghost recolours itself as placement validity changes, and must
  // not drag the shared cache along with it
  g.traverse((c) => {
    if (!c.isMesh) return;
    c.castShadow = false; c.receiveShadow = false;
    c.material = translucent(col, 0.42, 0.4).clone();
  });
  const [hw, hd] = def.footprint;
  const pad = new THREE.Mesh(plane(hw * 2 + 1.2, hd * 2 + 1.2), unlit(col, 0.22, { depthWrite: false }).clone());
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.08;
  g.add(pad);
  g.userData.pad = pad;
  return g;
}

/** Flat ring drawn under a selected entity. */
export function selectionRing(radius, color, thickness = 0.28) {
  const mesh = new THREE.Mesh(
    ring(radius, radius + thickness, 40),
    unlit(color, 0.95, { depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.12;
  mesh.renderOrder = 3;
  return mesh;
}

/** A rally-point flag: a pin with a pennant. */
export function rallyFlag(color) {
  const g = new THREE.Group();
  g.add(m(cyl(0.11, 0.11, 4.2, 6), solid(PAL.steel, { metal: 0.85 }), 0, 2.1, 0));
  const flag = m(box(2.2, 1.1, 0.06), unlit(color, 0.9), 1.1, 3.6, 0);
  g.add(flag);
  g.add(m(cyl(0.5, 0.5, 0.14, 12), unlit(color, 0.5, { depthWrite: false }), 0, 0.09, 0));
  g.userData.flag = flag;
  return g;
}
