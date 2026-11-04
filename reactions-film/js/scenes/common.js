// Shared scene helpers: camera keyframes, easing, windows, handheld shake.
export const clamp = (x, a = 0, b = 1) => !(x > a) ? a : x > b ? b : x;
export const sm = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const lerp = (a, b, u) => a + (b - a) * u;
export const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const ease = u => u * u * (3 - 2 * u);
export const inWin = (s, w, pad = 0) => s >= w[0] - pad && s < w[1] + pad;

/**
 * camKF(s, keys): keys = [{s, p:[x,y,z], l:[x,y,z], f:focal mm, fd?:focus distance, ap?:aperture, cut?:true}]
 * Eased between neighbours; a key with cut:true snaps (new shot). Returns {p, l, focal, focus, aperture, shot}.
 */
export function camKF(s, keys) {
  let i = 0; while (i < keys.length - 1 && s >= keys[i + 1].s) i++;
  const a = keys[i], b = keys[i + 1];
  let shot = 0; for (let k = 1; k <= i; k++) if (keys[k].cut) shot++;
  let u = 0;
  if (b && !b.cut) u = ease(clamp((s - a.s) / Math.max(1e-6, b.s - a.s)));
  const B = b && !b.cut ? b : a;
  const p = lerp3(a.p, B.p, u), l = lerp3(a.l, B.l, u);
  const dist = Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]);
  const fdA = a.fd ?? Math.hypot(a.p[0] - a.l[0], a.p[1] - a.l[1], a.p[2] - a.l[2]);
  const fdB = B.fd ?? Math.hypot(B.p[0] - B.l[0], B.p[1] - B.l[1], B.p[2] - B.l[2]);
  return { p, l, focal: lerp(a.f ?? 35, B.f ?? 35, u), focus: a.fd == null && B.fd == null ? dist : lerp(fdA, fdB, u), aperture: lerp(a.ap ?? 0, B.ap ?? 0, u), shot, roll: lerp(a.roll || 0, B.roll || 0, u) };
}
/** Handheld micro-shake (idle time), amplitude in metres. */
export function shake(cam, time, amp = 0.0006, motion = true) {
  if (!motion || !amp) return cam;
  const sx = Math.sin(time * 1.7) * 0.6 + Math.sin(time * 4.3 + 1.2) * 0.3 + Math.sin(time * 9.1) * 0.1;
  const sy = Math.sin(time * 1.3 + 2) * 0.6 + Math.sin(time * 3.7) * 0.3 + Math.sin(time * 8.3 + 0.5) * 0.1;
  cam.p = [cam.p[0] + sx * amp, cam.p[1] + sy * amp, cam.p[2]];
  cam.l = [cam.l[0] + sx * amp * 0.5, cam.l[1] + sy * amp * 0.5, cam.l[2]];
  return cam;
}
/** Universal indicator colour for pH 1..14 (sRGB hex). */
export const UI_COL = ['#e3262b', '#ef5a24', '#f7931e', '#fbc31b', '#f4ea2a', '#c2d82f', '#4fb748', '#2fa25f', '#1f9a8d', '#2a7fc0', '#2f5fae', '#3b3f99', '#523089', '#5b2c7a'];
export function uiColour(ph, THREE) {
  const x = clamp(ph, 1, 14) - 1, i = Math.floor(Math.min(12.999, x)), f = x - i;
  return new THREE.Color(UI_COL[i]).lerp(new THREE.Color(UI_COL[Math.min(13, i + 1)]), f);
}
/** Set group.visible by stage window (each sub-stage only visible during its time window). */
export function showStages(s, groups, stages, pad = 0) { for (const k in groups) if (groups[k]) groups[k].visible = !!stages[k] && inWin(s, stages[k], pad); }
