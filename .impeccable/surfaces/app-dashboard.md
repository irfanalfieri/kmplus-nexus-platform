---
version: 1
slug: "app-dashboard"
primary_target: "app/dashboard"
related_targets: ["components/dashboard"]
---

# Dashboard (app shell and operating screens)

Mode: operate. Scope: the signed-in app under /dashboard: shell, navigation, Pipelines, Data Sources, Data Quality, Settings first; every other layer inherits the shell and tokens.

Audience and job: customer IT integration admins and HR data stewards (Indonesia), long desk sessions in daytime office light. Job: see what ran, what tripped, what is held, and fix it without engineers. Constraints: WCAG 2.2 AA, English/Bahasa Indonesia switchable, light/dark/system chosen by the user, no mock data.

## Direction contract

THESIS: Nexus is a mimic panel for HR data. Every flow is a single line you can read like a breaker. It refuses the KPI-card-grid admin template with colour pills scattered on white.

OWN-WORLD: The board is a cool gray-10 ground (#f2f4f8 light, #121619 dark) with flat white/gray-90 panels and 1px gray-20 rules. The rail is teal-100 (#081a1c), the darkest step of the KM+ anchor colour: the colour guide makes Cool Green the anchor of every KM+ identity, so the shell carries it rather than a neutral gray-100. KM+ teal (#009d9a, #005d5d for text and buttons) means live/energized and the primary action. Red means tripped, purple means held for approval, open hollow gray means paused, and cyan means information and links. IBM Plex Sans is for UI text and Plex Mono for tags, ids, counts and times. Corners are square or 2px. Elevation follows one rule: the board is flat, and only dialogs, menus and toasts sit above it, with one shadow.

STORY: An admin scans a column of lines, sees the red breaker on "SAP employees → Employee" with 8 rows held, opens the quarantine, fixes one record with the next already loaded, and saves and replays. The line turns teal. Nothing they dismiss silently disappears.

FIRST VIEWPORT: On the left is the 240px teal-100 rail: the KM+ wordmark, the workspace plate, and groups (Build, Operate, Govern, Analyze, Workspace) with a teal edge on the current item and a red count beside Data quality. A 56px white header holds the breadcrumb, a command search and the profile menu (name + org; theme, language, sign out). The page head has a 28px title and a mono summary line, with the primary teal action on the right. Below it sits the board: one row per pipeline, with its single-line strip (source bus ─ breaker ─ destination bus), state, last run and rows in mono.

FORM: Substation Mimic Panel (PLN control-room single-line diagrams), position 7 of my ordered list, seed key 810af3ee. Raises: one layering rule; run bars drawn at true duration; quarantine inbox with the next record preloaded; nothing silently disappears (struck, stamped, undo).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
