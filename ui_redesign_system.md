# eNote — UI/UX redesign system

**Subject:** eNote, a desktop academic management system (Electron 31, React 19, Tailwind v4, PostgreSQL).
**Scope of this document:** layout architecture, design tokens, the three core operational screens, component state
matrices, motion, UX copy, accessibility, and the file-level implementation map. This is the specification; no
component files are changed by it.

> **Palette superseded (31 October 2026).** The colour values in §1 describe the earlier warm-paper/brass system and
> no longer ship. The live palette is the "nocturne" set: near-black pine canvas `#0d1310`, panel `#141c17`, warm
> off-white ink `#eceae0`, jade accent `#3ba97d` and ember signal `#ef6840`, with a matched daylight variant.
> `src/renderer/index.css` is the single source of truth for those tokens; the layout, density, component, motion and
> copy specifications below still apply unchanged.

The system replaces four patterns that dominate the current UI:

| Current pattern | Where | Replaced by |
| --- | --- | --- |
| Welcome banner + stat cards + quick-action tile grid | `Dashboard.jsx` | KPI strip + work queue + today's list |
| 3-column card grid for a multi-thousand-row directory, 10 per page | `StudentDirectory.jsx` | Dense table, 25 rows/page, batch actions |
| Entity selected through a `<select>` dropdown, six tabs rendered inline | `StudentProfile.jsx` | Master-detail with docked inspector |
| Indigo/blue gradients, 16–24 px radii, hover-lift, infinite float/pulse | app-wide | Flat pine/paper palette, 6–10 px radii, one-shot 120–220 ms transitions |

---

## 1. Design tokens

### 1.1 Palette

Institutional, not decorative: a warm paper canvas, graphite ink, **one** action colour (pine green, the colour of a
registry stamp), and four desaturated intent colours. No violet, no indigo, no gradients on any surface or control.

```css
/* src/renderer/index.css — replaces the current @theme block */
@theme {
  --font-ui: "Outfit", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;

  /* Surfaces */
  --color-canvas: #f5f4f0;
  --color-surface: #ffffff;
  --color-surface-muted: #efeee9;
  --color-surface-sunken: #e7e5df;

  /* Lines */
  --color-line: #dcdad3;
  --color-line-strong: #c3c1b7;

  /* Text */
  --color-ink: #1a1c1e;
  --color-ink-2: #4b5158;
  --color-ink-3: #646b72;
  --color-ink-disabled: #8a8f94;

  /* Action */
  --color-primary-50: #edf5f3;
  --color-primary-100: #d6e7e3;
  --color-primary-300: #7fb8af;
  --color-primary-500: #14726a;
  --color-primary-600: #0f5c54;
  --color-primary-700: #0b4a44;
  --color-primary-solid: #0f5c54; /* background of filled buttons in both themes */
  --color-on-primary: #ffffff;
  --color-selection: #e3efec;

  /* Intent */
  --color-success: #1d6b45;  --color-success-bg: #e6f2ea;  --color-success-ink: #14512f;
  --color-warning: #8a5300;  --color-warning-bg: #fbf0dc;  --color-warning-ink: #6b4100;
  --color-danger:  #a32020;  --color-danger-bg:  #fbeaea;  --color-danger-ink:  #7f1a1a;
  --color-info:    #175d8a;  --color-info-bg:    #e7f0f7;  --color-info-ink:    #124a6d;

  /* Type scale */
  --text-page: 1.75rem;     --text-page--line-height: 2.125rem;   --text-page--letter-spacing: -0.011em;
  --text-h2: 1.25rem;       --text-h2--line-height: 1.625rem;
  --text-h3: 0.9375rem;     --text-h3--line-height: 1.375rem;
  --text-body: 0.875rem;    --text-body--line-height: 1.25rem;
  --text-dense: 0.8125rem;  --text-dense--line-height: 1.125rem;
  --text-label: 0.75rem;    --text-label--line-height: 1rem;
  --text-micro: 0.6875rem;  --text-micro--line-height: 0.875rem;  --text-micro--letter-spacing: 0.04em;

  /* Radii */
  --radius-xs: 4px;   /* badges, chips */
  --radius-sm: 6px;   /* inputs, buttons */
  --radius-md: 8px;   /* cards, panels */
  --radius-lg: 10px;  /* dialogs, drawers */

  /* Elevation: border first, shadow only for things that float over content */
  --shadow-e1: 0 1px 2px rgba(26, 28, 30, 0.06);
  --shadow-e2: 0 8px 24px -12px rgba(26, 28, 30, 0.22);
  --shadow-e3: 0 24px 48px -24px rgba(26, 28, 30, 0.32);

  /* Motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
```

```css
/* Layout metrics: plain custom properties, not Tailwind utilities */
:root {
  --sidebar-w: 260px;
  --sidebar-w-collapsed: 56px;
  --topbar-h: 56px;
  --toolbar-h: 52px;
  --savebar-h: 56px;
  --row-h: 40px;
  --row-h-compact: 32px;
  --control-h: 36px;
  --control-h-sm: 28px;
  --page-max: 1440px;
  --gutter: 24px;
  --inspector-w: 480px;
  --masterlist-w: 300px;
}
```

### 1.2 Dark mode

Dark mode is the same token set remapped, **not** an inversion of the Tailwind neutral scale. The current
`.dark { --color-slate-50: #0e1728 … --color-slate-900: #eef2f9 }` block in `index.css` rewrites text *and* border *and*
fill colours into one another; the replacement below removes that class entirely, along with `.theme-pinned`.

```css
.dark {
  --color-canvas: #131518;
  --color-surface: #1b1e22;
  --color-surface-muted: #23272c;
  --color-surface-sunken: #0e1012;
  --color-line: #31363c;
  --color-line-strong: #454b52;
  --color-ink: #e9eae6;
  --color-ink-2: #b4babf;
  --color-ink-3: #8b9298;
  --color-primary-50: #1a302d;
  --color-primary-100: #1f3b38;
  --color-primary-300: #58afa2;
  --color-primary-500: #6fc1b4;
  --color-primary-600: #8fd3c7;
  --color-primary-700: #b8e6dd;
  --color-primary-solid: #14726a;
  --color-selection: #22403c;
  --color-success-bg: #16281f;  --color-success-ink: #7cc79a;
  --color-warning-bg: #2c2418;  --color-warning-ink: #e3b25f;
  --color-danger-bg:  #2a1a1a;  --color-danger-ink:  #f08a84;
  --color-info-bg:    #16232c;  --color-info-ink:    #86b9d9;
  --shadow-e1: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-e2: 0 8px 24px -12px rgba(0, 0, 0, 0.7);
  --shadow-e3: 0 24px 48px -24px rgba(0, 0, 0, 0.8);
}
```

In dark mode `--color-primary-600` becomes a *text* colour, so filled buttons do not follow it. They use
`--color-primary-solid`, which stays a dark teal in both themes: `#0f5c54` with white text in light, `#14726a` with
white text in dark (5.76:1). Text links and active icons use `--color-primary-500` in dark.

### 1.3 Measured contrast

Measured with the WCAG 2.1 relative-luminance formula at the sizes the tokens are used for:

| Pair | Ratio | Use |
| --- | --- | --- |
| ink / canvas | 15.53:1 | body text on page |
| ink / surface | 17.09:1 | body text in panel |
| ink-2 / surface | 8.02:1 | secondary text |
| ink-3 / surface | 5.17:1 | captions, table meta |
| ink-3 / canvas | 4.91:1 | captions on page |
| white / primary-600 | 7.84:1 | primary button |
| primary-600 / primary-50 | 7.08:1 | selected nav item, chips |
| primary-600 / canvas | 7.12:1 | links |
| success-ink / success-bg | 8.12:1 | success pill |
| warning-ink / warning-bg | 7.81:1 | warning pill |
| danger-ink / danger-bg | 8.74:1 | error pill |
| info-ink / info-bg | 8.18:1 | info pill |
| dark ink / surface | 13.84:1 | body text |
| dark ink-3 / surface | 5.31:1 | captions |
| primary-500 / surface (dark) | 7.94:1 | links |
| white / #14726a (dark primary-solid) | 5.76:1 | primary button, dark |
| danger-ink / dark surface | 6.91:1 | error text |

`--color-ink-disabled` (#8a8f94 on white, 3.26:1) is legible only because disabled controls are exempt and always
carry a non-colour cue (`disabled` attribute, `cursor: not-allowed`).

Borders (`--color-line`, 1.27:1 on canvas) are decorators; no state may be communicated by border colour alone.

### 1.4 Type scale in use

| Token | Size / line | Weight | Where |
| --- | --- | --- | --- |
| `text-page` | 28 / 34 | 600 | page title, one per screen |
| `text-h2` | 20 / 26 | 600 | panel title, dialog title |
| `text-h3` | 15 / 22 | 600 | card title, section header |
| `text-body` | 14 / 20 | 400 | forms, prose, buttons |
| `text-dense` | 13 / 18 | 400 | table cells, list rows |
| `text-label` | 12 / 16 | 500 | field labels, chip text |
| `text-micro` | 11 / 14, 0.04em, uppercase | 600 | table headers, nav group labels |

Identifiers only (person id, insurance card, military card, serial, phone) use `font-mono` at 12 px. Numeric columns
right-align and set `font-variant-numeric: tabular-nums`; if Outfit supplies no tabular figures, right alignment plus
a fixed column width is the fallback, not a font swap.

The current UI's mix of 10 px `font-bold uppercase tracking-wider` labels everywhere is cut back: uppercase 11 px is
reserved for table headers and nav group labels.

---

## 2. Layout architecture

### 2.1 Shell

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Sidebar 260 (fixed) │ TopBar 56 (sticky, border-bottom)                          │
│                     ├────────────────────────────────────────────────────────────┤
│ brand 56            │ PageHeader 56   title · context controls · page actions     │
│                     ├────────────────────────────────────────────────────────────┤
│ nav groups          │ Toolbar 52 (lists) / KPI strip 72 (dashboard)                │
│ (scroll)            ├────────────────────────────────────────────────────────────┤
│                     │ Content: 12-col grid, gutter 24, max-width 1440             │
│                     │                                                            │
│                     │                                                            │
│ status 40           ├────────────────────────────────────────────────────────────┤
│ user 56             │ SaveBar 56 (only when a form is dirty)                     │
└─────────────────────┴────────────────────────────────────────────────────────────┘
```

| Region | Size | Rules |
| --- | --- | --- |
| Sidebar | 260 px; 56 px icon rail | Fixed, own scroll, never scrolls with content. Collapses to the rail below 1280 px window width; state persists in `localStorage` (`enote-nav`) |
| TopBar | 56 px | Sticky, `surface` + 1 px `line`. Holds breadcrumb (not the app name), command-palette trigger, theme toggle, avatar menu |
| PageHeader | 56 px | Title + one sentence of context max; page-level actions right-aligned; no greeting, no role prose |
| Toolbar | 52 px | One row: search, filter chips, sort, view, primary action |
| Content | `max-width: 1440px` | 12 columns, 24 px gutters, 24 px page inset; content is top-aligned and left-aligned, never centred as a card |
| SaveBar | 56 px | Pinned bottom of the detail pane, only while dirty/saving/saved |

Window minimum: 1024 × 720. Breakpoints:

| Width | Behaviour |
| --- | --- |
| ≥ 1440 | Sidebar 260, inspector 480 docked, dashboard main 8 / rail 4 |
| 1280–1439 | Sidebar 260, inspector 440 docked, dashboard main 8 / rail 4 |
| 1024–1279 | Sidebar 56 rail, inspector overlays at 480, dashboard main/rail stacks at 12 |
| < 1024 | Not supported; window enforces 1024 minimum |

12-column grid: dashboard `8 / 4`; directory `12`; records `300 px list + rest`; form grid `6 / 6` collapsing to `12`
below 1280.

### 2.2 z-index

| Layer | z |
| --- | --- |
| Sticky table header | 10 |
| Sticky TopBar | 20 |
| SaveBar | 30 |
| Dropdown / popover | 40 |
| Drawer scrim / drawer | 50 / 51 |
| Dialog scrim / dialog | 60 / 61 |
| Toast | 70 |

No two components may share a layer. `FilterFab` keeps its click-away layer and panel together at `z-40` (the
popover layer), below drawers and dialogs.

### 2.3 Density

Two densities, one token pair:

| Mode | Row | Control | Padding | Default for |
| --- | --- | --- | --- | --- |
| Comfortable | 40 px | 36 px | 12 / 16 px | forms, dashboard, detail |
| Compact | 32 px | 28 px | 8 / 12 px | directory, exam marks, history tables |

Persisted per user in `app_option` (the existing settings store), not per device.

---

## 3. Navigation

Current navigation has 7 groups for an admin, 25 items in the scrolling list plus 3 in the footer, and two labels
that read as the same destination (`Records` → `/records`, `Student Records` → `/student-records`). `Dashboard` sits
inside a group whose `defaultOpen={false}` hides it on first launch. The redesign keeps every destination but changes
grouping, default state and depth.

### 3.1 Information architecture

| Group (nav label, 11 px uppercase) | Items | Default |
| --- | --- | --- |
| Workspace | Overview (`/`), Inbox (`/inbox`), Direct messages (`/messages`) | open |
| Students | Student directory (`/student-records`), Student records — read-only (`/records`, director), Rewards & punishments (`/rewards-punishments`) | open |
| Teaching | Schedule (`/schedule`), My schedule (`/teacher-schedule`, `/student-schedule`), Exams (`/exams`), Exam marks (`/exam-marks`), My marks (`/student-marks`), Documents (`/documents`) | open |
| Administration | People (`/teachers`), Statistics (`/statistics`), Academic (`/academic`), Majors, Sections, Teaching categories, Classrooms, Session types, Grades, Promotions | collapsed |
| Student file | Absences (`/absences`), Observations (`/observations`), Notifications (`/notifications`), Student history (`/student-history`), Global history (`/global-history`) | collapsed |
| Support | Report a bug, Bug reports, Changelog, Beta test reports | collapsed |
| Footer | Settings, Profile, Environment status, Logout | always visible |

Today two differently labelled items (`Records`, `Student Records`) open two different screens that read as the same
destination. The admin/secretary item becomes **Student directory** and opens the list, with the inspector carrying the
editing surface. The director's `/records` keeps its screen but is labelled **Student records — read-only** and reuses
the same inspector in read-only mode, so the two routes differ by permission, not by layout.

### 3.2 Role → primary workflow

| Role | Primary task | 1-click entry | Depth to task |
| --- | --- | --- | --- |
| Admin | Register / correct a student, enter marks | Overview → work queue row | 1 |
| Secretary | Register a student in an owned teaching category; record punishments | Directory → "Register student" | 1 |
| Teacher | Record absences and observations for today's sessions | Overview → Today → row action | 1 |
| Director | Review notifications, export a student PDF | Overview → queue / Directory → Open record → Export | 2 |
| Student | Check next session and marks | Nav → My schedule / My marks | 1 |
| Scheduler | Resolve room/teacher conflicts | Nav → Schedule | 1 |

No primary task may exceed 2 clicks from Overview. The command palette (`Ctrl/⌘ K`) indexes every route, every
student by name and id, and every page-level action; it is the escape hatch for the 40-route surface, not a substitute
for grouping.

### 3.3 Sidebar item spec

| Property | Value |
| --- | --- |
| Item height | 32 px (comfortable), 16 px horizontal padding, 8 px vertical rhythm |
| Icon | 16 px, `ink-3`; active icon `primary-600` |
| Label | 13 px / 500, `ink-2`; active 600 `ink` |
| Active state | `primary-50` fill, 2 px `primary-600` inset bar on the inline-start edge, no gradient, no shadow |
| Hover | `surface-muted`, 120 ms |
| Focus-visible | 2 px `primary-500` ring, 2 px offset |
| Badge | 16 px pill, `danger` fill, 10 px 700 text, max `99+` |
| Collapsed rail | Icon centred, label in a 8 px-radius tooltip after 400 ms; badge becomes a 6 px dot |

Header: brand 56 px (`eNote` 16/600 `ink`, "Academic management" 11/500 `ink-3`), no gradient tile, no `theme-pinned`.
Footer: environment status 40 px (a 6 px dot + "Connected" / "Offline" + tooltip), user 56 px opening the avatar menu
(Profile, Settings, Theme, Logout).

---

## 4. Screen A — Overview (primary operational view)

Purpose: decide what to do next in under five seconds. No greeting, no illustration, no decorative metric.

### 4.1 Structure

```
┌ PageHeader 56 ──────────────────────────────────────────────────────────────┐
│ Overview                                          [Term: 2026–27 ▾] [⌘K]    │
├ KPI strip 72 ───────────────────────────────────────────────────────────────┤
│ Students 1,284 │ Marks entered 73% │ Unjustified absences 12 │ Open exams 3  │
├───────────────────────────────────────────┬─────────────────────────────────┤
│ Work queue (8 cols, card, no header row   │ Today (4 cols, 320 min height)  │
│ beyond "Needs attention · 6")             │ 08:30  LMD 2 · Amphi A  [now]   │
│  ● Students without a section      14  →  │ 10:15  LMD 1 · Salle 12         │
│  ● Exam marks missing           3 exams → │ 14:00  LMD 3 · Lab 2            │
│  ● Absences awaiting proof          12  → │ ─────────────────────────────── │
│  ● Observations not reviewed         5  → │ Recent (4 cols)                 │
│  [View all 37]                            │ · 09:41 A. Haddad updated       │
├───────────────────────────────────────────┴─────────────────────────────────┤
│ (nothing below the fold: no activity cards, no "insights")                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 KPI strip

Exactly four cells, max; each cell is a link to the filtered list it describes.

| Property | Value |
| --- | --- |
| Container | `surface`, 1 px `line`, radius `md`, 1 px internal dividers (`line`), height 72 |
| Label | 12/500 `ink-3`, one line, truncate with title |
| Value | 24/600 `ink`, tabular numerals, right of nothing — left aligned under the label |
| Context | 12/400 `ink-3`, one clause: "6 without a section", "▲ 4 this week" |
| Hover | cell background `surface-muted`, no lift, no shadow change, 120 ms |
| Loading | 96 × 24 px skeleton bar, label stays visible |
| Error | value "—", context "Couldn't load" + retry icon button |
| Forbidden here | icons, sparklines, gradients, delta badges in colour |

Per-role cells: staff (admin/secretary/director) — Students, Sections, Marks entered, Unjustified absences; teacher —
Sessions today, Marks due, Absences recorded this week, Observations recorded; student — Next session, Marks
published, Documents, Average; scheduler — Sessions this week, Unassigned rooms, Teacher conflicts.

### 4.3 Work queue

A table, not a card grid: one row per actionable condition, capped at 6 + "View all N".

| Column | Width | Content |
| --- | --- | --- |
| Severity | 24 | 6 px dot: `danger` (blocking), `warning` (due), `info` (FYI) + visually hidden label |
| Item | flex | 13/500 `ink`: "Students without a section" |
| Detail | 200 | 13/400 `ink-3`: "Cannot be assigned to exams" |
| Count | 64, right | 13/600 tabular |
| Age | 80 | 12/400 `ink-3`: "3 days" |
| Action | 120 | Text button, verb-first: "Assign", "Review", "Enter marks" |

Rows are 40 px, hairline separators, hover `surface-muted`, whole row is clickable, the action button stops
propagation. The count column links to the pre-filtered directory or exam screen; the filter arrives as a chip, so the
target screen shows *why* it is filtered ("Missing section ×").

Per-role sources (all already in the schema/services):

| Role | Queue items |
| --- | --- |
| Admin | Students without section; exams with unentered marks; bug reports triaged `new`; teachers without categories |
| Secretary | Students in owned categories missing insurance card; punishments recorded this week awaiting note |
| Teacher | Today's sessions without attendance; marks due for taught sections; observations flagged for follow-up |
| Director | Unreviewed observations; unread director notifications; unjustified absences over 3 days |
| Scheduler | Sessions without room; teacher double-booking |

Empty state: one line, 40 px: "Nothing needs attention." + `Last checked 09:41` as 12/400 `ink-3`. No illustration.
Loading: 4 skeleton rows. Error: "Couldn't load your queue." + "Retry" text button, inside the card, not a toast.

### 4.4 Today

Ordered list, 40 px rows, time in 13/600 tabular `ink` (24-hour), title 13/500, room 12/400 `ink-3`, trailing action
"Attendance" only for the current or next session. The current session row has a `primary-50` fill and a 2 px inset bar;
past rows drop to `ink-3` and lose their action. After the last item: "No more sessions today." at 12/400.

Recent: five events maximum, 32 px rows, "09:41 · A. Haddad · Record updated", each linking to its entity. No avatars,
no relative timestamps beyond 24 h ("Yesterday", then dates).

### 4.5 Removed from the current dashboard

`Welcome back, {user}!`, "Signed in as … Here is the latest status of your workspace.", the four-tile Quick Actions
grid, gradient icon chips, `hover:-translate-y-0.5`, `StatCard`'s `group-hover:scale-105`, and
"No statistics available yet for your role." Actions that were in Quick Actions move to the page header of their own
screen and to the work-queue row actions.

---

## 5. Screen B — Student directory (data & management view)

Currently a 3-column card grid, 10 per page, sorting in a toolbar select, no multi-select, no batch action, and the
scope banner consumes 60 px above the toolbar.

### 5.1 Structure

```
┌ PageHeader 56 ───────────────────────────────────────────────────────────────┐
│ Student directory            [Export CSV]  [+ Register student]              │
├ Scope notice 36 (only when restricted) ──────────────────────────────────────┤
│ ⓘ You can edit students in LMD 1, LMD 2. Other categories are read-only.     │
├ Toolbar 52 ──────────────────────────────────────────────────────────────────┤
│ [Search name or id        ] [Category ▾] [Section ▾] [Status ▾]  ↕ Sort ▾    │
│                                          Table | Gallery   Density   Columns  │
├ Selection bar 52 (replaces toolbar when rows are selected) ──────────────────┤
│ 3 selected  [Clear]              [Assign section] [Export] [Delete]          │
├ Table (sticky header 36) ────────────────────────────────────────────────────┤
│ ☐  Student            Sex  Born      Category   Section   Status    Actions  │
│ ☐  A. Haddad  #1042   F   04/2005   LMD 1      S-12      Active    ⋯        │
├ Pagination 48 ───────────────────────────────────────────────────────────────┤
│ 1–25 of 1,284        Rows: 25 ▾     ‹ 1 2 3 … 52 ›                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Toolbar

| Element | Spec |
| --- | --- |
| Search | 280 px, 36 px high, icon 16 px `ink-3`, placeholder "Search name or ID", `Ctrl/⌘ F`-style `/` focuses it; debounce 150 ms |
| Filter chips | Each active filter is a 28 px chip: label, value, 14 px ×. Removing a chip re-runs the query and returns focus to the toolbar |
| Filter menu | "Add filter" opens a 40-layer popover with checkbox lists (Category, Section, Status, Sex, Academic level). Applied filters stay visible as chips — never hidden behind a FAB |
| Sort | Menu, single key: Name, ID, Birthdate, Category, Section, Status. The column header itself is the primary control (`aria-sort`) |
| View | Segmented "Table / Gallery", 28 px, persisted; Table is the default |
| Density | Compact / Comfortable icon toggle |
| Columns | Popover of checkboxes; the first two columns (selection, Student) are not removable |
| Primary | "Register student", 36 px, 132 px min, `primary-600`; disabled with tooltip when the secretary has no owned category |

The floating "Filters" FAB (`FilterFab.jsx`) is retired. Floating controls cover the last rows of a table and hide state;
the same fields become inline chips + popover.

The restricted-scope notice stays but becomes a 36 px inline strip: `info` icon 14, 12/500 text, `warning-bg`,
1 px `warning` border at 25 % — or a neutral strip when the user has read-only access rather than a restriction.

### 5.3 Table

| # | Column | Width | Content | Align |
| --- | --- | --- | --- | --- |
| 1 | Select | 40 | Checkbox 16 px; header checkbox = page selection, indeterminate on partial | center |
| 2 | Student | 228 | 24 px initials avatar (neutral, not gendered gradient), name 13/500, `#1042` 12 mono `ink-3` | start |
| 3 | Sex | 52 | "F" / "M" — never a coloured pill | start |
| 4 | Born | 92 | `04/2005`, tabular | start |
| 5 | Category | 132 | Truncate, title tooltip | start |
| 6 | Section | 116 | Truncate; "—" when unassigned | start |
| 7 | Insurance | 140 | Mono 12, copy-on-click | start |
| 8 | Status | 108 | Dot + label: Active, Unassigned, Read-only | start |
| 9 | Actions | 64 | `⋯` menu: Open record, Edit details, Sections, Export, Delete | end |

Optional columns (hidden, via Columns): military card, helmet, blood type, speciality, academic level, phone. Total
default width 972 px = 1280 window − 260 sidebar − 48 page inset. Below that, the table scrolls horizontally and the
selection + Student columns stay pinned.

Header 36 px, `surface-muted`, 11/600 uppercase `ink-3`, `aria-sort` on the active column with a 12 px caret.
Body rows 32 px compact / 40 px comfortable; separators are 1 px `line`; no zebra striping.

Row states:

| State | Visual |
| --- | --- |
| Default | `surface`; text `ink` |
| Hover | `surface-muted`; row actions become visible |
| Focus-visible | 2 px `primary-500` inset ring on the row; `j`/`k` move the ring |
| Selected | `selection` fill + 2 px `primary-600` inset on the inline-start edge; checkbox checked |
| Open in inspector | `primary-50` fill + 2 px inset; persists while the inspector is open |
| Read-only (out of scope) | Checkbox disabled, name `ink-2`, trailing lock icon 12 px with tooltip "Managed by another administrator" |
| Unassigned | Section cell "—" + `warning` dot before the status label |
| Loading | 8 skeleton rows, same column widths, `role="status"` |
| Error | Full-width row: "Couldn't load students." + "Retry"; keeps the toolbar interactive |

Gallery view: 3-up cards, 200 px min width, 24 px avatar, name + id, category/section, status dot. No gradients, no
hover lift; selection checkbox top-right; card opens the same inspector.

### 5.4 Selection and batch actions

Selection is per page by default, with "Select all 1,284 matching" as an inline link in the selection bar once the page
is fully selected. The bar replaces the toolbar in place (no floating overlay) and shows: `3 selected` · Clear on the
left; `Assign section`, `Export CSV`, `Delete` on the right (danger text button, not a red fill until hover).

| Action | Behaviour |
| --- | --- |
| Assign section | Dialog 480 px: section select + "This moves 3 students from LMD 1 to S-14." + Cancel / "Assign section" |
| Export CSV | Exports the current filter + selection, filename `students-2026-10-22.csv`; toast "Exported 3 rows" |
| Delete | Confirm dialog naming the count and requiring the count typed when > 10: "Delete 12 students? This removes their records, marks, absences and observations. Type 12 to confirm." |

Bulk delete is hidden for secretaries; row delete is limited to owned categories (existing scope logic).

### 5.5 Pagination

`1–25 of 1,284` left; rows-per-page 25 / 50 / 100 right; first, previous, numbered pages with ellipsis, next, last.
Page changes keep scroll position at the table top (offset by the sticky header) and preserve selection. The current
`Pagination` component is reused with restyled tokens; `PAGE_SIZE` moves from 10 to 25.

### 5.6 Keyboard

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `j` / `k` | Move row focus |
| `x` | Toggle selection on the focused row |
| `Enter` | Open the inspector |
| `Shift + click` | Range select |
| `Esc` | Close inspector, then clear selection |
| `Ctrl/⌘ K` | Command palette |

---

## 6. Screen C — Student inspector (detail & form)

Two presentations of one component, so editing never leaves the list:

1. **Drawer** — 480 px, docked right, from a directory row. Read-first, with "Edit details" escalating to the full record.
2. **Record pane** — the Records view of `/student-records` (and the director's `/records` consult screen), `300 px`
   student list + remainder. Full six-tab editor for admin, read-only for director.

### 6.1 Drawer

```
┌ Scrim (content, 50) ──────────────────────────────┬ Drawer 480 (51) ───────────┐
│                                                   │ Haddad, Amina        [×]  │
│                                                   │ #1042 · LMD 1 · S-12      │
│                                                   ├───────────────────────────┤
│                                                   │ Identity (summary 4 rows) │
│                                                   │ Contact, Family …         │
│                                                   │                           │
│                                                   ├───────────────────────────┤
│                                                   │ [Open full record]  [Edit]│
└───────────────────────────────────────────────────┴───────────────────────────┘
```

Header 64 px: name 20/600, meta 12/500 `ink-3`, close 32 px. Body scrolls with 20 px padding and definition lists
(label 12/500 `ink-3` 96 px, value 13/400 `ink`). Footer 64 px, `surface`, top border: secondary "Open full record",
primary "Edit details". Opens with `focus` on the drawer container, `role="dialog"` `aria-modal="true"`,
`aria-labelledby` on the name; `Esc` closes; scrim click closes only when pristine; focus returns to the originating row.

### 6.2 Record pane

```
┌ RecordPage ────────────────────────────────────────────────────────────────────┐
│ Student records                                    [Export report (PDF)]       │
├───────────────┬────────────────────────────────────────────────────────────────┤
│ Student list  │ Sticky identity header 72                                      │
│ 300           │  [AH] Haddad, Amina  #1042          LMD 1 · S-12   [Active]     │
│ [search    ]  ├────────────────────────────────────────────────────────────────┤
│ ▸ Haddad, A.  │ Identity  Health  Schooling  Family  Contacts  Uniforms         │
│   Bouzid, K.  ├────────────────────────────────────────────────────────────────┤
│   …           │ Form: 2 columns (6/6) ≥1280, 1 column below                     │
│               │                                                                │
│               ├────────────────────────────────────────────────────────────────┤
│               │ 3 unsaved changes              [Discard]  [Save changes]        │
└───────────────┴────────────────────────────────────────────────────────────────┘
```

| Region | Spec |
| --- | --- |
| Student list | 300 px, own scroll, search 32 px, rows 44 px: initials 28, name 13/500, section 11/400 `ink-3`; selected row `selection` + 2 px inset; a `•` marks rows with unsaved edits |
| Identity header | 72 px, sticky under the top bar; avatar 40, name 20/600, mono id, category/section chips 24 px, status pill |
| Tabs | Underline tabs 40 px, 13/500, active 2 px `primary-600` underline and `ink` text; horizontal scroll below 720 px of pane width; `role="tablist"` with arrow-key support |
| Form grid | 24 px gutters, 20 px vertical rhythm, fields 36 px high, label 12/500 above, help 12/400 below, error 12/500 `danger-ink` |
| SaveBar | 56 px, pinned to the pane bottom; left status text, right Discard + Save |

Tab set = the existing six (`Identity`, `Health & body`, `Documents & schooling`, `Family`, `Emergency contacts`,
`Uniforms`) plus a director-only read-only `School history` tab folding `/student-history` in. The seventh tab that
exists only in the registration dialog (`Section`) stays in the registration flow.

### 6.3 Form behaviour

| Concern | Spec |
| --- | --- |
| Dirty state | Field-level change tracking; a dot on the tab, count in the SaveBar ("3 unsaved changes"), Save enabled |
| Save | Explicit only. Primary button 120 px min: "Save changes" → spinner + "Saving…" → "All changes saved" for 2.4 s |
| Validation | On blur and on submit. Field error under the control, `aria-invalid` + `aria-describedby`; a summary strip at the top of the pane: "2 fields need attention" with anchor links; first invalid field receives focus and scrolls under the sticky header (`scroll-margin-top: 72px`) |
| Failed save | Inline `danger-bg` strip above the SaveBar: "Couldn't save. Your changes are still here." + "Retry". SaveBar remains dirty; no data is discarded |
| Conflict | If the record changed server-side: "This record changed while you were editing. Reload to see the current values." + "Reload" (discards local edits only after confirm) |
| Read-only (director) | Controls replaced by values, SaveBar hidden, a 32 px strip: "Read-only — a director can view records but not edit them." |
| No permission | Whole pane replaced by one message: "You don't have permission to edit student records." + "Back to directory" |
| Unsaved close | Dialog: title "Discard unsaved changes?", body "3 changes to Amina Haddad's record haven't been saved.", buttons "Keep editing" (primary) / "Discard changes" (danger) |
| Missing photo | Neutral 40 px avatar with initials; the PDF uses the same anonymous placeholder, not a generic user glyph |
| Multilingual fields | `LocalizedInput` renders `_en`/`_ar`/`_fr` in a 3-column row (2 for `_la`/`_ar`), each with a 11 px language tag; `dir="rtl"` on Arabic inputs; the primary language is required and marked with `*` |

### 6.4 Export report dialog (director)

520 px dialog, three fieldsets, no wizard:

| Block | Content |
| --- | --- |
| Student | Name + id, fixed, with a "Change" link back to the list |
| Include | Checkboxes, all checked by default: Identity summary, Photo, Absences, Observations, Rewards, Punishments. Counts shown in 12/400 `ink-3` |
| Language | Radio row: English, العربية, Français (disabled with tooltip "French report is not available yet") |
| Footer | "Cancel" / "Export PDF" (primary, shows spinner while generating) |

Validation: at least one include option; otherwise "Select at least one section to export." and the primary stays
enabled so the error is visible. Success: toast "Report downloaded" with a "Show file" action.

---

## 7. Component state matrices

Every interactive component defines all seven states. `—` means the state does not exist for that component.

### 7.1 Button

| Variant | Default | Hover | Active | Focus | Disabled | Loading | Error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Primary | `primary-600` bg, white 14/600, `sm` radius, 36 h | `primary-700` | `primary-700` + 1 px translate-y | 2 px `primary-500` ring, 2 px offset | 40 % opacity, `not-allowed`, no pointer events | Spinner 14 px replaces icon, label "Saving…", width locked, `aria-busy` | — |
| Secondary | `surface`, 1 px `line-strong`, `ink` | `surface-muted` | `surface-sunken` | ring | same | same | — |
| Ghost | transparent, `ink-2` | `surface-muted` | `surface-sunken` | ring | same | same | — |
| Danger | `surface`, 1 px `danger` at 30 %, `danger-ink`; fill only on confirm dialogs | `danger-bg` | `danger-bg` darker 4 % | ring | same | same | — |
| Text/link | `primary-600`, no padding | underline | underline + `primary-700` | ring | 40 % | — | — |

Press feedback is 120 ms on background only; no `active:scale`, no shadow growth, no gradient. Minimum target 32 × 32
(icon buttons), 36 px height otherwise; label padding 12 px horizontal, 16 px for dialogs.

### 7.2 Input / select / textarea

| State | Border | Fill | Text | Notes |
| --- | --- | --- | --- | --- |
| Default | 1 px `line-strong` | `surface` | `ink` 14/400 | Placeholder `ink-3`, identical in both themes |
| Hover | `line-strong` darkened 8 % | `surface` | — | No colour change |
| Focus | 1 px `primary-600` + 3 px `primary-100` ring | `surface` | — | Ring is the focus indicator, not an outline |
| Filled | `line-strong` | `surface` | `ink` | — |
| Disabled | 1 px `line` | `surface-muted` | `ink-disabled` | Tooltip explains why when the reason is non-obvious |
| Read-only | none | transparent | `ink-2` | Used in director mode |
| Loading | skeleton 36 px, 60 % width | — | — | Async option lists only |
| Invalid | 1 px `danger` | `surface` | `ink` | 12/500 `danger-ink` message + 14 px icon; `aria-invalid` |
| Error (load) | 1 px `danger` | `danger-bg` | `danger-ink` | "Couldn't load categories." + Retry |

Selects keep a native `<select>` for long lookup lists (countries, wilayas, sections) — keyboard behaviour and
type-ahead come free — styled with the same tokens. Searchable comboboxes are used only where the list exceeds 50
options.

### 7.3 Checkbox, radio, switch

16 px box, 4 px radius, 1 px `line-strong`; checked = `primary-600` fill with white check; indeterminate = 8 px white
dash; focus ring 2 px `primary-500` offset 2; disabled 40 %; the whole label is the target (min 32 px row height).
Radios are 16 px circles with a 6 px dot. No custom switch is introduced; boolean student fields stay as radio Yes/No.

### 7.4 Table row and navigation item

| Component | Default | Hover | Active/Selected | Focus | Disabled |
| --- | --- | --- | --- | --- | --- |
| Row | `surface` | `surface-muted` | `selection` + 2 px inset `primary-600` | inset ring | 55 % text, lock icon |
| Nav item | transparent | `surface-muted` | `primary-50` + 2 px inset bar | ring | — |
| Tab | `ink-3`, transparent | `ink` + `surface-muted` | `ink` + 2 px `primary-600` underline | ring, offset −2 | `ink-disabled` |

### 7.5 Badge / status

24 px high, 4 px radius, 11/600, 8 px horizontal padding, dot 6 px + label. Never colour alone: the label always names
the state.

| Status | Fill | Text |
| --- | --- | --- |
| Active | `success-bg` | `success-ink` |
| Pending / due | `warning-bg` | `warning-ink` |
| Overdue / destructive | `danger-bg` | `danger-ink` |
| Read-only / neutral | `surface-muted` | `ink-2` |
| Informational | `info-bg` | `info-ink` |

### 7.6 Feedback surfaces

| Surface | Spec | Behaviour |
| --- | --- | --- |
| Inline notice | 36–44 px strip, 1 px border at 25 %, icon 14, 12/500, radius `sm` | Dismissible; used for scope and read-only |
| Toast | 320 px, `surface`, `e2`, 12/500, 4 s auto-dismiss, max 3 stacked, bottom-inline-end 16 px above the SaveBar | Success and background completion only; error toasts persist with "Retry" |
| Dialog | `surface`, radius `lg`, `e3`, 520 max width, scrim `#131518` at 55 %, 20 px padding | Focus trap via Radix, `Esc`, initial focus on the least destructive action |
| Drawer | 480 px, `surface`, `e3`, scrim 40 % | `Esc`, focus return, no scroll bleed |
| Skeleton | `surface-sunken` at 60 %, 4 px radius, **static** (no pulse) | Only after 300 ms of loading |
| Spinner | 14 px, 2 px stroke, `primary-600` | Only after 300 ms; 120 ms minimum visible once shown |
| Empty | 40 px icon `ink-3`, 14/500 title, 13/400 one-line reason, one action | No illustrations |

### 7.7 Destructive confirmation

Dialog copy pattern: title states the object and count, body states the consequence, primary repeats the verb.

```
Delete 3 students?
This removes their records, marks, absences and observations. This cannot be undone.
[Cancel]  [Delete 3 students]        ← danger fill on the confirm, focus starts on Cancel
```

---

## 8. Motion and feedback

| Interaction | Motion | Duration | Easing |
| --- | --- | --- | --- |
| Hover / press | background, border, colour | 120 ms | `--ease-standard` |
| Row reveal, tooltip | opacity | 120 ms | `--ease-standard` |
| Popover, menu, select | opacity + 4 px translate | 160 ms | `--ease-standard` |
| Dialog | opacity + scale 0.98 → 1 | 180 ms | `--ease-standard` |
| Drawer | translate 16 px + opacity | 220 ms | `--ease-standard` |
| Tab panel change | opacity only, no slide | 120 ms | `--ease-standard` |
| Save confirmation | 1.2 s checkmark then label | 2.4 s state | — |

Policy:

- No infinite animation anywhere. `animate-float`, `animate-pulse-soft`, skeleton pulsing and hover `translate-y`
  are removed.
- No animation of layout properties (`width`, `height`, `top`, `left`); no `scale` on hover.
- One transition per interaction; the global `* { transition-property: … }` rule in `index.css` is deleted and
  transitions are declared on components.
- Loading order: 0–300 ms nothing; 300 ms–1 s skeleton; > 1 s skeleton + explanatory 12/400 line.
- Errors appear next to the control or the action that failed, not only as a toast.
- Rate-limit duplicate submissions: primary button enters Loading immediately on submit.
- `prefers-reduced-motion: reduce` and the app's battery mode set `data-motion="reduced"` on `<html>`, which removes
  all non-essential transitions, drawer/dialog transforms (opacity only), and skeleton shimmer.
- Battery mode additionally disables the dashboard's "recent" live refresh and the 60 s presence/sidebar polling
  intervals (2 min instead), keeping the app's stated performance/battery split a token-toggled behaviour rather than
  a second theme.

---

## 9. UX copy

Rules: sentence case; verb + object on every action; the button label repeats in the confirmation; no "click here",
"submit", "process", "OK", "manage" alone; no exclamation marks; no greeting prose.

| Location | Current | Replacement |
| --- | --- | --- |
| Sidebar | Student Records | Student directory |
| Sidebar | Rewards & Punishments | Rewards & punishments |
| Sidebar | Session Types | Session types |
| Sidebar | Report a Bug | Report a bug |
| Directory button | Add Student | Register student |
| Directory modal title | Register New Student | Register student |
| Directory modal title | Edit Student Details | Edit student |
| Card action | Manage | Sections |
| Row action | Edit Student (tooltip) | Edit student |
| Record header | Generate PDF | Export report (PDF) |
| Save feedback | Saved | All changes saved |
| Save action | (none) | Save changes |
| Dashboard | Welcome back, {name}! | (removed) |
| Dashboard | Here is the latest status of your workspace. | (removed) |
| Empty table | No records found | No students registered yet. **Register student** |
| Filtered empty | No students match your filters | No students match these filters. **Clear filters** |
| Loading | Loading… | Loading students… |
| Delete confirm | (generic) | Delete 3 students? … **Delete 3 students** |
| PDF title | Student Report | Student report |
| Export failure | (raw error) | Couldn't export the report. Try again. |

Patterns:

| Kind | Formula | Example |
| --- | --- | --- |
| Empty | what is absent + why (optional) + one action | "No observations this week. Record one after class." |
| Error | what happened + is data safe + what to do | "Couldn't save. Your changes are still here. Retry." |
| Validation | the fix, not the failure | "Enter a birthdate in DD/MM/YYYY." |
| Destructive | object + count + consequence | "Delete 12 students? This also removes their marks and absences." |
| Success | past tense + object | "3 students moved to S-14." |
| Permission | what you can do instead | "Read-only. Ask an administrator to grant you LMD 2." |

Numbers and dates: `1,284` (grouping), `22 Oct 2026` in tables, `22 October 2026` in prose, 24-hour times `14:05`,
dates entered `DD/MM/YYYY`, ids rendered `#1042`. French locale uses narrow no-break spaces for grouping; Arabic
locale uses Arabic-Indic digits and RTL layout — all numerals set `dir="ltr"` inside RTL text.

---

## 10. Accessibility

| Requirement | Spec |
| --- | --- |
| Focus | 2 px `primary-500` ring + 2 px offset on every interactive element, light and dark; `:focus-visible` only; never `outline: none` without a replacement |
| Contrast | 4.5:1 body, 3:1 large text and UI boundaries (tokens in 1.3) |
| Targets | 32 × 32 minimum, 36 × 36 default, 8 px separation |
| Tables | `<table>` with `<caption class="sr-only">`, `<th scope="col">`, `aria-sort`, checkbox column labelled "Select Amina Haddad" |
| Drawer / dialog | `role="dialog"`, `aria-modal`, labelled by title, focus trap and restore (Radix handles both) |
| Live regions | Save status, filter result count and export completion are `aria-live="polite"`; errors `assertive` |
| Sticky offsets | `scroll-margin-top: calc(var(--topbar-h) + 8px)` on fields and headings so focus is never hidden |
| Colour independence | Every status pairs a dot with a label; read-only adds a lock icon; selected rows add an inset bar |
| Motion | Honours `prefers-reduced-motion` and `data-motion="reduced"` |
| Keyboard | Full path for search → filter → row → inspector → tab → field → save without a pointer |
| Zoom | Layout holds at 125 % (≈ 1024 × 576 effective); no fixed-height text containers |

---

## 11. Implementation map

| File | Change |
| --- | --- |
| `src/renderer/index.css` | Replace `@theme`, delete the `.dark` neutral inversion and `.theme-pinned`, delete global transition rule, `animate-float`/`pulse-soft`/glass helpers; keep `@custom-variant dark`; add the layout metrics block |
| `src/renderer/components/ui/Button.jsx` | Four variants, no gradient, no `active:scale`, loading prop, sizes 28/36/44 |
| `src/renderer/components/ui/TableToolbar.jsx` | Inline chips, filter popover, density + columns menus, actions slot |
| `src/renderer/components/ui/FilterFab.jsx` | Retired as a floating control; the component is now an inline toolbar filter menu (name kept to avoid touching every import) |
| `src/renderer/components/ui/Pagination.jsx` | Restyle, add first/last and page size |
| `src/renderer/components/ui/Modal.jsx` | Radius `lg`, `e3`, 520 default width, scrim token, focus initial on Cancel for destructive |
| `src/renderer/components/ui/TableEmptyState.jsx`, `CardStates.jsx` | Static skeletons, entity-specific copy, optional action |
| `src/renderer/components/Sidebar.jsx` | Regrouped sections, collapsed rail, active bar, status/user footer |
| `src/renderer/components/Layout.jsx` | 56 px top bar (breadcrumb, palette trigger, theme, avatar), remove duplicate app name/role/DB chips, page max-width and gutters |
| `src/renderer/components/Dashboard.jsx` | Rewrite as KPI strip + work queue + today + recent |
| `src/renderer/components/StudentDirectory.jsx` | Table view, 25/page, batch bar, column spec, row states; gallery behind the toggle |
| `src/renderer/components/StudentProfile.jsx` | Master-detail, six tabs, SaveBar, dirty guard, read-only mode |
| `src/renderer/components/StudentReportDialog.jsx` | Restyle to the 520 px spec, add language availability state |
| `src/renderer/theme.js` | Add density and motion preferences beside the theme key |

Phasing — each phase ships independently and leaves the app working:

| Phase | Content | Acceptance |
| --- | --- | --- |
| P0 | Tokens, dark mode, shell, sidebar, density | No indigo/gradient class remains in `src/renderer`; contrast script passes; nav reachable by keyboard |
| P1 | Directory table + bulk actions | 25 rows/page at 1280 × 800; filter → chip → clear cycle; batch move and delete; full keyboard path |
| P2 | Inspector + record pane + PDF dialog | Dirty guard, validation focus, read-only director path, export in EN/AR only |
| P3 | Dashboard rewrite | Four KPI cells, six queue rows, today list; no welcome banner or quick-action grid |
| P4 | Copy pass and empty/error states | Every string in section 9 applied; no `Saved`/`No records found` left |

Verification for each phase: `npm run build`, a keyboard-only pass on the screen, an RTL screenshot with `dir="rtl"`,
and a contrast check of every new foreground/background pair with the formula used in 1.3.

---

## 12. Anti-slop checklist (applies to every review)

- No decorative hero, illustration, glow, grid background, or metric that does not link to an action.
- No gradient fills; no drop shadow on hover; no element that lifts or scales on hover.
- No infinite animation; no animation over 320 ms.
- No radius above 10 px except pills and avatars.
- No colour-only state; no badge without a word.
- No floating filter button over data; no modal for a single field; no drawer nested inside a drawer.
- No welcome banner, greeting, or "Welcome back".
- No placeholder copy ("Coming soon", "Your text here"); if a feature is absent, the control is absent.
- No `rounded-2xl`/`rounded-3xl`, `from-blue-600 to-indigo-600`, `hover:-translate-y`, or `shadow-xl shadow-blue-500/*`
  in new code.
