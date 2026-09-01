/* SALT LINE — namespace, constants, quality tiers.
 * Loaded first. Everything else hangs off the global SALT object.
 */
var SALT = (typeof SALT !== 'undefined') ? SALT : {};

SALT.TITLE = 'SALT LINE';

/* ---- the palette. six greys and one ember. nothing else is ever drawn. ---- */
SALT.PALETTE = {
  /* luminance ramp, darkest -> lightest */
  ramp: [
    [0x05, 0x07, 0x0b],   /* the deep        */
    [0x0f, 0x16, 0x20],   /* brine shadow    */
    [0x2b, 0x3a, 0x46],   /* wet slate       */
    [0x55, 0x66, 0x6e],   /* half ash        */
    [0x7c, 0x8c, 0x93],   /* ash             */
    [0xd8, 0xdc, 0xd2],   /* salt bone       */
    [0xf3, 0xef, 0xe3]    /* hot salt        */
  ],
  ember: [0xb4, 0x46, 0x2a],
  emberHot: [0xe8, 0x93, 0x4a]
};

/* ---- world constants ---- */
SALT.K = {
  SIM_HZ: 60,
  SIM_DT: 1 / 60,

  CHUNK_W: 30,          /* cells along the line (X)     */
  CHUNK_H: 34,          /* cells across the flat (Y)    */
  GRID_W: 60,           /* two chunks live at once      */
  GRID_H: 34,

  EYE: 0.56,            /* camera height, world units   */
  FOV: 0.82,            /* tan of half the horizontal FOV */

  WALK: 2.35,           /* cells / second on dry crust  */
  WADE: 1.55,           /* cells / second in brine      */
  TURN: 2.6,            /* radians / second, key turn   */
  MOUSE: 0.0022,

  RADIUS: 0.26,         /* player collision radius      */

  MAX_DOORS: 66,
  LAST_DOOR_COST: 3,

  VIEW: 42.0            /* hard ray cutoff, cells       */
};

/* cell types in the terrain grid */
SALT.CELL = {
  BRINE: 0,   /* shallow standing water. loud. the Dragger lives here. */
  CRUST: 1,   /* dry salt. quiet. safe from the Comber if raised.      */
  DIKE:  2,   /* low wall, ~0.45 high. you see over it, you can climb. */
  STACK: 3,   /* stacked salt block wall, ~1.9 high. solid.            */
  PILE:  4,   /* heaped salt, ~0.9 high. solid.                        */
  DEEP:  5    /* a drowned pan. impassable, mirror-black.              */
};

SALT.SOLID = [false, false, true, true, true, true];
SALT.HEIGHT = [0, 0, 0.46, 1.95, 0.92, 0];

/* ---- quality tiers ---------------------------------------------------- */
/* Named for how much water the line is carrying. DROWNED is deliberately
 * untrimmed: it is not a performance target, it is the whole stack at once. */
SALT.TIERS = {
  DRY: {
    id: 'DRY', name: 'DRY SALT', order: 0,
    blurb: 'The line, cut back to bone. Coarse grain, one light, flat\nfalloff. It is a woodcut. It is meant to look like one.',
    w: 320, h: 180,
    bayer: 2,             /* dither matrix order          */
    bayerAnim: false,
    floorStep: 2,         /* floor pixels solved per 2px  */
    lights: 2,            /* yours, and the one on the gate */
    volumetric: 0,        /* raymarch steps, 0 = off      */
    volShift: 2,          /* haze buffer is w>>n by h>>n  */
    reflect: 0,           /* 0 none 1 flat 2 wave+depth   */
    bloom: 0,             /* passes                       */
    motes: 0,
    chroma: 0,
    scanline: 0,
    shimmer: false,
    grain: 0.045,
    subSteps: 1,          /* entity animation sub-steps   */
    motionBlur: 0,
    wallDetail: 1,        /* fbm octaves on salt surfaces */
    starCount: 90
  },
  WET: {
    id: 'WET', name: 'WET SALT', order: 1,
    blurb: 'The intended walk. Full grain, live light, the haze in the\nlamp cone, the flat holding a reflection.',
    w: 480, h: 270,
    bayer: 8,
    bayerAnim: false,
    floorStep: 1,
    lights: 4,
    volumetric: 12,
    volShift: 2,
    reflect: 1,
    bloom: 1,
    motes: 220,
    chroma: 0.85,
    scanline: 0.10,
    shimmer: false,
    grain: 0.055,
    subSteps: 2,
    motionBlur: 0,
    wallDetail: 2,
    starCount: 260
  },
  DROWNED: {
    id: 'DROWNED', name: 'DROWNED', order: 2,
    blurb: 'Everything the line carries, carried at once. This tier is not\ntrimmed for speed. It will run slow. That is the tier working.',
    w: 640, h: 360,
    bayer: 8,
    bayerAnim: true,
    floorStep: 1,
    lights: 12,
    volumetric: 26,
    volShift: 1,
    reflect: 2,
    bloom: 2,
    motes: 900,
    chroma: 1.7,
    scanline: 0.13,
    shimmer: true,
    grain: 0.06,
    subSteps: 4,
    motionBlur: 0.34,
    wallDetail: 3,
    starCount: 700
  }
};

SALT.TIER_ORDER = ['DRY', 'WET', 'DROWNED'];
SALT.DEFAULT_TIER = 'WET';
