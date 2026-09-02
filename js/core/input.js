/* SALT LINE — input.
 *
 * Mouse-look via pointer lock, with keyboard turning as a first-class equal
 * rather than a fallback: pointer lock on file:// is inconsistent enough that
 * the game has to be fully playable without it.
 *
 * Also owns the carved text-entry mode used when you write your name.
 */
(function (S) {
  'use strict';

  var Input = {
    down: Object.create(null),
    pressed: Object.create(null),
    released: Object.create(null),
    mdx: 0,
    mdy: 0,
    locked: false,
    lockWanted: false,
    /* text capture */
    capturing: false,
    buffer: '',
    maxBuffer: 14,
    submitted: false,
    canceled: false,
    el: null,
    anyKeyThisFrame: false
  };

  var CODEMAP = {
    'KeyW': 'fwd', 'ArrowUp': 'fwd',
    'KeyS': 'back', 'ArrowDown': 'back',
    'KeyA': 'left', 'KeyD': 'right',
    'ArrowLeft': 'turnL', 'ArrowRight': 'turnR',
    'KeyQ': 'turnL', 'KeyE': 'turnR',
    'KeyF': 'lamp',
    'ShiftLeft': 'hold', 'ShiftRight': 'hold',
    'Space': 'use', 'KeyR': 'use',
    'Escape': 'menu',
    'Tab': 'ledger',
    'Enter': 'enter',
    'Digit1': 'q1', 'Digit2': 'q2', 'Digit3': 'q3'
  };

  Input.attach = function (el) {
    Input.el = el;

    window.addEventListener('keydown', function (e) {
      if (Input.capturing) {
        Input._typeKey(e);
        e.preventDefault();
        return;
      }
      var a = CODEMAP[e.code];
      /* keep browser shortcuts alive, swallow the game's own keys */
      if (a || e.code === 'Escape' || e.code === 'Tab') e.preventDefault();
      Input.anyKeyThisFrame = true;
      if (!a) return;
      if (!Input.down[a]) Input.pressed[a] = true;
      Input.down[a] = true;
    }, false);

    window.addEventListener('keyup', function (e) {
      var a = CODEMAP[e.code];
      if (!a) return;
      Input.down[a] = false;
      Input.released[a] = true;
    }, false);

    window.addEventListener('blur', function () {
      for (var k in Input.down) Input.down[k] = false;
      Input.mdx = 0; Input.mdy = 0;
    }, false);

    el.addEventListener('mousedown', function (e) {
      Input.anyKeyThisFrame = true;
      if (e.button === 0) {
        if (Input.lockWanted && !Input.locked) Input.requestLock();
        if (!Input.down.use) Input.pressed.use = true;
        Input.down.use = true;
      }
    }, false);

    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) { Input.down.use = false; Input.released.use = true; }
    }, false);

    document.addEventListener('mousemove', function (e) {
      if (Input.locked) {
        Input.mdx += e.movementX || 0;
        Input.mdy += e.movementY || 0;
      }
    }, false);

    document.addEventListener('pointerlockchange', function () {
      Input.locked = (document.pointerLockElement === el);
    }, false);

    document.addEventListener('pointerlockerror', function () {
      /* file:// sometimes refuses. keyboard turning covers it. */
      Input.locked = false;
      Input.lockWanted = false;
    }, false);

    el.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);
  };

  Input.requestLock = function () {
    if (!Input.el || Input.locked) return;
    try {
      var p = Input.el.requestPointerLock();
      if (p && p.catch) p.catch(function () { Input.lockWanted = false; });
    } catch (err) { Input.lockWanted = false; }
  };

  Input.releaseLock = function () {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  };

  /* consume per-frame edges. call at end of a sim frame. */
  Input.endFrame = function () {
    Input.pressed = Object.create(null);
    Input.released = Object.create(null);
    Input.mdx = 0;
    Input.mdy = 0;
    Input.submitted = false;
    Input.canceled = false;
    Input.anyKeyThisFrame = false;
  };

  Input.hit = function (a) { return !!Input.pressed[a]; };
  Input.held = function (a) { return !!Input.down[a]; };

  /* ---- carved text entry ---------------------------------------------- */
  var ALLOWED = /^[A-Za-z' -]$/;

  Input.beginCapture = function (initial, max) {
    Input.capturing = true;
    Input.buffer = (initial || '').toUpperCase();
    Input.maxBuffer = max || 14;
    Input.submitted = false;
    Input.canceled = false;
  };

  Input.endCapture = function () {
    Input.capturing = false;
    return Input.buffer;
  };

  Input._typeKey = function (e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { Input.submitted = true; return; }
    if (e.code === 'Escape') { Input.canceled = true; return; }
    if (e.code === 'Backspace') { Input.buffer = Input.buffer.slice(0, -1); return; }
    var ch = e.key;
    if (ch && ch.length === 1 && ALLOWED.test(ch)) {
      if (Input.buffer.length < Input.maxBuffer) Input.buffer += ch.toUpperCase();
    }
  };

  S.Input = Input;
})(SALT);
