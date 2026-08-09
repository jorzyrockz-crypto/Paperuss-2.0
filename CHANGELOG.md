# Changelog

This file is generated from [GitHub Releases](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases).

## [v2.6.0-editor-suite](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — 2026-08-09

**PapeRuss 2.6 Page Layout, Formatting & Editor Suite**

### What's New in PapeRuss v2.6.0
- **6-Leaf Preseeded Master Note**: Refactored seed data into 1 comprehensive parent Note ("Welcome to PapeRuss 👋") containing 6 distinct Leaf tabs (Primary System Documentation, Formatting Suite, Spreadsheet & Formulas, Print Layout & PDF Engine, Music Hub & Media Studio, Leafline & Branch Tree) using official PNG artwork assets.
- **Homepage & Editor Route Separation**: Declared `index.html` as the public marketing landing page and `app.html` as the editor application/PWA entry point, wired via `firebase.json` hosting rewrites, `sw.js` offline caching, PWA `manifest.webmanifest`, and automated regression test assertions.
- **Print & Page Layout Engine**: Integrated Print Layout with Formal/Clean presets, binding margins, document aesthetic styles (Executive, Serif, Clean, Vintage, Paper), unified editable Header/Footer overlays, repeating table headers (`thead`), and Word-style curved page gaps.
- **Creative Headings & Typography Suite**: Added 5 creative heading options (Banner, Ribbon, Accent-Left, Underlined, Floating), enhanced selection font fallbacks, and Quote Style Context Panel with Literary, Tech, and Modern preset themes.
- **Leafline Timeline Outline**: Interactive document outline palette integrated into the Leaves drawer with a 3-segment list view switch (Notes, Leaves, Leafline) and note-level leafline entry navigation.
- **Custom Cursor & Accent Theme**: Custom SVG cursor asset engine (`paperuss-caret.svg`, `paperuss-text-caret.svg`, `paperuss-pointer.svg`, `paperuss-cursor.svg`) with accent-tinted typing insertion carets and Paper theme palette.
- **Auth Overlay & Rename Modal UI**: Elevated Auth landing overlay isolation (`z-index: 99999`), redesigned Editorial Glassmorphism "Rename Leaf" modal, and universal Image Toolbar support with automatic drop-target highlight line cleanup.

## [v2.4.0-branches-engine](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — 2026-08-09

**Branch Engine, Sidebar Categories & Notebooks, Leafline Integration & Print Suite**

### What's New in PapeRuss v2.4.0
- **Branch Engine & Sidebar Category Tree**: Collapsible sidebar tree (`#sidebarBranchTree`) displaying root branches and nested sub-branches with ChatGPT-style Lucide outline icons, custom accent colors, real-time note count badges, drag & drop note dropzones, and 3-dot More Menu dropdowns.
- **Full-Screen Frosted Glass Overlay Modal**: Re-architected Edit Branch into a full-screen frosted glass overlay backdrop (`.branch-modal-backdrop`).
- **Leafline Breadcrumb Path Navigation**: Dynamic topbar header displaying `🌿 Branch Name ▸ 📝 Note Title ▸ 🍃 Leaf Tab`.
- **Automatic Branch Category Note Creation**: New notes automatically inherit the active branch category with toast feedback.
- **Print & PDF Setup Suite**: Enhanced Print Modal featuring a Live Paper Thumbnail Preview column, Custom Header Title & Subtitle inputs, Paper Size (A4, Letter, Legal), Orientation (Portrait/Landscape), and Margin controls.
- **Text Wrap Clipping Resolution**: Fixed heading text clipping under floated cards by disabling BFC overflow clipping and enforcing 42% max-width for floated cards.
- **Floating 6-Dot Handle Cleanup**: Completely removed redundant floating 6-dot drag handles (`#blockDragHandle`) in favor of custom 100% direct Card & Text Drag Engines.
- **Botanical Architecture Documentation**: Added `ROADMAP.md` documenting the complete botanical hierarchy (`Branch ➔ Stem ➔ Leafline ➔ Leaves ➔ Leaf ➔ Veins ➔ Twig`) and future release schedule through v3.2.0.

## [v2.3.0-word-engine-hotfix](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — 2026-08-09

**Maximum Word Import/Export System, Typography Suite & Line Spacing Tool**

### What's New in PapeRuss v2.3.0
- **Maximum DOCX Import & Export Engine**: High-fidelity Word (.docx) import/export with `fontTable.xml` generation, preformatted code shading, blockquote accents, strikethrough/highlight WML runs, superscript/subscript, multi-level list numbering (levels 0-8), table header repetition (`w:tblHeader`), table row split prevention (`w:cantSplit`), table cell shading/alignment, storage quota pre-checks, responsive table containers, section length safeguards, and 1-click Leaf merging (`mergeAllLeavesAction`).
- **Expanded Native Typography Suite**: Added 9 native font choices across the editor and Word export pipeline (**Calibri**, **Segoe UI**, **Georgia**, **Consolas**, **Arial**, **Inter**, **Rounded**, **Bookman Old Style**, and **Old English Text MT**).
- **Line Spacing Tool & Dropdown**: Dedicated toolbar picker with 1.0, 1.15, 1.5, 2.0, 2.5, and 3.0 options, glassmorphism backdrop-filter blur, option badges, and fixed portal positioning (`z-index: 100000`).
- **Highlighted Text Selection Isolation**: Re-architected formatting execution so font styles, sizes, highlights, colors, and inline tags apply strictly to the user's active highlighted selection range.

## [v2.1.0-music-hub](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — 2026-08-07

**System Music Player Hub & Link Embed Enhancements**

### What's New in PapeRuss v2.1.0
- **System Music Player Hub Modal**: Centralized Music Player accessible via bottom bar `[ 🎵 Music Player ]` pill button and sidebar navigation menu.
- **Draggable Floating Background Media Player Widget**: Continuous, uninterrupted audio playback across note switches, tab navigation, and document editing.
- **Vault Media Embed Scanner**: Scans active editor, memory store, IndexedDB leaves, and localStorage to populate saved music cards instantly.
- **1-Click Starter Ambient Presets**: Pre-configured, verified Spotify study playlists (*Lofi Beats*, *Chill Acoustic*, *Synthwave Focus*).
- **Quick Embed Paste Tool**: Instant playback tool supporting Spotify/YouTube URLs and raw `<iframe>` embed codes.
- **Elevated Micro-Pill Toolbar**: 1-row glass floating toolbar with top-center positioning, 8px radius, tight card content hugging, and 100% setting persistence.
- **Adaptive Light & Dark Mode**: Dynamic theme design tokens ensuring seamless visual adaptation in both Light and Dark modes.

## [v2.0.0](https://github.com/jorzyrockz-crypto/Paperuss-2.0/releases) — 2026-07-30

**Major Feature Release & Improvements**

### What's New in PapeRuss 2.0
- **Block & Rich Text Editor**: Enhanced formatting, table insertion, drag-and-drop media, slash commands, and block handles.
- **Cloud Sync & Firebase Auth**: Cross-device synchronization with complete offline fallback and local IndexedDB media storage.
- **Attachment & Scroll Fixes**: Smooth note navigation, auto-scroll containment, and resilient offline attachment caching.
- **Task & Activity Hub**: Centralized notifications, due-task alert banners, completion chimes, and reminder scheduling.
- **Theme & Accent Customization**: Vibrant dark/light modes and customizable accent themes.
- **Data Backup & Clearing**: Portability tools to export/import backups and clear local offline cache safely.

