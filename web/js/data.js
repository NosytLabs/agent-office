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
  {id:"default",  name:"Plum",     bg:"#121018", tileA:"#3a2d4a", tileB:"#241c32", wall:"#4a3a5c",
   panel:"#1a1423", line:"#3a2f4b", ink:"#cfc4e8"},
  {id:"midnight", name:"Midnight", bg:"#070b14", tileA:"#1a2448", tileB:"#0c1228", wall:"#243868",
   panel:"#0c1020", line:"#1e2a52", ink:"#c4cce8"},
  {id:"amber",    name:"Amber",    bg:"#16100a", tileA:"#5a4030", tileB:"#3a2818", wall:"#6a4a32",
   panel:"#241810", line:"#6a4a2a", ink:"#f0d8b0"},
];

const LAYOUTS = [
  {id:"open",    name:"Open floor", hint:"desks on a rug",              require:null},
  {id:"bullpen", name:"Bullpen",    hint:"10 sessions · cubicles",      require:"layout_bullpen"},
];

const LAYOUT_GEOMETRY = {
  open:    {perRow:3, colStep:38, rowStep:36, labelY:14, decor:"open",
            floor:["#3a2d4a","#241c32"], wall:"#4a3a5c"},
  bullpen: {perRow:4, colStep:32, rowStep:32, labelY:14, decor:"bullpen",
            floor:["#2a2a34","#1e1e28"], wall:"#34384a"},
};

const PLATFORMS = [
  {id:"hermes",   name:"Hermes",      icon:"hermes",   what:"This machine's AI agent"},
  {id:"opencode", name:"OpenCode",    icon:"opencode", what:"Terminal-first coding CLI from SST"},
  {id:"claude",   name:"Claude Code", icon:"claude",   what:"Anthropic's CLI coding agent"},
  {id:"telegram", name:"Telegram",    icon:"telegram", what:"Hermes bridge to your phone via Telegram"},
  {id:"cli",      name:"CLI / cron",  icon:"cli",      what:"Plain command-line sessions and cron jobs"},
];

const SHORTCUTS = [
  ["R","floor"],["U","floor"],["B","badges"],["L","settings · layout"],
  ["S","settings"],["E","live events"],["?","legend"],["T","theme"],["esc","close"],
];

const VISITOR_KINDS = [
  {id:"mail",    name:"mail carrier", sprite:"mail",    box:true,
   lines:["mail's here","big envelope today","sign here please"]},
  {id:"cleaner", name:"cleaner",      sprite:"cleaner",
   lines:["mopping around ya","mind the wet floor","nice plant"]},
  {id:"intern",  name:"intern",       sprite:"intern",
   lines:["coffee run!","first day nerves","which desk is mine?"]},
];

const DECOR_FILES = [
  "pets/claudio_idle.png","pets/gitcat_idle.png","pets/sleep_cat.png",
  "furniture/LARGE_PLANT.png","furniture/CACTUS.png","furniture/BIN.png",
  "furniture/DOOR.png","furniture/COFFEE.png","furniture/PACKAGE.png",
  "furniture/WATER_COOLER.png","furniture/LAMP.png","furniture/CLOCK.png",
  "furniture/BOOKSHELF.png","furniture/FISH_TANK.png","furniture/PARTITION.png",
];

const NPC_FILES = ["mail","cleaner","intern"];

const FILTERS = ["every","hermes","opencode","claude","telegram","cli"];

const RETIRED_BADGES = [
  "layout_lounge","layout_library","layout_war_room","layout_mexico","layout_garden",
  "layout_arcade","layout_penthouse","layout_beach","layout_atelier","layout_spaceship",
  "canvas_artisan","decorator","auto_arrange","tour_guide","screenshotter","mood_master",
];
const RETIRED_COS = ["sun","desk_standing","desk_wood","desk_glass"];

window.OFFICE_DATA = {
  RANKS, RANKS_THRESHOLDS, THEMES, LAYOUTS, LAYOUT_GEOMETRY, PLATFORMS,
  SHORTCUTS, VISITOR_KINDS, DECOR_FILES, NPC_FILES, FILTERS, RETIRED_BADGES, RETIRED_COS,
};
