/* SALT LINE — everything standing on the flat that is not a door.
 *
 * Rakes, sluice boards, survey posts, and the markers. All of it is drawn
 * with the same world-space slab the doorframes use, because the silhouette
 * language of this game is "tall thin thing against a low horizon" and a
 * sprite that scales would break the moment you walked past it.
 *
 * A marker's name is carved live: when you take a letter off it, the letter
 * comes off the stone and the gouge stays there for the rest of the run.
 */
(function (S) {
  'use strict';

  var M = S.M;

  var P = {};

  function timberShade(t, z, dist, out) {
    var v = 0.44 + M.noise2(t * 13, z * 24) * 0.36;
    var band = z * 7.3; var f = band - Math.floor(band);
    if (f < 0.13) v *= 0.62;
    if (z < 0.16) v *= 0.55 + z * 2.4;          /* brine rot at the waterline */
    out[0] = v; out[1] = 0;
  }

  function saltStoneShade(t, z, dist, out) {
    var v = 0.36 + M.ridge(t * 6 + 3, z * 6, 2) * 0.46;
    out[0] = v; out[1] = 0;
  }

  P.markerDisplay = function (data) {
    if (data._disp !== undefined && data._dispN === data.taken) return data._disp;
    var chars = data.name.split('');
    for (var i = 0; i < data.letters.length; i++) {
      if (i < data.taken) chars[data.letters[i].i] = ' ';
    }
    data._disp = chars.join('');
    data._dispN = data.taken;
    data._plate = null;
    return data._disp;
  };

  P.markerPlate = function (data) {
    var disp = P.markerDisplay(data);
    if (!data._plate) {
      var parts = disp.split(' ');
      /* two lines if it will not fit across the stone */
      data._plate = S.Glyphs.plate(disp.length > 9 ? parts[0] : disp, 2, 1);
      data._plate2 = (disp.length > 9 && parts.length > 1)
        ? S.Glyphs.plate(parts.slice(1).join(' '), 2, 1) : null;
    }
    return data._plate;
  };

  P.render = function (fb, tier, prop, playerX, playerY) {
    var R = S.Ray;
    var dx = prop.x - playerX, dy = prop.y - playerY;
    var d2 = dx * dx + dy * dy;
    if (d2 > S.K.VIEW * S.K.VIEW) return;

    switch (prop.type) {
      case 'post': {
        var lean = prop.lean || 0;
        var ex = prop.x + Math.cos(prop.ang) * lean;
        var ey = prop.y + Math.sin(prop.ang) * lean;
        R.slab(fb, prop.x - 0.055, prop.y, ex + 0.055, ey, 0, prop.h, timberShade);
        R.slab(fb, prop.x, prop.y - 0.055, ex, ey + 0.055, 0, prop.h, timberShade);
        break;
      }
      case 'rake': {
        var h = prop.h;
        S.Door.post(fb, prop.x, prop.y, 0.05, 0, h, timberShade);
        /* the head, turned to whatever angle it was dropped at */
        var cx = Math.cos(prop.ang) * 0.42, cy = Math.sin(prop.ang) * 0.42;
        R.slab(fb, prop.x - cx, prop.y - cy, prop.x + cx, prop.y + cy,
          h - 0.14, h, timberShade);
        /* tines */
        for (var t = -2; t <= 2; t++) {
          var fx = prop.x + cx * (t / 2.4), fy = prop.y + cy * (t / 2.4);
          R.slab(fb, fx - 0.02, fy, fx + 0.02, fy, h - 0.34, h - 0.12, timberShade);
        }
        break;
      }
      case 'sluice': {
        var sh = Math.min(1.5, prop.h);
        var ax = Math.cos(prop.ang) * 0.65, ay = Math.sin(prop.ang) * 0.65;
        S.Door.post(fb, prop.x - ax, prop.y - ay, 0.07, 0, sh + 0.25, timberShade);
        S.Door.post(fb, prop.x + ax, prop.y + ay, 0.07, 0, sh + 0.25, timberShade);
        R.slab(fb, prop.x - ax, prop.y - ay, prop.x + ax, prop.y + ay, 0.1, sh, timberShade);
        break;
      }
      case 'spentdoor': {
        /* the gate you already paid, seen from the wrong side */
        var yy = prop.y;
        S.Door.post(fb, prop.x, yy - 1.0, 0.15, 0, 2.36, saltStoneShade);
        S.Door.post(fb, prop.x, yy + 1.0, 0.15, 0, 2.36, saltStoneShade);
        R.slab(fb, prop.x, yy - 1.15, prop.x, yy + 1.15, 2.08, 2.36, saltStoneShade);
        R.slab(fb, prop.x + 0.05, yy - 0.9, prop.x + 0.05, yy + 0.86, 0.02, 2.06,
          function (t, z, dist, out) {
            var v = 0.26 + M.noise2(t * 9, z * 15) * 0.20;
            var band = z * 4.6; var f = band - Math.floor(band);
            if (f < 0.11) v *= 0.45;
            out[0] = v; out[1] = 0;
          });
        break;
      }
      case 'marker': {
        var data = prop.data;
        var plate = P.markerPlate(data);
        var plate2 = data._plate2;
        var mh = 0.52 + prop.h;
        var mw = 0.44;
        var sx = Math.sin(prop.ang) * mw, sy = Math.cos(prop.ang) * mw;

        var shade = function (t, z, dist, out) {
          var v = 0.34 + M.ridge(t * 8 + prop.seed * 0.01, z * 8, 2) * 0.42;
          /* rounded top */
          var top = (z - (mh - 0.18)) / 0.18;
          if (top > 0) {
            var edge = Math.abs(t - 0.5) * 2;
            if (edge > Math.sqrt(Math.max(0, 1 - top * top))) { out[0] = -1; return; }
          }
          /* the carved name */
          var u = (t - 0.09) / 0.82;
          var line1 = (z - (mh - 0.62)) / 0.22;
          var line2 = (z - (mh - 0.92)) / 0.22;
          var cut = false, lip = false;
          if (u >= 0 && u < 1) {
            if (line1 >= 0 && line1 < 1) {
              var bx = (u * plate.w) | 0, by = ((1 - line1) * plate.h) | 0;
              if (plate.bits[by * plate.w + bx]) cut = true;
              else if (bx > 0 && by > 0 && plate.bits[(by - 1) * plate.w + (bx - 1)]) lip = true;
            } else if (plate2 && line2 >= 0 && line2 < 1) {
              var bx2 = (u * plate2.w) | 0, by2 = ((1 - line2) * plate2.h) | 0;
              if (plate2.bits[by2 * plate2.w + bx2]) cut = true;
              else if (bx2 > 0 && by2 > 0 && plate2.bits[(by2 - 1) * plate2.w + (bx2 - 1)]) lip = true;
            }
          }
          if (cut) v *= 0.22;
          else if (lip) v = Math.min(1, v * 1.6);
          out[0] = v; out[1] = 0;
        };

        R.slab(fb, prop.x - sx, prop.y - sy, prop.x + sx, prop.y + sy, 0.02, mh, shade);
        R.slab(fb, prop.x - sx + 0.06 * sy / mw, prop.y - sy - 0.06 * sx / mw,
                   prop.x + sx + 0.06 * sy / mw, prop.y + sy - 0.06 * sx / mw,
                   0.02, mh, function (t, z, d, out) {
          var top = (z - (mh - 0.18)) / 0.18;
          if (top > 0) {
            var edge = Math.abs(t - 0.5) * 2;
            if (edge > Math.sqrt(Math.max(0, 1 - top * top))) { out[0] = -1; return; }
          }
          out[0] = 0.22 + M.noise2(t * 7, z * 9) * 0.16; out[1] = 0;
        });
        break;
      }
    }
  };

  P.timberShade = timberShade;
  P.stoneShade = saltStoneShade;
  S.Props = P;
})(SALT);
