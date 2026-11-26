# Agent Office — Design System

This document is canonical for the Agent Office product site
([site/index.html](site/index.html), [site/style.css](site/style.css)) and the
reference for the in-app UI in [web/](web/). New components derive from the
tokens here; if a value is not in this document or the `:root` token block, it
does not ship.

## 1. Principles

1. **Honesty before decoration.** The interface reports what a runtime
   supplied. Missing data reads as "Not reported", never as a reassuring
   zero, and animation reflects reported activity — it does not prove an
   agent completed useful work.
2. **Labels from the user's side.** States and controls are named for what
   they mean to the person watching the floor ("Needs input"), not for the
   internal event that produced them.
3. **Local and quiet.** The product site makes no external requests, sets no
   storage, and runs no analytics. The app binds to loopback by default.
4. **Examples are labeled.** Screenshots and demo sessions are synthetic and
   say so wherever they appear.
5. **Warm paper, deep juniper.** The visual world is a paper desk surface
   with juniper-green ink and one gold accent. It is an office, not a
   terminal theme and not a generic SaaS dashboard.

## 2. Color tokens

Defined once in `:root` in [site/style.css](site/style.css). Rules reference
tokens, not literal hex values; illustration clusters inside the hero artwork
frame are the only exception.

### Paper and ink

| Token           | Value     | Use                              |
| --------------- | --------- | -------------------------------- |
| `--paper`       | `#faf9f3` | Page background                  |
| `--paper-bright`| `#fffef9` | Raised panels (status window)    |
| `--paper-deep`  | `#f1f2e9` | Foundation strip                 |
| `--ink`         | `#18372d` | Body text, headings              |
| `--muted`       | `#5b6b60` | Secondary text                   |

### Juniper

| Token           | Value     | Use                              |
| --------------- | --------- | -------------------------------- |
| `--green`       | `#245442` | Primary actions, active states   |
| `--forest`      | `#163b30` | Dark surfaces, tour background   |
| `--green-hover` | `#163d2e` | Button hover                     |
| `--green-soft`  | `#47764f` | Navigation hover                 |
| `--green-text`  | `#507956` | Headline accent line             |
| `--green-faint` | `#58705b` | Card kickers                     |
| `--card-text`   | `#516351` | Card body text                   |

### Lines and tints

| Token            | Value     | Use                             |
| ---------------- | --------- | ------------------------------- |
| `--line`         | `#daddce` | Hairline dividers               |
| `--line-card`    | `#d5dbcf` | Card borders                    |
| `--line-soft`    | `#cfd6c7` | Foundation strip separators     |
| `--tint-sage`    | `#ecefdf` | Attention card                  |
| `--tint-mist`    | `#e4ebe3` | Context card                    |
| `--tint-sand`    | `#f1eada` | Local-tasks card                |
| `--tint-sand-line`| `#e0d8c4`| Local-tasks card border         |

### Gold

| Token         | Value       | Use                                   |
| ------------- | ----------- | ------------------------------------- |
| `--gold`      | `#edcb83`   | Accent fills, text selection          |
| `--gold-deep` | `#a16c24`   | Focus outline                         |
| `--gold-text` | `#a37425`   | Needs-input dot                       |
| `--gold-halo` | `#ecdab380` | Needs-input halo ring                 |

## 3. Typography

Three voices, all already on the page:

| Role    | Family                                        | Notes                        |
| ------- | --------------------------------------------- | ---------------------------- |
| UI      | Geist (self-hosted variable, 100–900)         | Body, headings, controls     |
| Serif   | Georgia, "Times New Roman", serif (`--serif`) | Editorial accents            |
| Mono    | ui-monospace, SFMono-Regular, Consolas        | Commands, versions, data     |

Scale: `h1` clamp(56px, 5.4vw, 78px), `h2` clamp(36px, 4.05vw, 56px), body
16px at 1.65 line height. Headings are weight 620 with -0.045em tracking and
balanced wrapping. Status and usage figures use tabular numbers where the
app renders data.

## 4. Layout and spacing

- Content shell: `min(1280px, calc(100% - 96px))`, centered.
- Sections breathe: 96px block padding on the site; more space above a
  heading than below it.
- Cards: 28px padding, 12px radius, 1px token border, flat tint fill. No
  nested cards.
- Controls are at least 44px in their smallest dimension.
- Breakpoints: 1150px, 900px, 650px. Grids collapse in step (3 → 1 cards,
  4 → 2 → 1 status entries); nothing overflows horizontally at 320px.

## 5. Components

- **Buttons.** Primary: `--green` fill, white text, 9px radius, 130ms
  transition; hover deepens to `--green-hover` and lifts 2px. Light variant
  is transparent with a line border. Press and focus states are always
  visible; focus is a 3px `--gold-deep` outline at 5px offset, everywhere.
- **Tabs.** Tour and setup groups are manual-activation tablists: arrows
  move focus, Enter/Space activates, and every panel stays readable with
  JavaScript disabled.
- **Terminal window.** Setup commands sit in a framed window with copy
  buttons that announce their result in a polite live region and degrade to
  text selection when the clipboard is unavailable.
- **Status window.** A `--paper-bright` panel listing the session states in
  section 6, each a dot plus a user-side label plus one line of meaning.
- **FAQ.** Native `details`/`summary`; works without JavaScript.
- **Selection.** Text selection is `--gold` on `--ink`.

## 6. Status vocabulary

The site and the app use the same four session states. The dot color comes
from the token; the label is the contract.

| State       | Token             | Means                                                        |
| ----------- | ----------------- | ------------------------------------------------------------ |
| Working     | `--status-working` | A tool is running, or a response is streaming.              |
| Needs input | `--status-input`   | A question or permission request is waiting. The user answers in the original runtime; the office never grants approvals. |
| Idle        | `--status-idle`    | Connected and quiet. Nothing is waiting on the user.        |
| Ended       | `--status-ended`   | The session closed. Its activity and reported usage stay in the record. |

Needs input is the only state with a halo: it is the one state that asks
something of the user. Usage values that a runtime did not supply are shown
as **Not reported**, in the same muted treatment as Idle — absence of data
is a state, not a number.

## 7. Motion

- One authored register: 130ms ease transitions on controls, a 2px hover
  lift on primary buttons, smooth anchor scrolling.
- Under `prefers-reduced-motion: reduce`, transitions and animations are
  removed, smooth scrolling is off, and hover lift is disabled. This is
  tested, not aspirational.

## 8. Publishing rules

- The public site is built only from the explicit input list in
  [tools/build_site.mjs](tools/build_site.mjs). If a file is not listed, it
  is not published.
- The canonical base URL comes from `AGENT_OFFICE_SITE_URL` (see
  [tools/build_paths.mjs](tools/build_paths.mjs)); the build writes the
  canonical link, Open Graph tags, sitemap, and robots file from it.
- Screenshots are checked-in responsive derivatives of the captures in
  [docs/screenshots](docs/screenshots); the build refuses stale sources.

## 9. What this is not

- Not a controller: the office observes sessions and never answers their
  permission prompts. Starting work is always an explicit, separate action.
- Not a cloud dashboard: there is no account, no hosted floor, and no
  telemetry in the observer.
- Not a metrics product: usage figures are runtime-reported estimates with
  named sources, not invoices and not plan meters.
