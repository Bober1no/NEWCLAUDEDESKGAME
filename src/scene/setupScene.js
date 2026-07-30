/**
 * Renderer, scene, lighting and the RTS free-camera.
 *
 * Camera scheme (documented in the field manual on the setup screen):
 *   right-drag  orbit          middle-drag  pan
 *   wheel       zoom to cursor WASD/arrows  pan
 *   Q/E         rotate         R/F-wheel    pitch
 *   F           focus selection
 */
import * as THREE from 'three';
import { WORLD } from '../core/constants.js';
import { clamp, damp, TAU, frand } from '../core/utils.js';

/* ─────────────────────────────────────────────────────────────────────
   Renderer + scene
   ───────────────────────────────────────────────────────────────────── */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0x0a0d12, 1);
  return renderer;
}

function backgroundTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#0a0e15');
  g.addColorStop(0.42, '#141b25');
  g.addColorStop(0.72, '#1d2530');
  g.addColorStop(1.0, '#080a0e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = backgroundTexture();
  scene.fog = new THREE.Fog(0x121821, 260, 620);

  /* Key light — the desk lamp. Shadow frustum wraps the whole desk. */
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.15);
  sun.position.set(-74, 118, 62);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const halfSpan = Math.max(WORLD.W, WORLD.D) * 0.62;
  const sc = sun.shadow.camera;
  sc.left = -halfSpan; sc.right = halfSpan;
  sc.top = halfSpan; sc.bottom = -halfSpan;
  sc.near = 20; sc.far = 340;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.35;
  scene.add(sun);
  scene.add(sun.target);

  /* Cool bounce from the window on the far side of the room. */
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.55);
  rim.position.set(96, 54, -88);
  scene.add(rim);

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a2118, 0.85);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xffffff, 0.22);
  scene.add(ambient);

  /* The room floor, far below the desk — sells the sense of scale. */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.96, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -68;
  floor.receiveShadow = false;
  scene.add(floor);

  return { scene, sun, rim, hemi, ambient };
}

/* ─────────────────────────────────────────────────────────────────────
   Free camera
   ───────────────────────────────────────────────────────────────────── */
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class FreeCam {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.target = new THREE.Vector3(0, 0, 0);
    this._target = new THREE.Vector3(0, 0, 0);   // smoothed
    this.azimuth = Math.PI;                       // sit on the player's edge, look up the desk
    this.polar = 0.88;                            // radians above horizon
    this.distance = 96;

    this._azimuth = this.azimuth;
    this._polar = this.polar;
    this._distance = this.distance;

    this.minDistance = 16;
    this.maxDistance = 245;
    this.minPolar = 0.20;
    this.maxPolar = 1.44;

    this.panSpeed = 62;          // world units per second at reference zoom
    this.edgePan = true;
    this.edgeMargin = 6;
    this.enabled = true;

    this.keys = new Set();
    this.pointer = new THREE.Vector2(-10, -10);
    this.pointerInside = false;

    this._dragMode = null;       // 'orbit' | 'pan'
    this._last = { x: 0, y: 0 };
    this.rightDragDistance = 0;
    this._panStart = new THREE.Vector3();
    this._shake = 0;
    this._shakeSeed = frand(0, 100);
    this._raycaster = new THREE.Raycaster();

    this._bind();
  }

  /* ── input plumbing ─────────────────────────────────────────────── */
  _bind() {
    const d = this.dom;
    this._onPointerDown = (e) => {
      if (!this.enabled) return;
      this.pointerInside = true;
      if (e.button === 2) { this._dragMode = 'orbit'; this.rightDragDistance = 0; }
      else if (e.button === 1) { this._dragMode = 'pan'; this._grabGround(e); e.preventDefault(); }
      else return;
      this._last.x = e.clientX; this._last.y = e.clientY;
      d.setPointerCapture?.(e.pointerId);
      if (this._dragMode === 'pan') d.classList.add('panning');
    };

    this._onPointerMove = (e) => {
      this.pointer.set(e.clientX, e.clientY);
      this.pointerInside = true;
      if (!this.enabled || !this._dragMode) return;
      const dx = e.clientX - this._last.x;
      const dy = e.clientY - this._last.y;
      this._last.x = e.clientX; this._last.y = e.clientY;

      if (this._dragMode === 'orbit') {
        this.rightDragDistance += Math.abs(dx) + Math.abs(dy);
        this.azimuth -= dx * 0.0055;
        this.polar = clamp(this.polar + dy * 0.0042, this.minPolar, this.maxPolar);
      } else {
        this._dragPan(e);
      }
    };

    this._onPointerUp = (e) => {
      if (this._dragMode) d.releasePointerCapture?.(e.pointerId);
      this._dragMode = null;
      d.classList.remove('panning');
    };

    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const before = this._groundAt(e.clientX, e.clientY);
      const factor = Math.exp(clamp(e.deltaY, -260, 260) * 0.0013);
      this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
      // keep the world point under the cursor roughly pinned
      if (before) {
        this._applyImmediate();
        const after = this._groundAt(e.clientX, e.clientY);
        if (after) {
          this.target.x += (before.x - after.x) * 0.85;
          this.target.z += (before.z - after.z) * 0.85;
          this._clampTarget();
        }
      }
    };

    this._onContext = (e) => e.preventDefault();
    this._onKeyDown = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onLeave = () => { this.pointerInside = false; };

    d.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    d.addEventListener('wheel', this._onWheel, { passive: false });
    d.addEventListener('contextmenu', this._onContext);
    d.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    d.removeEventListener('wheel', this._onWheel);
    d.removeEventListener('contextmenu', this._onContext);
    d.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  /* ── helpers ────────────────────────────────────────────────────── */
  _ndc(cx, cy, out = new THREE.Vector2()) {
    const r = this.dom.getBoundingClientRect();
    out.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    return out;
  }

  /** World-space point where a screen ray meets the desk plane (y = 0). */
  _groundAt(cx, cy, out = new THREE.Vector3()) {
    this._raycaster.setFromCamera(this._ndc(cx, cy), this.camera);
    const hit = this._raycaster.ray.intersectPlane(GROUND, out);
    return hit ? out : null;
  }

  groundAtPointer(out) { return this._groundAt(this.pointer.x, this.pointer.y, out); }

  _grabGround(e) {
    const p = this._groundAt(e.clientX, e.clientY);
    if (p) this._panStart.copy(p);
  }

  _dragPan(e) {
    const p = this._groundAt(e.clientX, e.clientY);
    if (!p) return;
    this.target.x -= p.x - this._panStart.x;
    this.target.z -= p.z - this._panStart.z;
    this._clampTarget();
    this._applyImmediate();
    const p2 = this._groundAt(e.clientX, e.clientY);
    if (p2) this._panStart.copy(p2);
  }

  _clampTarget() {
    const mx = WORLD.W * 0.62, mz = WORLD.D * 0.68;
    this.target.x = clamp(this.target.x, -mx, mx);
    this.target.z = clamp(this.target.z, -mz, mz);
    this.target.y = 0;
  }

  panBy(dx, dz) {
    this.target.x += dx; this.target.z += dz;
    this._clampTarget();
  }

  /** Instantly place the camera without smoothing (used inside drag maths). */
  _applyImmediate() {
    this._azimuth = this.azimuth;
    this._polar = this.polar;
    this._distance = this.distance;
    this._target.copy(this.target);
    this._place(0);
  }

  focusOn(x, z, distance = null) {
    this.target.set(x, 0, z);
    this._clampTarget();
    if (distance != null) this.distance = clamp(distance, this.minDistance, this.maxDistance);
  }

  snapTo(x, z, distance = null) {
    this.focusOn(x, z, distance);
    this._target.copy(this.target);
    if (distance != null) this._distance = this.distance;
  }

  shake(amount) { this._shake = Math.min(2.2, this._shake + amount); }

  /* ── frame update ───────────────────────────────────────────────── */
  update(dt) {
    if (this.enabled) this._keyboardAndEdgePan(dt);

    const k = this.keys;
    if (k.has('KeyQ')) this.azimuth += 1.5 * dt;
    if (k.has('KeyE')) this.azimuth -= 1.5 * dt;
    if (k.has('PageUp')) this.distance = clamp(this.distance * (1 - dt), this.minDistance, this.maxDistance);
    if (k.has('PageDown')) this.distance = clamp(this.distance * (1 + dt), this.minDistance, this.maxDistance);

    const lam = 14;
    this._azimuth = damp(this._azimuth, this.azimuth, lam, dt);
    this._polar = damp(this._polar, this.polar, lam, dt);
    this._distance = damp(this._distance, this.distance, lam, dt);
    this._target.x = damp(this._target.x, this.target.x, lam, dt);
    this._target.z = damp(this._target.z, this.target.z, lam, dt);

    if (this._shake > 0.0005) this._shake = Math.max(0, this._shake - dt * 2.6);
    this._place(dt);
  }

  _keyboardAndEdgePan(dt) {
    const k = this.keys;
    let px = 0, pz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) pz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) pz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) px -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) px += 1;

    if (this.edgePan && this.pointerInside && !this._dragMode) {
      const w = window.innerWidth, h = window.innerHeight, m = this.edgeMargin;
      const { x, y } = this.pointer;
      if (x >= 0 && y >= 0) {
        if (x < m) px -= 1; else if (x > w - m) px += 1;
        if (y < m) pz -= 1; else if (y > h - m) pz += 1;
      }
    }

    if (!px && !pz) return;
    const len = Math.hypot(px, pz) || 1;
    px /= len; pz /= len;
    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 2.1 : 1;
    const speed = this.panSpeed * boost * (0.35 + this._distance / 110) * dt;
    const ca = Math.cos(this._azimuth), sa = Math.sin(this._azimuth);
    // pan in camera-relative axes projected onto the desk
    this.target.x += (px * -sa + pz * ca) * speed;
    this.target.z += (px * ca + pz * sa) * speed;
    this._clampTarget();
  }

  _place(dt) {
    const cp = Math.cos(this._polar), sp = Math.sin(this._polar);
    const x = this._target.x + Math.cos(this._azimuth) * cp * this._distance;
    const y = sp * this._distance;
    const z = this._target.z + Math.sin(this._azimuth) * cp * this._distance;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this._target);

    if (this._shake > 0.0005) {
      const s = this._shake * this._shake;
      const t = performance.now() * 0.001;
      this.camera.position.x += Math.sin(t * 41 + this._shakeSeed) * s * 0.9;
      this.camera.position.y += Math.sin(t * 57 + this._shakeSeed * 2) * s * 0.7;
      this.camera.position.z += Math.cos(t * 47 + this._shakeSeed * 3) * s * 0.9;
      this.camera.lookAt(this._target);
    }
  }

  /** Serialisable pose, for save/restore between menu and match. */
  get pose() {
    return { x: this.target.x, z: this.target.z, az: this.azimuth, po: this.polar, d: this.distance };
  }
  set pose(p) {
    this.target.set(p.x, 0, p.z);
    this.azimuth = p.az; this.polar = p.po; this.distance = p.d;
    this._applyImmediate();
  }
}

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.6, 900);
  cam.position.set(0, 90, 90);
  return cam;
}

/** Slow idle drift used behind the main menu. */
export function menuOrbit(controls, dt) {
  controls.azimuth += dt * 0.045;
  controls.target.set(Math.sin(controls.azimuth * 0.4) * 12, 0, 0);
}

export const TAU_ = TAU;
