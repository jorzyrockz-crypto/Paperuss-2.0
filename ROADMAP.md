# PapeRuss 2.0 — Product Roadmap & Release Timeline

An overview of completed milestones, active feature branches in development, and the future release timeline for **PapeRuss 2.0**.

---

## 🌿 Botanical Workspace Architecture (`Leaf ➔ Leaves ➔ Leafline ➔ Canopy`)

PapeRuss 2.0 structures note workspaces using an organic botanical hierarchy:

```
                           CANOPY (v3.2.0)
               Overarching Spatial Mind-Map & Canvas
                                │
                         LEAFline (UI)
              Navigation Line & Tab-Strip Header
                                │
                          LEAVES (Store)
                  Array of Sub-Note Tabs in Note
                                │
                          LEAF (Document)
                   Single Rich-Text Sub-Note
```

- 🍃 **Leaf**: A single rich-text sub-note document or tab inside a Note workspace.
- 🌿 **Leaves**: The collection array of sub-note tabs contained inside a Note workspace (`fix/leaf-implementation`).
- 🌿 **Leafline**: The UI navigation bar (`.leafline-ui` in `js/leafline.js`) displaying the breadcrumb tree of headings and sub-note tabs at the top of the editor.
- 🌳 **Canopy**: The top-level visual spatial mind-map graph (`v3.2.0`) where all Leaves and Leaflines branch together under an overarching workspace tree!

---

## 🚀 Active Feature Branches (In Progress)

| Branch Name | Feature Scope | Target Release |
| :--- | :--- | :--- |
| **`feature/smart-date-time-suggestions`** | Natural Language Processing (NLP) for date & time suggestions (`@tomorrow 9am`, `due next monday`) | **v2.4.0** |
| **`feature/print-page-improvement`** | Pixel-perfect PDF Export Suite & High-Res Print Adaptability Engine | **v2.5.0** |
| **`fix/leaf-implementation`** | Multi-Leaf sub-note tab management, tab re-ordering & IndexedDB branching | **v2.4.0** |

---

## 📅 Future Release Timeline

```
                     PAPERUSS 2.0 ROADMAP & FUTURE TIMELINE
 
   v2.4.0              v2.5.0              v2.6.0              v3.0.0              v3.2.0
 ┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐         ┌───────────┐
 │ Smart   │   ───►  │ PDF &   │   ───►  │ Data &  │   ───►  │ Cloud & │   ───►  │  CANOPY   │
 │ Date/   │         │ Print   │         │ Table   │         │ Team    │         │  SPATIAL  │
 │ Time NLP│         │ Suite   │         │ Formula │         │ Workspace│         │ CANVAS    │
 └─────────┘         └─────────┘         └─────────┘         └─────────┘         └───────────┘
   Q3 2026             Q3 2026             Q4 2026             Q1 2027             Q2 2027
```

### 🔹 v2.4.0 (Q3 2026) — Smart Date/Time NLP & Task Automation
- **Natural Language Parsing**: Type `@tomorrow 3pm`, `@next Friday`, or `every Monday` in any block to insert smart date badges.
- **Floating Date Picker Portal**: Position-aware autocomplete menu for dates, times, and recurring frequencies.
- **Task Hub Sync**: Automatically syncs date-tagged note blocks with the Task & Reminder Hub.

### 🔹 v2.5.0 (Q3 2026) — High-Res PDF Export & Print Suite
- **Pixel-Perfect PDF Generation**: Custom `@media print` engine with zero-margin overflow containment for cards, embeds, and tables.
- **Light Theme Reset**: Automatically flattens dark mode colors to crisp light themes for PDF output.
- **Print Preview Modal**: Live interactive print preview with margin adjustment sliders.

### 🔹 v2.6.0 (Q4 2026) — Advanced Data Tables & Formula Engine
- **Excel-Style Formulas**: Extended formula functions (`SUM`, `AVERAGE`, `COUNT`, `MIN`, `MAX`, `IF`).
- **Interactive Chart Engine**: 1-click conversion of table data into dynamic Bar, Line, and Pie charts.

### 🔹 v3.0.0 (Q1 2027) — Multi-User Collaboration & Encrypted Vault
- **Real-Time Peer Editing**: Live multiplayer cursors and operational transformation (CRDT) conflict resolution.
- **End-to-End Encrypted Vaults**: Client-side AES-256 encryption for private notes and offline attachments.

### 🌳 v3.2.0 (Q2 2027) — Canopy Spatial Engine & Infinite Canvas View
- **Visual Canopy Graph**: Infinite 2D/3D spatial canvas displaying notes, sub-leaves, audio tracks, and cards as connected nodes under a visual canopy tree.
- **Pan & Zoom Spatial Navigation**: 60fps vector canvas with mini-map overview, node clustering, and spatial search.
- **Automatic Mind-Map Layout**: Automatically organizes linked leaves into hierarchical tree canopy structures.

---

## 📜 Historical Release Archive

- **v2.3.0 (2026-08-09)** — Maximum DOCX Import/Export, Typography Suite & Dedicated Wrap Text Tool.
- **v2.1.0 (2026-08-07)** — System Music Player Hub & Draggable Background Player Widget.
- **v2.0.1 (2026-08-02)** — PWA Shell Caching, Calendar Recurrence & Reminder Stabilization.
- **v2.0.0 (2026-07-30)** — Official PapeRuss 2.0 Release (Block Editor, Firebase Cloud Sync, Task Hub).
