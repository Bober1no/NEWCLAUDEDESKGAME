/* SALT LINE — the run.
 *
 * Owns the player, the entities, the tolls and the two endings. The whole
 * simulation is deterministic per tick and never touches the renderer, which
 * is what lets DROWNED cost 45ms a frame without changing how anything
 * behaves.
 */
(function (S) {
  'use strict';

  var M = S.M, K = S.K, CELL = S.CELL;
  var N = S.Name, W = S.World, T = S.Tide;

  var G = {
    mode: 'title',
    prevMode: 'title',
    t: 0,
    runT: 0,
    seed: 1,

    player: {
      x: 3, y: 17, ang: 0,
      speed: 0, turnRate: 0,
      vx: 0, vy: 0,
      lampOn: true, lampPower: 1, lampFlicker: 1, lampFlickerDelayed: 1,
      walkPhase: 0, bob: 0, crouch: 0,
      wet: false, disturbance: 0,
      pitch: 0, roll: 0,
      shoveX: 0, shoveY: 0,
      lastStepPhase: 0
    },

    entities: [],
    pending: [],
    hint: null,
    focus: null,
    reading: null,
    robbed: 0,
    choir: false,
    lampDesync: 0,
    tallyMarkText: null,
    haveTarget: false,
    targetName: '',
    ending: null,
    doorsPassed: 0,
    tension: 0,
    deathT: 0,
    introT: 0,
    best: null
  };

  /* ---- lifecycle --------------------------------------------------------- */
  G.newRun = function (name, seed) {
    G.seed = (seed || ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
    N.set(name);
    W.init(G.seed, 1);
    S.Director.reset();

    var p = G.player;
    p.x = 3.2; p.y = W.entryY + 1; p.ang = 0;
    p.lampOn = true; p.lampPower = 1;
    p.speed = 0; p.turnRate = 0; p.disturbance = 0;
    p.walkPhase = 0; p.pitch = 0; p.roll = 0; p.crouch = 0;
    p.shoveX = 0; p.shoveY = 0;

    G.entities = [];
    G.pending = [];
    G.hint = null;
    G.focus = null;
    G.reading = null;
    G.robbed = 0;
    G.choir = false;
    G.lampDesync = 0;
    G.tallyMarkText = null;
    G.haveTarget = false;
    G.ending = null;
    G.doorsPassed = 0;
    G.runT = 0;
    G.introT = 0;
    G.deathT = 0;

    T.reset(1);
    S.PostFX.pressure = 0;
    S.PostFX.invert = 0;
    G.planSection();
    G.mode = 'play';
    /* stays up until the first gate is actually paid */
    G.hint = { text: 'FIND THE LAMP ON THE GATE. WALK TO IT.', t: 0, dur: 9999, pri: 1 };
  };

  G.planSection = function () {
    var rng = M.rng((G.seed ^ (W.doorNum * 0x27d4eb2f)) >>> 0);
    var plan = S.Director.plan(W.doorNum, G, rng);
    G.pending = plan.spawns.slice();
    G.nextPlan = S.Director.plan(W.doorNum + 1, G, M.rng((G.seed ^ ((W.doorNum + 1) * 0x27d4eb2f)) >>> 0));
    if (plan.tideRush) { T.enabled = true; T.limit = 26; T.t = 0; }
    G.tallyMarkText = null;
  };

  /* ---- helpers the entities call ------------------------------------------ */
  G.ownRemaining = function () { return N.ownRemaining(); };
  G.ownLength = function () { return N.ownLength(); };

  G.say = function (text, dur, priority) {
    if (G.hint && G.hint.t < G.hint.dur && (G.hint.pri || 0) > (priority || 0)) return;
    if (G.hint && G.hint.text === text) { G.hint.t = 0; return; }
    G.hint = { text: text, t: 0, dur: dur || 3, pri: priority || 0 };
  };

  G.spend = function (n, reason) {
    if (n <= 0) return 0;
    var ownCost = N.spend(n);
    for (var i = 0; i < n; i++) {
      (function (d, own) {
        setTimeout(function () { S.Sound.spendLetter(own); }, d);
      })(i * 90, i >= (n - ownCost));
    }
    if (reason) G.say(reason, 3.2, 2);
    S.PostFX.flash = Math.min(1, 0.16 + n * 0.06);
    if (ownCost > 0) {
      S.PostFX.pressure = Math.min(1, S.PostFX.pressure + 0.35);
      S.Music.setRoot(Math.max(28, 55 - N.erosion() * 24));
    }
    if (N.ownRemaining() === 0) G.finish('filed');
    return ownCost;
  };

  G.shove = function (ang, force) {
    var p = G.player;
    p.shoveX += Math.cos(ang) * force;
    p.shoveY += Math.sin(ang) * force;
  };

  /* the Comber breaks over the pans. crust is raised; salt stacks split it. */
  G.onHighGround = function () {
    var p = G.player;
    if (!W.isWet(p.x, p.y)) return true;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var cx = (p.x | 0) + dx, cy = (p.y | 0) + dy;
        if (W.solidAt(cx + 0.5, cy + 0.5)) {
          var nx = M.clamp(p.x, cx, cx + 1), ny = M.clamp(p.y, cy, cy + 1);
          if (M.dist(p.x, p.y, nx, ny) < 1.15) return true;
        }
      }
    }
    return false;
  };

  G.tallyMark = function () {
    G.tallyMarkText = S.Director.markFor(G.nextPlan ? G.nextPlan.spawns : null);
    G.say('IT SCRATCHED: ' + G.tallyMarkText, 6, 3);
  };

  G.takenByUnderstudy = function () { G.finish('taken'); };

  G.finish = function (kind) {
    if (G.ending) return;
    G.ending = kind;
    G.mode = (kind === 'out') ? 'win' : 'dead';
    G.deathT = 0;
    S.Music.setTension(kind === 'out' ? 0.1 : 1);
    S.Sound.stopBeds();
    S.Sound.choirStop();
    G.saveBest();
  };

  /* ---- persistence (file:// may refuse it; that is fine) ------------------ */
  G.saveBest = function () {
    try {
      var rec = {
        door: W.doorNum, name: N.raw, own: N.ownRemaining(),
        robbed: G.robbed, ending: G.ending, t: Math.round(G.runT)
      };
      var prev = G.loadBest();
      if (!prev || rec.door > prev.door) {
        window.localStorage.setItem('saltline.best', JSON.stringify(rec));
      }
    } catch (e) {}
  };

  G.loadBest = function () {
    try {
      var s = window.localStorage.getItem('saltline.best');
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  };

  /* ---- the tick ----------------------------------------------------------- */
  G.update = function (dt) {
    G.t += dt;
    if (G.mode !== 'play' && G.mode !== 'read') {
      if (G.mode === 'dead' || G.mode === 'win') G.deathT += dt;
      N.updateCrumbs(dt);
      return;
    }

    G.runT += dt;
    G.introT += dt;
    var p = G.player;

    G.lampDesync = Math.max(0, G.lampDesync - dt * 0.8);
    G.choir = false;

    if (G.mode === 'read') {
      /* The tide does not wait while you read a stranger's name, and neither
       * does anything else out there. Reading is not a pause. */
      if (S.Input.hit('use') && G.reading) G.takeFromMarker(G.reading);
      G.updateLamp(dt);
      G.updateEntities(dt);
      G.updateTide(dt);
      N.updateCrumbs(dt);
      G.updateHint(dt);
      return;
    }

    G.movement(dt);
    G.updateLamp(dt);
    G.interact(dt);
    G.updateEntities(dt);
    G.updateTide(dt);
    G.checkAdvance();
    N.updateCrumbs(dt);
    G.updateHint(dt);
    G.updateTension(dt);
  };

  G.updateHint = function (dt) {
    if (G.hint) {
      G.hint.t += dt;
      if (G.hint.t > G.hint.dur + 0.8) G.hint = null;
    }
  };

  /* ---- movement ----------------------------------------------------------- */
  G.movement = function (dt) {
    var In = S.Input, p = G.player;

    var turn = 0;
    if (In.held('turnL')) turn -= 1;
    if (In.held('turnR')) turn += 1;
    var dAng = turn * K.TURN * dt + In.mdx * K.MOUSE;
    In.mdx = 0;
    p.ang += dAng;
    p.turnRate = dAng / dt;
    /* the head lags the turn: a small counter-roll that settles */
    p.roll = M.lerp(p.roll, -M.clamp(p.turnRate * 0.10, -1.5, 1.5), 1 - Math.exp(-dt * 7));

    var mx = 0, my = 0;
    if (In.held('fwd')) mx += 1;
    if (In.held('back')) mx -= 0.72;
    if (In.held('left')) my -= 1;
    if (In.held('right')) my += 1;

    var holding = In.held('hold');
    p.crouch = M.lerp(p.crouch, holding ? 1 : 0, 1 - Math.exp(-dt * 8));
    if (holding) { mx = 0; my = 0; }

    var len = Math.sqrt(mx * mx + my * my);
    if (len > 1) { mx /= len; my /= len; }

    p.wet = W.isWet(p.x, p.y);
    var base = p.wet ? K.WADE : K.WALK;
    if (W.isDeep(p.x, p.y)) base *= 0.55;

    var dx = (Math.cos(p.ang) * mx - Math.sin(p.ang) * my) * base;
    var dy = (Math.sin(p.ang) * mx + Math.cos(p.ang) * my) * base;

    /* shove decays fast; it is a stagger, not knockback */
    dx += p.shoveX; dy += p.shoveY;
    p.shoveX *= Math.exp(-dt * 6); p.shoveY *= Math.exp(-dt * 6);
    if (Math.abs(p.shoveX) < 0.02) p.shoveX = 0;
    if (Math.abs(p.shoveY) < 0.02) p.shoveY = 0;

    var nx = p.x + dx * dt, ny = p.y + dy * dt;
    if (!W.blocked(nx, p.y, K.RADIUS)) p.x = nx;
    if (!W.blocked(p.x, ny, K.RADIUS)) p.y = ny;
    p.y = M.clamp(p.y, 2.3, W.gh - 2.3);

    var moved = Math.sqrt(dx * dx + dy * dy) * (len > 0 ? 1 : 0);
    p.speed = M.lerp(p.speed, moved, 1 - Math.exp(-dt * 14));

    /* the walk cycle drives footsteps, the bob, and the Understudy's copy */
    p.walkPhase += p.speed * dt * 3.15;
    if (p.walkPhase - p.lastStepPhase > Math.PI) {
      p.lastStepPhase = p.walkPhase;
      S.Sound.step(p.wet, !p.wet);
      if (p.wet) p.disturbance = Math.min(1.4, p.disturbance + 0.55);
    }
    p.bob = Math.sin(p.walkPhase * 2) * 0.017 * M.sat(p.speed);

    /* disturbance: what the Dragger reads. turning counts. */
    var stir = (p.wet ? p.speed * 0.85 : 0) + Math.abs(p.turnRate) * (p.wet ? 0.10 : 0);
    p.disturbance = Math.max(p.disturbance * Math.exp(-dt * (holding ? 4.2 : 1.5)), stir);

    p.pitch = M.lerp(p.pitch, -p.crouch * 6 + Math.sin(p.walkPhase * 2) * 1.6 * M.sat(p.speed), 1 - Math.exp(-dt * 9));
  };

  /* ---- the lamp ----------------------------------------------------------- */
  G.updateLamp = function (dt) {
    var In = S.Input, p = G.player;
    if (In.hit('lamp')) {
      p.lampOn = !p.lampOn;
      G.say(p.lampOn ? 'LAMP LIT' : 'LAMP OUT', 1.6, 0);
    }
    var target = p.lampOn ? 1 : 0;
    /* it does not snap. a wick takes a moment either way. */
    p.lampPower = M.lerp(p.lampPower, target, 1 - Math.exp(-dt * (p.lampOn ? 5.5 : 8)));

    var f = 0.86 + M.noise2(G.t * 5.5, 0.7) * 0.22 + M.noise2(G.t * 21, 3.1) * 0.06;
    /* while the Understudy is on the line your own flame stutters, and the
     * stutter comes back at you a beat late from further down the flat */
    if (G.lampDesync > 0.02) {
      f *= 1 - G.lampDesync * 0.28 * (0.5 + 0.5 * Math.sin(G.t * 7.3));
    }
    p.lampFlicker = f;
    p.lampFlickerDelayed = 0.86 + M.noise2((G.t - 0.55) * 5.5, 0.7) * 0.22;
  };

  /* ---- interaction --------------------------------------------------------- */
  G.interact = function (dt) {
    var In = S.Input, p = G.player;
    G.focus = null;

    /* markers first: they are what you have to leave the road for */
    var bestD = 2.3, best = null;
    for (var i = 0; i < W.props.length; i++) {
      var pr = W.props[i];
      if (pr.type !== 'marker') continue;
      var d = M.dist(pr.x, pr.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = pr; }
    }
    if (best) {
      var left = best.data.letters.length - best.data.taken;
      G.focus = {
        type: 'marker', obj: best,
        label: best.data.read
          ? (left > 0 ? 'TAKE A LETTER  [' + left + ' LEFT]' : 'NOTHING LEFT ON IT')
          : 'READ THE STONE'
      };
    }

    var door = W.door;
    if (door && door.inReach(p.x, p.y) && door.state === 'shut') {
      var cost = door.totalCost() * (G.choir ? 2 : 1);
      G.focus = {
        type: 'door', obj: door,
        label: 'PAY ' + cost + (cost === 1 ? ' LETTER' : ' LETTERS'),
        cost: cost
      };
    }

    if (In.hit('use') && G.focus) {
      if (G.focus.type === 'door') G.payDoor(G.focus.obj, G.focus.cost);
      else G.useMarker(G.focus.obj);
    }
  };

  G.payDoor = function (door, cost) {
    if (!N.canAfford(cost)) {
      G.say('YOU HAVE NOTHING TO CUT', 3, 2);
      S.Sound.doorLocked();
      S.PostFX.kick(1.2);
      return;
    }
    S.Sound.toll();
    G.spend(cost, null);
    door.open();
    if (G.hint && G.hint.dur > 900) G.hint = null;   /* the tutorial line has done its job */
    S.Sound.doorGroan();
    G.say(S.Ledger.legendAt(door.num) + ' COME THIS FAR', 4, 1);
  };

  G.useMarker = function (prop) {
    var d = prop.data;
    if (!d.read) {
      d.read = true;
      G.mode = 'read';
      G.reading = prop;
      T.spend(2.5);
      if (d.isTarget) {
        G.say('THIS IS THE ONE', 6, 4);
      }
      return;
    }
    G.mode = 'read';
    G.reading = prop;
    G.takeFromMarker(prop);
  };

  G.takeFromMarker = function (prop) {
    var d = prop.data;
    var left = d.letters.length - d.taken;
    if (left <= 0) { G.say('NOTHING LEFT ON IT', 2, 1); return; }
    var letter = d.letters[d.taken];
    d.taken++;
    d._plate = null;
    N.take(letter.ch, d.name);
    G.robbed++;
    S.Sound.takeLetter();
    S.PostFX.kick(0.5);
    if (d.isTarget) {
      if (d.taken >= d.letters.length) {
        G.haveTarget = true;
        G.targetName = d.name;
        G.say('YOU HAVE ALL OF THEM. GO BACK OUT.', 8, 5);
      }
    } else {
      G.say('YOU TOOK A LETTER OFF ' + d.name.split(' ')[0], 2.6, 1);
    }
  };

  G.closeReading = function () {
    G.reading = null;
    if (G.mode === 'read') G.mode = 'play';
  };

  /* ---- entities ------------------------------------------------------------ */
  G.updateEntities = function (dt) {
    var ctx = { p: G.player, world: W, game: G, audio: S.Sound };

    for (var i = 0; i < G.pending.length; i++) {
      var s = G.pending[i];
      s.delay -= dt;
      if (s.delay <= 0) { G.spawn(s.type); G.pending.splice(i, 1); i--; }
    }

    var draggerActive = false, understudyHere = false;
    for (var j = G.entities.length - 1; j >= 0; j--) {
      var e = G.entities[j];
      e.update(dt, ctx);
      if (e.kind === 'dragger' && e.state === 'hunt') draggerActive = true;
      if (e.kind === 'understudy') understudyHere = true;
      if (e.dead) G.entities.splice(j, 1);
    }
    if (!draggerActive) S.Sound.draggerQuiet();
    if (!understudyHere) G.lampDesync = 0;
  };

  G.spawn = function (type) {
    var p = G.player, rng = M.rng((G.seed * 7 + W.doorNum * 31 + G.entities.length) >>> 0);
    var spot;
    switch (type) {
      case 'tally':
        spot = W.freeSpot(rng, p.x, p.y, 7, Math.min(W.GATE_X - 3, p.x + 5), W.GATE_X - 2);
        if (spot) G.entities.push(new S.Tally(spot.x, spot.y));
        break;
      case 'assessor':
        if (W.door) G.entities.push(new S.Assessor(W.door));
        break;
      case 'dragger':
        spot = G.wetSpot(rng, p.x, p.y, 8);
        if (spot) G.entities.push(new S.Dragger(spot.x, spot.y));
        break;
      case 'choir':
        G.entities.push(new S.Choir(28 + rng.f() * 14));
        break;
      case 'understudy': {
        var gap = 15 + rng.f() * 5;
        var ang = rng.range(-0.7, 0.7);
        G.entities.push(new S.Understudy(
          p.x + Math.cos(ang) * gap, M.clamp(p.y + Math.sin(ang) * gap, 3, W.gh - 3), gap));
        break;
      }
    }
  };

  G.wetSpot = function (rng, ax, ay, minD) {
    for (var i = 0; i < 90; i++) {
      var x = 2 + rng.f() * (W.GATE_X - 3);
      var y = 3 + rng.f() * (W.gh - 7);
      if (!W.isWet(x, y) || W.solidAt(x, y)) continue;
      if (M.dist2(x, y, ax, ay) < minD * minD) continue;
      return { x: x, y: y };
    }
    return null;
  };

  /* ---- tide ---------------------------------------------------------------- */
  G.updateTide = function (dt) {
    var fired = T.update(dt);
    S.Sound.tideDraw(T.draw);
    if (T.draw > 0.06) {
      G.say('THE WATER IS GOING OUT', 1.2, 1);
    }
    if (fired) {
      G.entities.push(new S.Comber(W.GATE_X + 4));
      G.say('GET OUT OF THE WATER', 3.4, 5);
    }
  };

  /* ---- crossing ------------------------------------------------------------ */
  G.checkAdvance = function () {
    var p = G.player;
    if (W.door) W.door.update(S.K.SIM_DT);
    if (W.nextDoor) W.nextDoor.update(S.K.SIM_DT);

    if (p.x < K.CHUNK_W + 1.6) return;

    if (W.doorNum >= K.MAX_DOORS) { G.finish('out'); return; }

    var carried = [];
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      if (e.kind === 'understudy' || e.kind === 'choir') {
        e.x -= K.CHUNK_W;
        if (e.anchorX !== undefined) e.anchorX -= K.CHUNK_W;
        carried.push(e);
      }
    }
    G.entities = carried;

    p.x -= K.CHUNK_W;
    W.advance();
    G.doorsPassed++;
    T.reset(W.doorNum);
    G.planSection();

    if (W.doorNum === 62 && !G.haveTarget) {
      G.say('THE STONE YOU CAME FOR IS IN THIS ONE', 7, 4);
    }
  };

  /* ---- tension (drives the drone) ------------------------------------------ */
  G.updateTension = function (dt) {
    var t = 0;
    t += N.erosion() * 0.45;
    t += M.sat(W.doorNum / K.MAX_DOORS) * 0.25;
    for (var i = 0; i < G.entities.length; i++) {
      var e = G.entities[i];
      var d = M.dist(e.x, e.y, G.player.x, G.player.y);
      if (e.kind === 'choir') { t += 0.18; continue; }
      if (e.kind === 'comber') { t += 0.55; continue; }
      if (d < 12) t += (1 - d / 12) * (e.kind === 'understudy' ? 0.55 : 0.28);
    }
    t += T.draw * 0.5;
    G.tension = M.lerp(G.tension, M.sat(t), 1 - Math.exp(-dt * 1.6));
    S.Music.setTension(G.tension);

    S.PostFX.pressure = Math.max(
      S.PostFX.pressure * Math.exp(-dt * 0.9),
      N.erosion() * 0.34 + G.tension * 0.20
    );
  };

  S.Game = G;
})(SALT);
