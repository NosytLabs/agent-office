/* Agent Office — static data: themes, layouts, platforms, badges.
   Pure constants, no DOM access. */
"use strict";

const RANKS = [
  ["intern", 0],
  ["junior", 50],
  ["staff", 200],
  ["senior", 500],
  ["principal", 1200],
  ["distinguished", 3000],
];
const RANKS_THRESHOLDS = Object.fromEntries(RANKS);

const THEMES = [
  {id:"default", name:"Default",   bg:"#121018", tileA:"#2c2438", tileB:"#262033", wall:"#3a2f4b"},
  {id:"midnight",name:"Midnight",   bg:"#08080f", tileA:"#101226", tileB:"#0a0c1e", wall:"#1e2a52"},
  {id:"forest",  name:"Forest",     bg:"#0e1a14", tileA:"#1c2e22", tileB:"#16241b", wall:"#2a3a2a"},
  {id:"solar",   name:"Solar",      bg:"#1a1208", tileA:"#3a2a14", tileB:"#2c1d0e", wall:"#4a3818"},
  {id:"cyber",   name:"Cyberpunk",  bg:"#0a0014", tileA:"#1a0830", tileB:"#100020", wall:"#3a1d6a"},
  {id:"sunset",  name:"Sunset",     bg:"#2a0a14", tileA:"#4a1838", tileB:"#3a1228", wall:"#7a2848"},
  {id:"ocean",   name:"Ocean",      bg:"#03133a", tileA:"#0e2a5a", tileB:"#08204a", wall:"#2058a8"},
  {id:"candy",   name:"Candy",      bg:"#321a3a", tileA:"#5a2a5a", tileB:"#4a205a", wall:"#a060a8"},
  {id:"casino",  name:"Casino",     bg:"#0a1e0c", tileA:"#1a4a24", tileB:"#0c3418", wall:"#3a8844"},
];

const LAYOUTS = [
  {id:"open",    name:"Open floor", hint:"default",                    require:null},
  {id:"bullpen", name:"Bullpen",    hint:"10 sessions ever",            require:"layout_bullpen"},
  {id:"war_room",name:"War room",   hint:"principal rank",              require:"layout_war_room"},
  {id:"lounge",  name:"Lounge",     hint:"3+ runtimes at once",         require:"layout_lounge"},
  {id:"mexico",  name:"Roof deck",  hint:"night owl + 5 sessions",      require:"layout_mexico"},
  {id:"garden",  name:"Garden",     hint:"25 writes + 100 sessions",    require:"layout_garden"},
  {id:"library", name:"Library",    hint:"25 reads",                    require:"layout_library"},
  {id:"arcade",  name:"Arcade",     hint:"5000 tools",                  require:"layout_arcade"},
  {id:"penthouse",name:"Penthouse", hint:"10k tools",                   require:"layout_penthouse"},
  {id:"beach",   name:"Beach",      hint:"100 sessions + 10 themes",    require:"layout_beach"},
  {id:"atelier", name:"Atelier",    hint:"100 writes + 100 sessions",   require:"layout_atelier"},
  {id:"spaceship",name:"Spaceship", hint:"10k tools + 3 platforms",    require:"layout_spaceship"},
];

const LAYOUT_GEOMETRY = {
  open:      {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"rug",
              floor:["#2c2438","#262033"], wall:"#3a2f4b"},
  bullpen:   {perRow:5, colStep:30, rowStep:30, labelY:14, decor:"bullpen",
              floor:["#2a2a34","#24242e"], wall:"#34384a"},
  war_room:  {perRow:3, colStep:42, rowStep:38, labelY:14, decor:"war_table",
              floor:["#30262a","#2a2024"], wall:"#4a2f2f"},
  lounge:    {perRow:3, colStep:42, rowStep:40, labelY:14, decor:"lounge",
              floor:["#243030","#1e2828"], wall:"#2f4a42"},
  mexico:    {perRow:2, colStep:60, rowStep:42, labelY:14, decor:"roof",
              floor:["#383226","#302a20"], wall:"#5a4a28", sky:true},
  garden:    {perRow:3, colStep:42, rowStep:38, labelY:14, decor:"garden",
              floor:["#1e3020","#18281a"], wall:"#2a4a2e", sky:true},
  library:   {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"library",
              floor:["#302a20","#2a241a"], wall:"#4a3a22"},
  arcade:    {perRow:4, colStep:36, rowStep:34, labelY:14, decor:"arcade",
              floor:["#201830","#1a1228"], wall:"#3a2060", neon:true},
  penthouse: {perRow:3, colStep:48, rowStep:38, labelY:14, decor:"penthouse",
              floor:["#2e2a36","#282430"], wall:"#46405a"},
  beach:     {perRow:2, colStep:60, rowStep:42, labelY:14, decor:"beach",
              floor:["#3a3424","#342e1e"], wall:"#4a6a8a", sky:true},
  atelier:   {perRow:3, colStep:42, rowStep:38, labelY:14, decor:"atelier",
              floor:["#322832","#2c222c"], wall:"#4a3450"},
  spaceship: {perRow:2, colStep:60, rowStep:42, labelY:14, decor:"spaceship",
              floor:["#20283a","#1a2232"], wall:"#283048", stars:true},
};

const PLATFORMS = [
  {id:"hermes",   name:"Hermes",      icon:"hermes",   what:"This machine's AI agent",
   usedFor:"General coding, multi-agent orchestration, Telegram bridge",
   install:"already running — it's the host", url:"https://hermes.nousresearch.com"},
  {id:"opencode", name:"OpenCode",    icon:"opencode", what:"Terminal-first coding CLI from SST",
   usedFor:"Quick scripts, multi-file edits, project scaffolding",
   install:"brew install sst/tap/opencode (or npm i -g opencode-ai)",
   url:"https://opencode.ai"},
  {id:"claude",   name:"Claude Code", icon:"claude",   what:"Anthropic's CLI coding agent",
   usedFor:"Long-running tasks, large refactors, deep codebase exploration",
   install:"npm i -g @anthropic-ai/claude-code",
   url:"https://docs.anthropic.com/en/docs/claude-code"},
  {id:"telegram", name:"Telegram",    icon:"telegram", what:"Hermes bridge to your phone via Telegram",
   usedFor:"Chat with your agents from anywhere — runs through the gateway",
   install:"set TELEGRAM_BOT_TOKEN in your .env",
   url:"https://telegram.org"},
  {id:"cli",      name:"CLI / cron",  icon:"cli",      what:"Plain command-line sessions and cron jobs",
   usedFor:"Shell agents, scheduled tasks, batch jobs",
   install:"already wired — Hermes cron publishes events", url:""},
];

const SHORTCUTS = [
  ["R","roster"],["U","usage"],["B","badges"],["L","layout"],
  ["S","settings"],["D","dbg (raw state)"],["E","live events"],
  ["?","legend"],["T","theme"],["P","platforms"],
];

window.OFFICE_DATA = {RANKS, RANKS_THRESHOLDS, THEMES, LAYOUTS, LAYOUT_GEOMETRY, PLATFORMS, SHORTCUTS};
