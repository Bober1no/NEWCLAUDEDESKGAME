/* SALT LINE — the threshold.
 *
 * A doorframe standing in the one gap in a levee. Posts, lintel and panel are
 * all world-space slabs, so the swing has real perspective: the panel gets
 * wider and then foreshortens as it goes, and its shadow side turns away from
 * your lamp. Nothing here is a sprite.
 *
 * The ledger number is cut into the panel itself. It is the last thing you
 * read before you pay, and once you pay it swings away from you.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K;

  var HALF_GAP = 0.95;
  var PANEL_W = 1.72;
  var PANEL_H = 2.06;
  var LINTEL_Z0 = 2.08, LINTEL_Z1 = 2.36;
  var POST_W = 0.15;
  var OPEN_ANGLE = 1.78;

  Door._t = 0;

  function Door(num, x, y) {
    this.num = num;
    this.x = x;
    this.y = y;
    this.gapY = y - 1.0;
    this.ledger = S.Ledger.at(num);
    this.toll = S.Ledger.tollAt(num);
    this.surcharge = 0;          /* set by the Assessor */
    this.swing = 0;              /* 0 shut, 1 wide open */
    this.state = 'shut';
    this.opened = false;
    this.plate = S.Glyphs.plate(String(this.ledger), 4, 2);
    this.rattle = 0;
    this.hinge = 0;

    /* Every gate carries a lamp on its lintel, and it is a dead cold white --
     * the works hung them, and nothing out here has bothered to take them
     * down. It is the only navigation aid in the game: your own lamp reaches
     * twelve metres and a section is twenty-six, so without this you are
     * walking into a black flat with no idea which way forward is.
     *
     * It also does a second job. Yours is warm and so is the Understudy's. A
     * cold light is a gate. A warm light that is not in your hand is not. */
    this.lampZ = 1.86;
    this.lampFlick = 1;
  }

  Door.prototype.totalCost = function () { return this.toll + this.surcharge; };

  Door.prototype.open = function () {
    if (this.state !== 'shut') return false;
    this.state = 'swinging';
    this.opened = true;
    return true;
  };

  /* Swing it back. Only the walk-out uses this: the last gate shuts behind
   * you so that the number cut into its panel is facing you again when it
   * changes. */
  Door.prototype.shutAgain = function () {
    if (this.state === 'shut' || this.state === 'closing') return;
    this.state = 'closing';
  };

  Door.prototype.update = function (dt) {
    /* a slow, tired guttering -- these have been burning a long time */
    var t = this.num * 7.3 + (Door._t += dt);
    this.lampFlick = 0.82 + S.M.noise2(t * 1.9, this.num * 3.1) * 0.30
                          + S.M.noise2(t * 9.0, this.num) * 0.07;

    if (this.state === 'swinging') {
      /* heavy, and it fights you at the start. eases out, never eases in. */
      this.swing += dt * (0.35 + this.swing * 1.55);
      if (this.swing >= 1) { this.swing = 1; this.state = 'open'; }
    }
    if (this.state === 'closing') {
      this.swing -= dt * (0.30 + this.swing * 1.15);
      if (this.swing <= 0) { this.swing = 0; this.state = 'shut'; this.rattle = 1; }
    }
    this.rattle *= Math.exp(-dt * 6);
  };

  Door.prototype.angle = function () {
    var t = this.swing;
    /* overshoot slightly and settle: the panel is a heavy thing on old iron */
    var e = 1 - Math.pow(1 - t, 3);
    var over = Math.sin(t * Math.PI) * 0.11 * (1 - t);
    return (e + over) * OPEN_ANGLE + this.rattle * 0.05;
  };

  Door.prototype.panelEnd = function (out) {
    var a = this.angle();
    var hx = this.x, hy = this.y - HALF_GAP;
    out[0] = hx; out[1] = hy;
    out[2] = hx + Math.sin(a) * PANEL_W;
    out[3] = hy + Math.cos(a) * PANEL_W;
  };

  var _pe = [0, 0, 0, 0];

  Door.prototype.blocks = function (px, py, r) {
    if (this.state === 'open') return false;
    if (this.swing > 0.42) return false;
    /* while it is shut the panel is a wall across the gap */
    this.panelEnd(_pe);
    return segCircle(_pe[0], _pe[1], _pe[2], _pe[3], px, py, r + 0.06);
  };

  function segCircle(ax, ay, bx, by, px, py, r) {
    var dx = bx - ax, dy = by - ay;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = M.clamp(t, 0, 1);
    var cx = ax + dx * t, cy = ay + dy * t;
    var ex = px - cx, ey = py - cy;
    return ex * ex + ey * ey < r * r;
  }

  /* how close you have to be to pay it */
  Door.prototype.inReach = function (px, py) {
    var dx = px - this.x, dy = py - this.y;
    return (dx * dx + dy * dy) < 3.4 && dx < 0.6;
  };

  /* ---- drawing ----------------------------------------------------------- */

  /* a square post, drawn as two crossed slabs so it has thickness from any
   * angle without a real mesh */
  function post(fb, x, y, w, h0, h1, shadeFn) {
    var R = S.Ray;
    R.slab(fb, x - w, y, x + w, y, h0, h1, shadeFn);
    R.slab(fb, x, y - w, x, y + w, h0, h1, shadeFn);
  }
  Door.post = post;

  var woodShade = function (t, z, dist, out) {
    /* old salt-soaked timber: horizontal grain, dark between the boards */
    var band = z * 5.2;
    var f = band - Math.floor(band);
    var v = 0.52 + S.M.noise2(t * 9, z * 21) * 0.34;
    if (f < 0.10) v *= 0.44;
    if (t < 0.03 || t > 0.97) v *= 0.5;
    out[0] = v; out[1] = 0;
  };

  var stoneShade = function (t, z, dist, out) {
    var v = 0.40 + S.M.ridge(t * 7, z * 7, 2) * 0.44;
    out[0] = v; out[1] = 0;
  };

  Door.prototype.render = function (fb, tier, lampNear) {
    var R = S.Ray;
    var self = this;
    var x = this.x, y = this.y;

    /* posts */
    post(fb, x, y - HALF_GAP - 0.06, POST_W, 0, LINTEL_Z1, stoneShade);
    post(fb, x, y + HALF_GAP + 0.06, POST_W, 0, LINTEL_Z1, stoneShade);

    /* lintel, two leaves for thickness */
    R.slab(fb, x - 0.07, y - HALF_GAP - 0.2, x - 0.07, y + HALF_GAP + 0.2,
      LINTEL_Z0, LINTEL_Z1, stoneShade);
    R.slab(fb, x + 0.07, y - HALF_GAP - 0.2, x + 0.07, y + HALF_GAP + 0.2,
      LINTEL_Z0, LINTEL_Z1, stoneShade);

    /* the panel, carrying its number */
    if (this.swing < 0.999) {
      this.panelEnd(_pe);
      var plate = this.plate;
      var pw = plate.w, ph = plate.h, bits = plate.bits;
      var swing = this.swing;

      /* The ledger number, cut into the boards. It is the single most
       * important thing on the screen when you are standing at a gate, so the
       * cut goes almost black and the upper lip of it goes almost white -- it
       * has to survive being read at eight metres in the dark.
       *
       * It is cut on BOTH faces. A count of who has been through belongs to
       * the gate, not to one approach, and the walk-out ending has you turned
       * round looking at the back of the last door while its number changes.
       * Only carving the front made that ending a blank plank. */
      function cutNumber(u, vv, v) {
        if (u < 0 || u >= 1 || vv < 0 || vv >= 1) return v;
        var bxp = (u * pw) | 0, byp = (vv * ph) | 0;
        if (bits[byp * pw + bxp]) return v * 0.16;
        var lx = ((u * pw) - 1) | 0, ly = ((vv * ph) - 1) | 0;
        if (lx >= 0 && ly >= 0 && bits[ly * pw + lx]) return Math.min(1.25, v * 2.1);
        return v;
      }

      var panelShade = function (t, z, dist, out) {
        var band = z * 4.6;
        var f = band - Math.floor(band);
        var v = 0.52 + S.M.noise2(t * 11 + self.num, z * 17) * 0.30;
        if (f < 0.11) v *= 0.40;
        if (t < 0.035 || t > 0.965 || z < 0.05 || z > PANEL_H - 0.05) v *= 0.52;
        out[0] = cutNumber((t - 0.09) / 0.82, (1.56 - z) / 0.76, v);
        out[1] = 0;
      };

      R.slab(fb, _pe[0], _pe[1], _pe[2], _pe[3], 0.02, PANEL_H, panelShade);
      /* Back face, a hair behind the numbered one, so an open door still has
       * a panel from the far side instead of vanishing edge-on. The offset
       * has to go away from the approach or it covers the number. */
      var nx = (_pe[3] - _pe[1]), ny = -(_pe[2] - _pe[0]);
      var nl = Math.sqrt(nx * nx + ny * ny) || 1;
      nx = nx / nl * 0.055; ny = ny / nl * 0.055;
      R.slab(fb, _pe[0] + nx, _pe[1] + ny, _pe[2] + nx, _pe[3] + ny, 0.02, PANEL_H,
        function (t, z, dist, out) {
          var v = 0.34 + S.M.noise2(t * 9, z * 15) * 0.24;
          var band = z * 4.6; var f = band - Math.floor(band);
          if (f < 0.11) v *= 0.45;
          /* mirrored in u, so it reads the right way round from behind */
          out[0] = cutNumber(1 - (t - 0.09) / 0.82, (1.56 - z) / 0.76, v);
          out[1] = 0;
        });
    }

    /* the threshold stone you cut your letter into */
    R.slab(fb, x - 0.34, y - 0.62, x - 0.34, y + 0.62, 0, 0.10, stoneShade);

    /* the lamp on the lintel: a small housing and, inside it, the one thing
     * on this flat you can see from the far end of a section */
    var flick = this.lampFlick;
    var housing = function (t, z, dist, out) {
      out[0] = 0.18; out[1] = 0; out[2] = 0;
    };
    var glass = function (t, z, dist, out) {
      /* The pane, with a soot-black frame round it so it has a shape rather
       * than being a blob. The flame is pushed well over 1.0 on purpose: it
       * has to clear the top of the ramp at twenty-five metres or the ordered
       * dither thins it to nothing and the only landmark in the game
       * disappears exactly when you need it. Over 1.0 it also clears the
       * bloom threshold, which is what gives it a halo from far off. */
      var edge = (t < 0.16 || t > 0.84 || z < 1.86 || z > 2.10);
      if (edge) { out[0] = 0.11; out[1] = 0; out[2] = 0.04 * flick; return; }
      out[0] = 0; out[1] = 0;
      out[2] = (1.35 + S.M.noise2(t * 6, z * 6 + Door._t * 3) * 0.30) * flick;
    };

    post(fb, x, y, 0.075, 2.10, LINTEL_Z0, housing);
    var gw = 0.17;
    R.slab(fb, x - 0.10, y - gw, x - 0.10, y + gw, 1.80, 2.14, glass);
    R.slab(fb, x + 0.10, y - gw, x + 0.10, y + gw, 1.80, 2.14, glass);
    R.slab(fb, x - 0.10, y - gw, x + 0.10, y - gw, 1.80, 2.14, glass);
    R.slab(fb, x - 0.10, y + gw, x + 0.10, y + gw, 1.80, 2.14, glass);
  };

  S.Door = Door;
})(SALT);
