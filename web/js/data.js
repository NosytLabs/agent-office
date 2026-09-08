/* Agent Office — static data: themes, layouts, platforms, badges.
   Pure constants, no DOM access. */
"use strict";

const RANKS = [
  ["intern", 0],
  ["junior", 40],
  ["staff", 150],
  ["principal", 400],
  ["distinguished", 1200],
];
const RANKS_THRESHOLDS = Object.fromEntries(RANKS);

const THEMES = [
  {id:"default", name:"Default",   bg:"#121018", tileA:"#2c2438", tileB:"#262033", wall:"#3a2f4b"},
  {id:"midnight",name:"Midnight",   bg:"#08080f", tileA:"#101226", tileB:"#0a0c1e", wall:"#1e2a52"},
  // retired (kept for saved-settings fallback): forest, ocean
];

const LAYOUTS = [
  {id:"open",    name:"Open floor", hint:"default",                    require:null},
  {id:"bullpen", name:"Bullpen",    hint:"10 sessions ever",            require:"layout_bullpen"},
  // retired (kept unlocked backend-side for compat): lounge, library
];

const LAYOUT_GEOMETRY = {
  open:      {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"rug",
              floor:["#2c2438","#262033"], wall:"#3a2f4b"},
  bullpen:   {perRow:5, colStep:30, rowStep:30, labelY:14, decor:"bullpen",
              floor:["#2a2a34","#24242e"], wall:"#34384a"},
  // legacy geometry fallbacks so old saved settings never crash render
  lounge:    {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"rug",
              floor:["#2c2438","#262033"], wall:"#3a2f4b"},
  library:   {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"rug",
              floor:["#2c2438","#262033"], wall:"#3a2f4b"},
  // unknown ids fall back to open-floor geometry (see office.js seatPos/render)
  };

const PLATFORMS = [
  {id:"hermes",   name:"Hermes",      icon:"hermes",   what:"This machine's AI agent"
  },
  {id:"opencode", name:"OpenCode",    icon:"opencode", what:"Terminal-first coding CLI from SST"
  },
  {id:"claude",   name:"Claude Code", icon:"claude",   what:"Anthropic's CLI coding agent"
  },
  {id:"telegram", name:"Telegram",    icon:"telegram", what:"Hermes bridge to your phone via Telegram"
  },
  {id:"cli",      name:"CLI / cron",  icon:"cli",      what:"Plain command-line sessions and cron jobs"
  },
];

const SHORTCUTS = [
  ["R","roster"],["U","usage"],["B","badges"],["L","layout"],
  ["S","settings"],["D","dbg (raw state)"],["E","live events"],
  ["?","legend"],["T","theme"],["N","day/night"],["F","fog"],
];

window.OFFICE_DATA = {RANKS, RANKS_THRESHOLDS, THEMES, LAYOUTS, LAYOUT_GEOMETRY, PLATFORMS, SHORTCUTS};
