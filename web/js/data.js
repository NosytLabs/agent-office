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
  {id:"forest",  name:"Forest",     bg:"#0e1a14", tileA:"#1c2e22", tileB:"#16241b", wall:"#2a3a2a"},
  {id:"ocean",   name:"Ocean",      bg:"#03133a", tileA:"#0e2a5a", tileB:"#08204a", wall:"#2058a8"},
];

const LAYOUTS = [
  {id:"open",    name:"Open floor", hint:"default",                    require:null},
  {id:"bullpen", name:"Bullpen",    hint:"10 sessions ever",            require:"layout_bullpen"},
  {id:"lounge",  name:"Lounge",     hint:"3+ runtimes ever",            require:"layout_lounge"},
  {id:"library", name:"Library",    hint:"25 reads",                    require:"layout_library"},
];

const LAYOUT_GEOMETRY = {
  open:      {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"rug",
              floor:["#2c2438","#262033"], wall:"#3a2f4b"},
  bullpen:   {perRow:5, colStep:30, rowStep:30, labelY:14, decor:"bullpen",
              floor:["#2a2a34","#24242e"], wall:"#34384a"},
  lounge:    {perRow:3, colStep:42, rowStep:40, labelY:14, decor:"lounge",
              floor:["#243030","#1e2828"], wall:"#2f4a42", warm:true},
  library:   {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"library",
              floor:["#302a20","#2a241a"], wall:"#4a3a22", warm:true},
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
