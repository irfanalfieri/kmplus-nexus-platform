---
target: KMPlus Nexus main screens
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:D:\\KMPlus Nexus (IPaaS)\\kmplus-nexus-platform\\components\\dashboard\\dashboard-layout.tsx"
target_fingerprint: "sha256:15cc71a2006621ad5d419f2e7c2b70d6ddec43f38df5f5ae1d1ec07c344d0977"
target_path: "D:\\KMPlus Nexus (IPaaS)\\kmplus-nexus-platform\\components\\dashboard\\dashboard-layout.tsx"
timestamp: 2026-10-12T10-15-21Z
slug: components-dashboard-dashboard-layout-tsx
---
Method: dual-agent (A: design review · B: detector + technical audit). Seeded demo workspace "PT KMPlus Indonesia", 1440 and 390 captures, dark (OS).

Heuristics 22/40 (Acceptable): status 3, real world 2, control 2, consistency 2, error prevention 2, recognition 2, flexibility 2, minimalist 2, error recovery 3, help 2.
Audit 10/20 (Acceptable): a11y 2, performance 3, theming 2, responsive 1, integrity 2.

Design specificity: structure category-interchangeable (stock shadcn grey, lucide logo, "v0 App" title, hero card + KPI strip on every layer, no KM+ colours); copy is product-specific. Detector: source clean, dashboard overlay clean; landing page "/" has ai-color-palette + 2 low-contrast (3.8:1, 3.5:1).

Priority issues:
1. [P0] Data Quality fix -> replay dead end: fixed rows vanish from the default Open filter, "select the row and Replay" points at nothing, Replay on open rows does nothing; inbox below the fold; failing field unmarked; 8-field truncation. Fix: inbox-first, KPI chips as filters, default "Needs action", failing fields first, Save & replay, confirm replay naming the destination, per-row replay status.
2. [P0] Unusable at phone width / zoom (WCAG 1.4.10): fixed w-64 sidebar, w-96 search, overlapping tab strip. Fix: drawer nav below lg, fluid top bar.
3. [P1] Two navigations, no URLs: sidebar + 11-tab bar with different labels, useState routing, dead search, inert avatar. Fix: one grouped sidebar, route per screen with titles, account menu, real search or none.
4. [P1] Keyboard / screen reader (WCAG 2.2 AA): 14 div modals without focus trap/Esc/return, 5 unnamed close buttons, ~50 unlabelled inputs (connector forms), mouse-only run rows, focus ring 1.5-1.9:1, no main/skip link/aria-current.
5. [P1] No KM+ identity, colour does no work: grey defaults, half-wired dark mode (76 dark: classes inactive -> 2.2-3.6:1 status text), 221 hard-coded colours, one white pill for active + primary, red Sign Out. Fix: KM+ token system (Teal primary/current, Cyan info, Purple approval/env, cool Gray surfaces, semantic status), real light/dark toggle.
Also P2: unguarded publish / reset sync / dismiss / editor close; overlapping problems list; landing page gradient.

Personas: Alex (dead search, refresh resets, no Esc, editor X loses work); Sam (focus behind modals, no current page, duplicate nav, "Select row" x30); Rina, HR steward before payroll cutoff (Overview -> Monitoring, inbox below fold, hidden field, vanishing fixed row, Replay no-op, English only).

Minor: dev-mode connector note shown to customers, Catalog half-empty detail pane, getting-started list never collapses, spinners not skeletons in Analytics, inline "row(s)" strings.

Questions: steward landing on Data Quality? Single Save & replay removes "Fixed"? Teal only for the next action?
