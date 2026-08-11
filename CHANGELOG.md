# Changelog

## [2.7.0] - 2026-08-11

### ✨ New Features & Enhancements
*   **Table Themes System**: Implemented a comprehensive theming engine with 7+ beautiful, print-ready table styles (Grayscale, Ocean, Sunset, Forest, Corporate, Minimal, Accent). 
*   **CalcuLeaf Powered Templates**: Overhauled the Insert Templates menu (Invoice, Timesheet, Budget, Lending Tracker, etc.) to showcase dynamic CalcuLeaf mathematical rules, cascading cross-cell formulas, and real-time conditional variance logic.
*   **Immersive Music Hub Lightbox**: Replaced the bulky "Music Player" text button with a dynamic, spinning, RGB rainbow-cycling DJ disk `💿` icon. When clicked during active playback, it triggers a stunning full-screen glassmorphic lightbox that centers your playlist while blurring your workspace.
*   **Canvas Light Mode**: Added a `force-light-canvas` user setting that forces the paper canvas to become white for easier readability, especially useful when working with print-ready tables.
*   **Table Toolbar Optimization**: Streamlined the table floating toolbar by reducing clutter and consolidating essential controls into a clean 4-button layout.

### 🐛 Bug Fixes
*   **Global Viewport Awareness**: Built a robust `MutationObserver` engine that calculates viewport coordinates for fixed/absolute elements like context menus and the Page Setup modal, forcing them to elegantly bump into view instead of clipping off the edges of the screen.
*   **CSS Animation Conflicts**: Resolved a bug where CSS `transform` entry animations were overriding JavaScript coordinate calculations by switching the animations to the modern independent `scale` CSS property.
*   **Responsive Modal Columns**: Restored the beautiful masonry layout grid for the Page Setup modal (3 columns on ultra-wide screens, 2 on laptops, 1 on mobile) which had been accidentally overridden.
*   **Template Insertion Trigger**: Fixed the broken event-wiring that was preventing the Template selection modal from appearing.

### 🧹 Refactoring
*   **Fallback Music Widget**: Added intelligent UI fallback logic that detects if a music embed is active—triggering the Full-Screen DJ Lightbox if true, or gracefully popping open the original widget linker modal if false.
