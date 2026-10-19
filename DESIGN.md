---
name: KMPlus Nexus
description: A substation mimic panel for HR data, in KM+ colours.
colors:
  board: "#f2f4f8"
  panel: "#ffffff"
  ink: "#121619"
  muted-ink: "#4d5358"
  rule: "#dde1e6"
  input-stroke: "#878d96"
  secondary-fill: "#e8ebf0"
  muted-fill: "#eef1f5"
  accent-fill: "#e6f7f7"
  accent-ink: "#004144"
  primary: "#007d79"
  primary-ink: "#ffffff"
  live: "#009d9a"
  live-text: "#005d5d"
  live-soft: "#e3f7f6"
  danger: "#da1e28"
  danger-text: "#a2191f"
  danger-soft: "#fff1f1"
  held: "#8a3ffc"
  held-text: "#6929c4"
  held-soft: "#f6f2ff"
  warning: "#b28600"
  warning-text: "#8e6a00"
  warning-soft: "#fcf4d6"
  info: "#0072c3"
  info-soft: "#e5f6ff"
  paused: "#878d96"
  chart-1: "#0072c3"
  chart-2: "#007d79"
  chart-3: "#8a3ffc"
  chart-4: "#697077"
  chart-5: "#33b1ff"
  rail: "#081a1c"
  rail-accent: "#022b30"
  rail-ink: "#c1c7cd"
  rail-muted: "#878d96"
  rail-signal: "#3ddbd9"
  rail-rule: "#1d3336"
  rail-bright: "#f2f4f8"
  dark-board: "#121619"
  dark-panel: "#1b2023"
  dark-popover: "#21272a"
  dark-secondary-fill: "#2a3034"
  dark-muted-ink: "#a2a9b0"
  dark-rule: "#343a3f"
  dark-input-stroke: "#697077"
  dark-primary: "#08bdba"
  dark-live-text: "#3ddbd9"
  dark-live-soft: "#0d3236"
  dark-accent-ink: "#d9fbfb"
  dark-danger: "#fa4d56"
  dark-danger-text: "#ff8389"
  dark-danger-soft: "#3a1418"
  dark-held: "#a56eff"
  dark-held-text: "#be95ff"
  dark-held-soft: "#2a1a47"
  dark-warning: "#f1c21b"
  dark-warning-soft: "#3a3010"
  dark-info: "#33b1ff"
  dark-info-soft: "#0c2a45"
typography:
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 400
    lineHeight: "2.25rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  body-strong:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  brand:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 300
    letterSpacing: "0.025em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
    fontFeature: "tnum"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.025em"
  readout:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: "2.5rem"
    fontFeature: "tnum"
rounded:
  sm: "1.2px"
  md: "1.6px"
  lg: "2px"
  full: "9999px"
spacing:
  hair: "4px"
  tight: "8px"
  cell: "12px"
  inset: "16px"
  panel: "20px"
  section: "24px"
  gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "color-mix(in srgb, #007d79 82%, black)"
  button-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.muted-fill}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.primary-ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.danger-text}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    width: "240px"
  rail-item:
    textColor: "{colors.rail-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "36px"
  rail-item-active:
    backgroundColor: "{colors.rail-accent}"
    textColor: "{colors.rail-bright}"
    typography: "{typography.body-strong}"
  top-bar:
    backgroundColor: "{colors.panel}"
    height: "56px"
    padding: "0 20px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.panel}"
  table-header:
    backgroundColor: "{colors.muted-fill}"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    height: "36px"
    padding: "0 12px"
  table-cell:
    typography: "{typography.body}"
    padding: "10px 12px"
  notice-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  dialog:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    width: "560px"
  avatar:
    backgroundColor: "{colors.live-text}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.full}"
    size: "32px"
---

# Design System: KMPlus Nexus

## Overview

**Creative North Star: "The Substation Mimic Panel"**

Nexus is drawn like a PLN control-room single-line diagram. Every pipeline is one line you can read like a breaker: source bus, breaker, destination bus. Its state is written as a mark plus words. The board is a flat, cool gray-10 ground with white panels and 1px gray-20 rules. A rail in the darkest KM+ teal runs down the left edge. Colour is reserved for state: teal is live and the primary action, red is tripped, purple is held for approval, hollow gray is paused or idle, and cyan is information and links. Everything else is ink on paper.

The density is operator density, built for long desk sessions: 14px body text, 32px controls, 36px rail rows, and tables as the main surface rather than cards. Numbers, ids, times, column names and summaries are set in IBM Plex Mono with tabular figures, so the board reads like an instrument. Users choose light or dark (the default follows the system), and both themes are fully specified. The rail stays teal-100 in both.

The system refuses the admin template of KPI cards with colour pills scattered on white. Depth is not decoration. The board is flat, and only dialogs, menus and toasts float above it.

**Key Characteristics:**
- A flat gray-10 board with flat white panels and 1px gray-20 rules, cornered at 2px.
- A teal-100 rail (`#081a1c`), the darkest step of the KM+ anchor colour, in both themes.
- State is always a mark plus words: FlowLine, StateMark and Breaker. Colour is never used alone.
- IBM Plex Sans for UI text and IBM Plex Mono for data, labels and summaries.
- One authored motion: a running line energises.
- One layering rule: dialogs, menus and toasts share one shadow.

## Colors

The palette is cool gray paper with KM+ teal as the anchor. KM+ cyan and purple are supporting state colours. All three, plus gray, come from the KM+ colour guide. Red and yellow are Carbon-family state colours.

The palette source is the KM+ colour guide (PRODUCT.md, Brand Commitments). It defines ten-step families (10 to 100):
- **Teal ("Cool Green", the anchor):** d9fbfb 9ef0f0 3ddbd9 08bdba 009d9a 007d79 005d5d 004144 022b30 081a1c
- **Cyan:** e5f6ff bae6ff 82cfff 33b1ff 1192e8 0072c3 00539a 003a6d 012749 061727
- **Purple:** f6f2ff e8daff d4bbff be95ff a56eff 8a3ffc 6929c4 491d8b 31135e 1c0f30
- **Gray:** f2f4f8 dde1e6 c1c7cd a2a9b0 878d96 697077 4d5358 343a3f 21272a 121619

The red (#da1e28, #a2191f, #fa4d56, #ff8389) and yellow (#b28600, #8e6a00, #f1c21b) values are **not in the KM+ guide**. They are Carbon-family state colours, added because the guide has no tripped or warning hue. Treat them as state signals only, never as brand colours. The few soft fills (`live-soft`, `danger-soft`, `warning-soft`, `accent-fill`, the dark `*-soft` values, `rail-rule`) are derived tints between guide steps.

### Primary
- **KM+ Teal 60** (`primary`): the primary action (one per view), the focus ring and the input caret. In dark mode it becomes **Teal 40** (`dark-primary`) with Teal 100 ink.
- **Live Teal 50** (`live`): marks for energised lines, closed breakers, selection edges and the text-selection tint. **Teal 70** (`live-text`) is the live state written as words, and the avatar plate.

### Secondary
- **KM+ Cyan 60** (`info`): information, links (the button `link` variant) and toast actions. In dark mode it is Cyan 40. It is also chart slot 1.

### Tertiary
- **KM+ Purple 60** (`held`): held for approval. **Purple 70** (`held-text`) is held written as words. It is also chart slot 3.

### State (Carbon family, outside the guide)
- **Tripped Red** (`danger` / `danger-text`): failed runs, rows held back, destructive confirms and the Data quality count on the rail.
- **Caution Yellow** (`warning` / `warning-text`): warnings in Notice only.
- **Paused Gray** (`paused`, Gray 50): open breakers and dashed lines for paused or never-run flows. It also draws the open bus in EmptyState.

### Neutral
- **Board** (`board`, Gray 10): the app ground. **Panel** (`panel`, white): flat plates, the top bar, dialogs and menus. **Ink** (`ink`, Gray 100): all text.
- **Muted Ink** (`muted-ink`, Gray 70): descriptions, column heads and meta lines. **Rule** (`rule`, Gray 20): every 1px border and divider. **Input Stroke** (`input-stroke`, Gray 50): field borders, so controls clear 3:1.
- **The Rail** (`rail`, Teal 100): the shell. It uses Rail Accent (Teal 90) for hover and the current item, Rail Ink (Gray 30) for text, Rail Muted (Gray 50) for group labels and icons, and Rail Signal (Teal 30) for the current-item edge, the current icon and the focus ring.
- **Dark board:** board Gray 100, panel `#1b2023`, popover Gray 90, muted ink Gray 40 and rules Gray 80.

### Named Rules
**The Anchor Rail Rule.** The rail is Teal 100 (`#081a1c`), not a neutral Gray 100. The KM+ colour guide makes Cool Green the anchor of every KM+ identity, so the shell carries the anchor. It stays Teal 100 in light and dark.

**The State-Only Colour Rule.** Hue on the board means state. Teal means live or the primary action, red means tripped, purple means held, hollow gray means paused or idle, cyan means info or link, and yellow means warning. Nothing is coloured for decoration.

**The Mark / Text / Soft Rule.** Every state has three tokens: `x` is the mark (lines, dots, icons, at least 3:1), `x-text` is the words (at least 4.5:1 on panels), and `x-soft` is the quiet fill behind a Notice or selection. Words in a state colour always use `x-text`.

**The Verified Pairs Rule.** Text colours are chosen from pairs measured in the build. In light mode: Teal 60 on white 4.99:1, Teal 70 on white 7.71:1, Gray 70 on Gray 10 7.08:1, Cyan 60 on white 5.01:1, red `#da1e28` on white 5.00:1, `#a2191f` 7.79:1, Purple 70 7.74:1, `#8e6a00` 4.99:1. In dark mode: Gray 40 on `#1b2023` ≈6.4:1, Teal 40 on Teal 100 7.66:1, Teal 30 on Teal 100 10.5:1, and `#ff8389` / Purple 40 / Cyan 40 on Gray 90 ≈6.4:1. A new text pair must be measured to reach WCAG 2.2 AA before it ships.

## Typography

**Body Font:** IBM Plex Sans (300, 400, 500, 600), with ui-sans-serif and system-ui as fallbacks
**Label/Mono Font:** IBM Plex Mono (400, 500), with ui-monospace and SFMono-Regular as fallbacks

**Character:** Both faces are self-hosted through next/font. Plex is a common default, but here it is chosen because the KM+ colour guide is itself set in IBM Plex (see the comment in `app/layout.tsx`), so the app speaks in the brand guide's own voice. Sans carries the UI and Mono carries the data. The pairing is engineered rather than expressive, which suits a control panel.

### Hierarchy
- **Headline** (400, 1.625rem, 2.25rem line height, -0.01em): the page title in PageHeader, the only h1 on a screen. A regular weight at a larger size gives the panel title its quiet authority.
- **Title** (600, 1rem, 1.5rem line height): panel h2s (SettingsPanel), dialog titles and EmptyState titles.
- **Body** (400, 0.875rem, 1.25rem line height): all UI text, table cells and descriptions. Descriptions are capped at about 48rem (`max-w-3xl`). Inputs use 1rem below 768px so mobile browsers do not zoom.
- **Body strong** (500, 0.875rem): buttons, StateMark words, the current rail item and Notice titles.
- **Brand** (600, -0.02em): the Nexus wordmark (`NexusWordmark`), 30px in the rail under a KMPLUS caption, and 20px next to the KM+ logo on the landing, sign-in and terms pages.
- **Data** (Mono 400, 0.75rem, tabular): the PageHeader summary line, FlowLine bus names, times, ids and row counts.
- **Label** (Mono 500, 11px, 0.025em, uppercase): table column heads, menu group labels and rail group headings (the rail uses 0.08em tracking). Labels name a column or group. They never sit above a page title.
- **Readout** (Mono 400, 1.875rem, tabular): large numeric readouts.

### Named Rules
**The Mono Means Data Rule.** Anything a person might compare or copy (counts, times, ids, column names, the summary line) is set in Plex Mono with tabular figures. Every table sets `tabular-nums`.

## Layout

The shell has three fixed parts. A 240px rail sits on the left. At 1024px and below it becomes a modal drawer, `min(18rem, 85vw)` wide, opened from a menu button. A 56px white top bar holds a workspace / screen breadcrumb (from 768px), the "Go to" command search (Ctrl K), the notification bell and the profile menu. The routed screen sits in a scrolling `main` capped at 1600px, with 16 / 24 / 32px side padding and 20px vertical padding (24px from 1024px). A skip link targets `#main`.

Each screen opens with PageHeader: the title and description on the left, an optional mono summary line, and actions aligned to the bottom-right. Wide screens wrap gracefully. Below the header sits the board: flat panels with 20px padding (`spacing.panel`), separated by 24px (`spacing.section`). Tables fill their panel edge to edge, with 16px on the outer cells. Table columns may hide below sm, md or lg, but the first column always stays.

The information architecture is fixed in `lib/navigation.ts`. There are eleven screens in six groups: Home, Build, Operate, Govern, Analyze and Workspace. Each screen is a route (`/dashboard/<section>`). Settings has its own tab routes (`/dashboard/settings/<tab>`), and tabs a role cannot use are hidden. `/dashboard` sends stewards to Data quality and everyone else to Overview.

## Elevation & Depth

The board is flat. Panels, tables and the top bar are separated by tone (gray-10 ground, white plate) and 1px rules, never by shadow. Exactly three kinds of surface rise above the board: dialogs (including the mobile nav drawer), menus and toasts. They share one shadow and one teal-tinted backdrop (Teal 100 at 45%, 50% for the drawer, black at 60% in dark mode).

### Shadow Vocabulary
- **Raised** (`box-shadow: 0 8px 24px -6px rgb(8 26 28 / 0.22), 0 2px 6px -2px rgb(8 26 28 / 0.12)`): dialogs, ConfirmDialog, menus, toasts and the mobile rail drawer. Nothing else uses it.
- **Teal edge** (`box-shadow: inset 3px 0 0 var(--live)`): the selected row or list item, paired with the accent fill. This is a state mark, not elevation. The rail draws the same 3px edge for the current item in Teal 30 (`rail-signal`), and the pressed view toggle on Data quality uses the horizontal form (`inset 0 -2px 0`).

### Named Rules
**The One Layer Rule.** Only dialogs, menus and toasts float, and all three use the Raised shadow. If a new surface seems to need lift, make it a dialog or flatten it.

## Shapes

Corners are square-shouldered at 2px (`--radius: 0.125rem`). Tailwind's radius scale is derived from that base, so `rounded-sm`, `rounded-md` and `rounded-lg` all render between 1.2px and 2px. Breakers and FlowLine boxes use 1px. Fully rounded shapes appear only on the avatar plate and on thin progress tracks (file upload). Borders are 1px Rule. State drawings use 2px strokes in `currentColor`: bus bars (a 16×6px box), the breaker (a 10–12px square, filled when closed, hollow when open) and lines (2px, solid when closed, dashed 5px on / 4px off when open). The EmptyState icon sits on an open, dashed bus in Paused Gray. This is the board's "nothing connected yet" mark.

## Components

### Buttons
Compact and squared, with the action named in words.
- **Shape:** 2px corners, 32px tall (28px small, 36px large), with 10px horizontal padding and a 16px icon. On touch screens (`pointer: coarse`) buttons grow to 40px and icon buttons to 40×40, so row actions stay easy to hit.
- **Primary:** KM+ Teal 60 with white ink. It darkens to 82% teal mixed with black on hover; in dark mode it is Teal 40 with Teal 100 ink and lightens on hover. Pressing nudges it down 1px.
- **Outline:** a white panel fill with a Gray 50 stroke at 60%, and a muted fill on hover. Use it for every secondary and row action.
- **Danger:** solid Tripped Red with white ink (Gray 100 ink in dark mode). Use it only as the confirm button of a destructive ConfirmDialog. `destructive` is the quiet 10% red tint variant.
- **Ghost / Link:** ghost for icon buttons in the chrome; link in Cyan 60 with an underline on hover.
- **Focus:** a 2px ring-coloured outline offset by 2px, applied globally through `:focus-visible`.

### Inputs / Fields
- **Style:** 32px tall, transparent on the panel, with a 1px Gray 50 stroke (Gray 60 in dark mode) and 2px corners. Placeholders use Muted Ink and the caret is teal.
- **Focus:** a 2px teal outline offset by 2px.
- **Error / Disabled:** `aria-invalid` adds a red border and a red ring at 20%. Disabled fields drop to 50% opacity. Native selects use the shared `nativeSelectClass` with the same height and stroke.

### Cards / Containers (Panels)
- **Corner Style:** 2px.
- **Background:** Panel (white, or `#1b2023` in dark mode) on the Board.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Rule.
- **Internal Padding:** 20px. SettingsPanel adds its own h2 title and a muted description.

### Tables (Table / DataTable)
The main surface of the board. The header row is a Muted Fill band at 60%, 36px tall, with 11px uppercase mono labels. Cells are 10px × 12px (16px on the outer cells), separated by 1px Rule. Hover tints the row Muted at 50%. Selected rows get the Accent fill and the Teal edge, plus `aria-selected`. DataTable sorts with a labelled button in each sortable head and carries `aria-sort`. It has built-in loading (a spinner with an sr-only label) and empty states. Numbers align right in mono.

### Notice
An inline message with an icon and words in five tones: info, success, warning, danger and held. Each has a 40–50% state border, a soft state fill, a `-text` icon and Ink body text, with 1.6px corners and 10×12px padding. Danger and warning are announced with `role="alert"`; the others with `role="status"`. An optional action sits on the right.

### Dialog / Modal / ConfirmDialog
Dialogs come in sizes sm 420, md 560, lg 720, xl 960 and full width. The header (title plus description, with a ghost close button) and the footer (actions aligned right) are separated from the body by Rules. Opening and closing take 150ms ease-out with a fade and a 0.98 scale. `Modal` takes `dirty`, and closing a dirty editor asks before discarding. `ConfirmDialog` and `useConfirm` handle every destructive or outward action: Cancel uses the outline style, and the confirm button names the action, in danger or primary.

### Menus and Toasts
Menus are popovers with a minimum width of 224px and 1px Rule, using the Raised shadow. Items are at least 32px tall and highlight with the Muted fill. Group labels use the mono Label style, and radio checks are Teal 70. Toasts sit bottom-right (bottom-centre on mobile), at most three at a time, and are announced politely. They use a teal check or red octagon icon and offer an optional Undo action in cyan. They stay up for 5s, or 8s when they carry an action, and pause on hover or focus.

### Navigation
- **Rail:** the Nexus lockup: a KMPLUS caption (mono 11px, 0.18em tracking, Rail Muted) over the Nexus wordmark (30px, Rail Ink, the node in white), then the workspace plate, then the groups. Group headings use the mono Label style in Rail Muted, with a 16px Rail Muted icon and 14px Rail Ink text on each item. Hovered and current items take the Rail Accent fill. The current item adds a 3px Teal 30 left edge, a Teal 30 icon, a 500 weight and `aria-current="page"`. Data quality shows a red mono count with an sr-only sentence.
- **Top bar:** a 56px white bar with a bottom Rule. The breadcrumb reads workspace (muted) / screen (500 weight).
- **Go to (Ctrl K):** the one way to reach anything by name. A Raised dialog with a search field and one listbox grouped by mono labels (Features, Records, Screens, Settings, Preferences). Each option is an icon, the name (records in mono 12px) and a muted hint naming its screen or record type; the active option takes the Accent fill and the Teal edge. A mono footer names the keys and the result count. Features open through their own links, so every feature is also a bookmarkable URL.
- **Profile menu:** a name plus organisation, the 32px Teal 70 initials avatar, and theme, language and sign-out options. Language and theme are stored in the `nexus_lang` and `nexus_theme` cookies.

### FlowLine / StateMark / Breaker (signature)
This is the mimic-panel signature. **FlowLine** draws `bus ─ breaker ─ bus` in mono 12px. Bus names are truncated, use Muted Ink, and have titles. The line and boxes take the state colour through `currentColor`. An `srLabel` is spoken instead of the drawing. **Breaker** is the state square: filled when closed (live, running, tripped, held) and hollow when open (paused, idle). **StateMark** is the breaker plus words in the state's `-text` colour, at 14px and 500 weight. There are six states: live (teal), running (teal, energising), tripped (red), held (purple), paused (gray, open, dashed outgoing line) and idle (gray, open). A legend of breaker marks sits above lists that use them.

**The Mark Plus Words Rule.** A state is never shown by colour alone. It is always a breaker or icon plus a word.

**The Energise Rule.** The only authored motion is `flow-energise`: on a running line, a 9px-on, 9px-at-35% dash pattern slides 18px every 0.9s, linear and infinite. Interface transitions stay at or under 200ms. `prefers-reduced-motion` reduces all animation and transition to 0.01ms.

### EmptyState
An honest empty screen. The icon sits on a dashed, open Paused Gray bus, followed by a semibold title, a muted explanation (at most 28rem wide) and the one next action. It is 56px tall in its spacious form or 32px when compact.

### Email

Every email Nexus sends uses one layout (`lib/email.ts` `render`), table-based with inline styles for mail clients: the board colour (#f2f4f8) around a 600px column; a Rail (#081a1c) band with the on-dark logo (74×40) and "Nexus" in light 18px; a 3px Rail Signal (#3ddbd9) line; a white card with a 22px/600 heading, 15px/24px body in gray-80, an optional state mark (soft fill, 1px mark border, square mark + words, never colour alone), an optional details table (mono uppercase labels, 1px gray-20 rules), one teal (#007d79) button with a "copy this link" fallback in mono, and a quieter note under a rule; a footer saying it was sent automatically and why. Plex Sans/Mono with Segoe UI/Arial and Consolas fallbacks; `color-scheme: light` so clients don't invert it. Every email has a plain-text twin.

## Do's and Don'ts

### Do:
- **Do** use tokens only: `bg-card`, `text-muted-foreground`, `text-live-text`, `border-border`, `bg-sidebar`, `text-chart-1` and so on. New colours enter through `app/globals.css` in light, `.dark` and `prefers-color-scheme` blocks together.
- **Do** open every screen with PageHeader as its single h1, with the purpose in one line and the summary in mono.
- **Do** give each view one primary (teal) action. Use outline for secondary and row actions.
- **Do** route every destructive or outward action (delete, publish, send, revoke, replay) through Modal, ConfirmDialog or `useConfirm`, with a confirm button that names the action. Editors in a Modal pass `dirty`.
- **Do** use Notice for inline messages, EmptyState for empty places, and Table or DataTable for lists, with numbers in mono and right-aligned.
- **Do** write state as FlowLine, StateMark or Breaker: a mark plus words, with words in the `-text` token.
- **Do** make every screen a route with `generateMetadata`, and put every user-facing string in `lib/i18n/messages/en.ts` (the source of truth), with `id.ts` in the same shape, including plurals.
- **Do** meet WCAG 2.2 AA: visible labels on fields, `aria-label` on icon buttons, keyboard-operable rows and controls, the 2px focus outline, and text pairs taken from the Verified Pairs list.
- **Do** keep the rail Teal 100 in both themes, and keep corners at 2px.

### Don't:
- **Do** use the official logo through `components/brand/km-logo.tsx` only: `public/brand/kmplus-logo-on-dark.png` (white letters, supplied 2026-10-13) on the rail and dark panels, `kmplus-logo-on-light.png` (the same file with the letters in KM+ ink #121619) on light grounds, `tone="auto"` where the ground follows the theme. Size it by height (36px in the rail and on auth pages); never redraw, recolour the rays, stretch or put it on a busy ground. 
- **Do** draw the product logo through `components/brand/nexus-logo.tsx` only. The **Nexus mark** (chosen 2026-10-19) is the "bridge", a derivative of the KM+ rays: three Teal 40 bars bring data in, three Cyan 50 bars send it out (`--brand-ray-in` / `--brand-ray-out`, the same in both themes and never used for UI state), joined by a square node that takes the text colour (ink on light, white on the rail). In the **wordmark** (`NexusWordmark`, IBM Plex Sans 600) the bridge is the "x" of "Nexus"; size it by font size. In the rail the lockup carries the parent name as the KMPLUS caption; on the public pages (landing, sign-in, terms) the wordmark sits next to the official KM+ logo. The bars, angles and node are fixed: never recolour the bars, rotate or stretch the mark. Static copies are `public/brand/nexus-mark.svg` (light grounds) and `nexus-mark-on-dark.svg`. The favicon and app icons (`public/icon.svg`, `icon-32x32.png`, `icon-192x192.png`, `apple-icon.png`) use the **bold cut** (`NexusMark bold`: thicker bars and node for 32px and below) in white and brand colours on the rail colour. Emails keep the KM+ logo with "Nexus" in text, since mail clients don't show SVG.
- **Don't** use raw Tailwind palette classes (`bg-red-500`, `text-gray-600`) or raw hex in components. The official logo files are the only brand assets with their own colours.
- **Don't** put a drop shadow on anything that sits on the board. Only dialogs, menus and toasts are Raised.
- **Don't** use rounded corners above 2px. Reserve `rounded-full` for avatars and thin progress tracks.
- **Don't** show state as a coloured pill or colour alone.
- **Don't** add a second ambient animation. Spinners for loading and `flow-energise` on running lines are the motion vocabulary.
- **Don't** build screens as grids of KPI cards. The board is lines and tables.
- **Don't** put a mono or uppercase kicker or eyebrow above a page or panel title.
- **Don't** colour anything with red or yellow except tripped, danger and warning states. They are Carbon state colours, not KM+ brand colours.
