/* SALT LINE — the flat.
 *
 * Two chunks of terrain live at once: the one you are in and the one past the
 * gate, so an open door always shows you real ground rather than a black
 * rectangle. When you cross, the far chunk slides into the near slot and a new
 * one is generated behind it. Everything -- props, markers, entities -- shifts
 * with it, so world coordinates never grow and float precision never drifts.
 *
 * A chunk is: pans of standing brine, dry crust between them, stacked salt
 * block walls that are the only cover on the flat, and a levee across the far
 * end with a doorframe set into the one gap in it. The levee is knee-high.
 * You can see the whole next section over it. You cannot cross it.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K, CELL = S.CELL, SOLID = S.SOLID;

  var W = {
    grid: null,
    gw: K.GRID_W,
    gh: K.GRID_H,
    props: [],
    markers: [],
    door: null,
    nextDoor: null,
    doorNum: 1,
    entryY: 0,
    nextEntryY: 0,
    seed: 1
  };

  var CW = K.CHUNK_W;
  var GATE_X = 26;              /* local cell x of the levee              */
  var BACK_X = 0;               /* local cell x of the spent levee behind */

  W.init = function (seed, startDoor) {
    W.seed = seed >>> 0;
    W.grid = new Uint8Array(W.gw * W.gh);
    W.props = [];
    W.markers = [];
    W.doorNum = startDoor || 1;
    W.entryY = (W.gh * 0.5) | 0;

    var a = W.genChunk(0, W.doorNum, W.entryY, false);
    W.door = a.door;
    W.nextEntryY = a.gapY;
    var b = W.genChunk(CW, W.doorNum + 1, W.nextEntryY, false);
    W.nextDoor = b.door;
    W.stampBackLevee(0, W.entryY);
  };

  /* ---- the crossing ------------------------------------------------------ */
  W.advance = function () {
    var g = W.grid, gw = W.gw, gh = W.gh;
    for (var y = 0; y < gh; y++) {
      var row = y * gw;
      for (var x = 0; x < CW; x++) g[row + x] = g[row + x + CW];
    }

    var kept = [];
    for (var i = 0; i < W.props.length; i++) {
      var p = W.props[i];
      if (p.x >= CW) { p.x -= CW; kept.push(p); }
    }
    W.props = kept;
    W.markers = W.markers.filter(function (m) { return m.prop.x >= 0 && W.props.indexOf(m.prop) >= 0; });

    W.doorNum++;
    W.entryY = W.nextEntryY;
    W.door = W.nextDoor;
    if (W.door) W.door.x -= CW;

    var b = W.genChunk(CW, W.doorNum + 1, 0, false);
    W.nextDoor = b.door;
    W.nextEntryY = W.door ? W.door.gapY : W.entryY;
    /* the next chunk's gap decides where we will enter the one after */
    W.nextEntryY = b.entryHint;

    W.stampBackLevee(0, W.entryY);
    return W.doorNum;
  };

  /* the levee you just came through, sealed behind you */
  W.stampBackLevee = function (x0, gapY) {
    var g = W.grid, gw = W.gw, gh = W.gh;
    for (var y = 0; y < gh; y++) g[y * gw + (x0 + BACK_X)] = CELL.DIKE;
    W.props.push({
      type: 'spentdoor', x: x0 + BACK_X + 0.55, y: gapY + 1.0,
      ang: 0, h: 2.3, seed: (gapY * 977) | 0
    });
  };

  /* ---- generation -------------------------------------------------------- */
  W.genChunk = function (x0, doorNum, entryY, isFirst) {
    var g = W.grid, gw = W.gw, gh = W.gh;
    var rng = M.rng((W.seed ^ (doorNum * 0x9e3779b1)) >>> 0);
    var depth = M.sat(doorNum / K.MAX_DOORS);

    /* deeper in the line, more of the flat is under water */
    var panBias = 0.44 + depth * 0.20;
    var nz = doorNum * 13.7;

    for (var y = 0; y < gh; y++) {
      var row = y * gw;
      for (var lx = 0; lx < CW; lx++) {
        var gx = x0 + lx;
        var cell;
        if (y < 2 || y >= gh - 2) {
          cell = CELL.DIKE;
        } else {
          var n = M.fbm(gx * 0.115 + nz, y * 0.115 + nz * 0.5, 3);
          if (n < panBias - 0.16) cell = (doorNum > 10 && n < panBias - 0.27) ? CELL.DEEP : CELL.BRINE;
          else if (n < panBias) cell = CELL.BRINE;
          else cell = CELL.CRUST;
        }
        g[row + gx] = cell;
      }
    }

    /* --- stacked salt walls. the only cover on the flat, and the reason a
     * pan is worth crossing: what you cannot see round is what gets you. --- */
    var stackCount = 3 + ((depth * 5) | 0) + rng.int(3);
    for (var s = 0; s < stackCount; s++) {
      var sx = 3 + rng.int(CW - 9);
      var sy = 3 + rng.int(gh - 8);
      var sw = 1 + rng.int(4);
      var sh = 1 + rng.int(4);
      if (rng.chance(0.5)) { var t = sw; sw = sh; sh = t; }
      for (var ay = 0; ay < sh; ay++) {
        for (var ax = 0; ax < sw; ax++) {
          var cx = x0 + sx + ax, cy = sy + ay;
          if (cy < 3 || cy >= gh - 3) continue;
          if (sx + ax > CW - 5) continue;
          /* they slump at the ends, so they read as stacked blocks that have
           * been standing out here a long time */
          var edge = (ax === 0 || ax === sw - 1 || ay === 0 || ay === sh - 1);
          g[cy * gw + cx] = (edge && rng.chance(0.35)) ? CELL.PILE : CELL.STACK;
        }
      }
    }

    /* --- heaped harvest --- */
    var pileCount = 2 + rng.int(4);
    for (var p = 0; p < pileCount; p++) {
      var px = x0 + 3 + rng.int(CW - 8), py = 3 + rng.int(gh - 7);
      var pr = 1 + rng.int(2);
      for (var qy = -pr; qy <= pr; qy++) {
        for (var qx = -pr; qx <= pr; qx++) {
          if (qx * qx + qy * qy > pr * pr + 0.5) continue;
          var mx = px + qx, my = py + qy;
          if (my < 3 || my >= gh - 3 || mx - x0 > CW - 5 || mx - x0 < 2) continue;
          g[my * gw + mx] = CELL.PILE;
        }
      }
    }

    /* --- the levee and its one gap --- */
    var gapY = 4 + rng.int(gh - 11);
    for (var ly = 0; ly < gh; ly++) g[ly * gw + (x0 + GATE_X)] = CELL.DIKE;
    g[gapY * gw + (x0 + GATE_X)] = CELL.CRUST;
    g[(gapY + 1) * gw + (x0 + GATE_X)] = CELL.CRUST;
    /* apron either side of the gap so the threshold is always dry */
    for (var apx = -1; apx <= 1; apx++) {
      for (var apy = 0; apy <= 1; apy++) {
        var acx = x0 + GATE_X + apx, acy = gapY + apy;
        if (apx === 0) continue;
        if (acx - x0 < 1 || acx - x0 >= CW) continue;
        g[acy * gw + acx] = CELL.CRUST;
      }
    }

    /* --- the haul road: a guaranteed route from the entry to the gap. it is
     * not always dry. it is always passable. --- */
    var ey = (entryY || gapY) + 1;
    ey = M.clamp(ey, 3, gh - 4);
    var cy2 = ey;
    for (var rx = 1; rx <= GATE_X - 1; rx++) {
      var target = gapY + 0.5;
      var t = (rx - 1) / (GATE_X - 2);
      var want = ey + (target - ey) * M.smooth(t);
      want += (M.noise2(rx * 0.31 + nz, nz) - 0.5) * 5.0 * (1 - Math.abs(t * 2 - 1));
      cy2 = M.clamp(Math.round(want), 3, gh - 4);
      for (var wy = -1; wy <= 1; wy++) {
        var rcy = cy2 + wy;
        if (rcy < 3 || rcy >= gh - 3) continue;
        var idx = rcy * gw + (x0 + rx);
        var c = g[idx];
        if (SOLID[c] || c === CELL.DEEP) g[idx] = (wy === 0) ? CELL.CRUST : CELL.BRINE;
      }
    }

    /* entry apron */
    for (var iy = -1; iy <= 2; iy++) {
      for (var ix = 1; ix <= 3; ix++) {
        var ecy = M.clamp(ey + iy, 3, gh - 4);
        g[ecy * gw + (x0 + ix)] = CELL.CRUST;
      }
    }

    /* --- markers: the dead, and the letters still on them ------------------
     * They sit off the road on purpose. Everything you need to keep walking
     * is a detour, and the detour is where the flat is worst. */
    var markerCount = doorNum < 5 ? 0 : (doorNum < 30 ? 1 + rng.int(2) : 1 + rng.int(2));
    if (doorNum >= 5 && rng.chance(0.30)) markerCount++;
    for (var mI = 0; mI < markerCount; mI++) {
      var spot = W.findSpot(x0, rng, 3, GATE_X - 2, 4, gh - 5);
      if (!spot) continue;
      var who = S.Names.person(rng);
      var letters = W.lettersFromName(who, rng, doorNum);
      var mp = {
        type: 'marker', x: spot.x + 0.5, y: spot.y + 0.5,
        ang: rng.range(-0.35, 0.35), h: rng.range(0.75, 1.15),
        seed: rng.int(99999),
        data: {
          name: who,
          epitaph: S.Names.epitaph(rng),
          letters: letters,
          read: false,
          taken: 0,
          door: doorNum
        }
      };
      W.props.push(mp);
      W.markers.push({ prop: mp });
    }

    /* --- the one you came for -------------------------------------------
     * Past the gate that reads none, there is a stone with a number cut
     * where the name should be, and the name itself cut on the back of it by
     * somebody who ran out of time before they could move it round. Every
     * letter on that back face is what you walked sixty gates to collect. */
    if (doorNum === W.TARGET_DOOR) {
      var tspot = W.findSpot(x0, rng, 6, GATE_X - 4, 5, gh - 6) ||
                  { x: x0 + 14, y: (gh >> 1) };
      var who2 = S.Names.person(rng);
      var all = [];
      for (var ti = 0; ti < who2.length; ti++) {
        var tc = who2.charAt(ti);
        if (tc >= 'A' && tc <= 'Z') all.push({ ch: tc, i: ti });
      }
      var tp = {
        type: 'marker', x: tspot.x + 0.5, y: tspot.y + 0.5,
        ang: 0.08, h: 1.42, seed: 4411,
        data: {
          name: who2,
          number: S.Names.numbered(rng),
          epitaph: rng.pick(S.Names.TARGET_EPITAPH),
          letters: all,
          read: false,
          taken: 0,
          door: doorNum,
          isTarget: true
        }
      };
      W.props.push(tp);
      W.markers.push({ prop: tp });
    }

    /* --- scattered verticals. the silhouette language of the whole game is
     * "tall thin thing against a low horizon", and these are what make the
     * empty stretches read as a place someone used to work. --- */
    var postCount = 5 + rng.int(9);
    for (var pI = 0; pI < postCount; pI++) {
      var ps = W.findSpot(x0, rng, 2, CW - 2, 3, gh - 4);
      if (!ps) continue;
      var kind = rng.f();
      W.props.push({
        type: kind < 0.45 ? 'post' : (kind < 0.75 ? 'rake' : 'sluice'),
        x: ps.x + rng.range(0.2, 0.8),
        y: ps.y + rng.range(0.2, 0.8),
        ang: rng.range(0, 6.283),
        h: rng.range(0.7, 2.1),
        lean: rng.range(-0.22, 0.22),
        seed: rng.int(99999)
      });
    }

    var door = new S.Door(doorNum, x0 + GATE_X + 0.5, gapY + 1.0);
    return { door: door, gapY: gapY, entryHint: gapY };
  };

  /* Letters a marker still carries, as positions in the carved name -- so
   * when you take one it comes off the stone and the gap stays there. The
   * deeper the line, the less is left on anybody. */
  W.lettersFromName = function (name, rng, doorNum) {
    var idx = [];
    for (var i = 0; i < name.length; i++) {
      var c = name.charAt(i);
      if (c >= 'A' && c <= 'Z') idx.push(i);
    }
    rng.shuffle(idx);
    var take = doorNum < 20 ? (2 + rng.int(2)) : (1 + rng.int(2));
    if (doorNum > 52) take = 1 + rng.int(2);
    take = Math.min(take, idx.length);
    var out = [];
    for (var j = 0; j < take; j++) out.push({ ch: name.charAt(idx[j]), i: idx[j] });
    return out;
  };

  W.findSpot = function (x0, rng, lx0, lx1, y0, y1) {
    for (var tries = 0; tries < 40; tries++) {
      var x = x0 + lx0 + rng.int(Math.max(1, lx1 - lx0));
      var y = y0 + rng.int(Math.max(1, y1 - y0));
      var c = W.grid[y * W.gw + x];
      if (SOLID[c] || c === CELL.DEEP) continue;
      /* keep clear of anything already placed */
      var ok = true;
      for (var i = 0; i < W.props.length; i++) {
        var p = W.props[i];
        if (M.dist2(p.x, p.y, x + 0.5, y + 0.5) < 2.2) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return null;
  };

  /* ---- queries ----------------------------------------------------------- */
  W.cellAt = function (x, y) {
    var cx = x | 0, cy = y | 0;
    if (cx < 0 || cy < 0 || cx >= W.gw || cy >= W.gh) return CELL.CRUST;
    return W.grid[cy * W.gw + cx];
  };

  W.solidAt = function (x, y) {
    var cx = x | 0, cy = y | 0;
    if (cx < 0 || cy < 0 || cx >= W.gw || cy >= W.gh) return cx < 0;
    return SOLID[W.grid[cy * W.gw + cx]];
  };

  W.isWet = function (x, y) {
    var c = W.cellAt(x, y);
    return c === CELL.BRINE || c === CELL.DEEP;
  };

  W.isDeep = function (x, y) { return W.cellAt(x, y) === CELL.DEEP; };

  /* Collision: terrain, plus the door panel while it is shut, plus a hard
   * floor on x so you cannot walk off the back of the world. */
  W.blocked = function (x, y, r) {
    if (x < 0.7) return true;
    var minX = (x - r) | 0, maxX = (x + r) | 0;
    var minY = (y - r) | 0, maxY = (y + r) | 0;
    for (var cy = minY; cy <= maxY; cy++) {
      for (var cx = minX; cx <= maxX; cx++) {
        if (cx < 0 || cy < 0 || cx >= W.gw || cy >= W.gh) { if (cx < 0) return true; continue; }
        if (!SOLID[W.grid[cy * W.gw + cx]]) continue;
        /* circle vs cell AABB */
        var nx = M.clamp(x, cx, cx + 1), ny = M.clamp(y, cy, cy + 1);
        var dx = x - nx, dy = y - ny;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    if (W.door && W.door.blocks(x, y, r)) return true;
    if (W.nextDoor && W.nextDoor.blocks(x, y, r)) return true;
    return false;
  };

  /* somewhere with line of sight to the road but not on top of the player */
  W.freeSpot = function (rng, awayFromX, awayFromY, minD, x0, x1) {
    x0 = (x0 === undefined) ? 2 : x0;
    x1 = (x1 === undefined) ? GATE_X - 1 : x1;
    for (var i = 0; i < 60; i++) {
      var x = x0 + rng.f() * (x1 - x0);
      var y = 3 + rng.f() * (W.gh - 7);
      if (W.solidAt(x, y) || W.isDeep(x, y)) continue;
      if (M.dist2(x, y, awayFromX, awayFromY) < minD * minD) continue;
      return { x: x, y: y };
    }
    return null;
  };

  W.GATE_X = GATE_X;
  W.TARGET_DOOR = 62;
  S.World = W;
})(SALT);
