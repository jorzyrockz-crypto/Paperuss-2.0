/**
 * swipe-nav.js — Paperuss Global Swipe Navigation
 * Implements a strict drill-down hierarchy:
 *   Sidebar ↔ Note List ↔ Leaves Drawer ↔ Editor
 *
 * Swipe RIGHT (toward right) = go BACK one level
 * Swipe LEFT  (toward left)  = go FORWARD one level (only when logical)
 *
 * All transitions are wrapped in document.startViewTransition for premium animations.
 */

(function() {
  'use strict';

  // --- Config ---
  const MIN_SWIPE_X = 60;      // Minimum horizontal distance to count as a swipe
  const MAX_SWIPE_Y = 80;      // Maximum vertical drift allowed before ignoring
  const EDGE_ZONE = 60;        // px from left edge to activate back-swipe (iOS-style)

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartFromEdge = false;

  // --- Helpers ---

  function isMobileOrTablet() {
    return window.innerWidth <= 1024;
  }

  function isLeavesColumnVisible() {
    // Leaves column is the permanent sidebar column (not the floating drawer)
    const col = document.getElementById('notesContainer');
    if (!col) return false;
    if (typeof window.state !== 'undefined' && window.state.listMode === 'leaves') return true;
    return false;
  }

  function isLeavesDrawerOpen() {
    const overlay = document.getElementById('leavesDrawerOverlay');
    return overlay && overlay.classList.contains('show');
  }

  function isSidebarOpen() {
    const sidebar = document.getElementById('sidebar');
    return sidebar && sidebar.classList.contains('open');
  }

  function isEditorActive() {
    const editor = document.getElementById('editor');
    return editor && editor.classList.contains('mobile-show');
  }

  function isNoteSelected() {
    return typeof window.state !== 'undefined' && !!window.state.currentId;
  }

  function doTransition(fn) {
    if (document.startViewTransition) {
      document.startViewTransition(() => fn());
    } else {
      fn();
    }
  }

  // --- Navigation Actions ---

  function goBack() {
    if (!isMobileOrTablet()) {
      // Desktop: only close the sidebar if it's open
      if (isSidebarOpen()) {
        doTransition(() => {
          if (typeof closeSidebarMobile === 'function') closeSidebarMobile();
        });
      }
      return;
    }

    // Mobile hierarchy: Editor → Leaves → Note List → Sidebar
    if (isEditorActive() && isLeavesDrawerOpen()) {
      // Editor is active and Leaves drawer is open — just close the drawer
      doTransition(() => {
        if (typeof closeLeavesDrawer === 'function') closeLeavesDrawer();
      });
      return;
    }

    if (isEditorActive()) {
      // Go back to Leaves Drawer (if note is selected) or Note List
      if (isNoteSelected()) {
        doTransition(() => {
          if (typeof openLeavesDrawer === 'function') openLeavesDrawer();
          // Also go back to the list view on mobile
          if (typeof showMobileList === 'function') showMobileList();
        });
      } else {
        doTransition(() => {
          if (typeof showMobileList === 'function') showMobileList();
        });
      }
      return;
    }

    if (isLeavesDrawerOpen()) {
      // Close the Leaves drawer → back to Note List
      doTransition(() => {
        if (typeof closeLeavesDrawer === 'function') closeLeavesDrawer();
        if (typeof showMobileList === 'function') showMobileList();
      });
      return;
    }

    if (isSidebarOpen()) {
      // Sidebar is open → close it
      doTransition(() => {
        if (typeof closeSidebarMobile === 'function') closeSidebarMobile();
      });
      return;
    }

    // At Note List level — open sidebar
    doTransition(() => {
      if (typeof toggleSidebarMobile === 'function') toggleSidebarMobile();
    });
  }

  function goForward() {
    if (!isMobileOrTablet()) return;

    if (isSidebarOpen()) {
      // Close sidebar → Note List
      doTransition(() => {
        if (typeof closeSidebarMobile === 'function') closeSidebarMobile();
      });
      return;
    }

    if (!isEditorActive() && isNoteSelected() && !isLeavesDrawerOpen()) {
      // On Note List with an active note → open Leaves Drawer
      doTransition(() => {
        if (typeof openLeavesDrawer === 'function') openLeavesDrawer();
      });
      return;
    }

    if (isLeavesDrawerOpen() && isNoteSelected()) {
      // Leaves Drawer open → go to Editor
      doTransition(() => {
        if (typeof closeLeavesDrawer === 'function') closeLeavesDrawer();
        if (typeof showMobileEditor === 'function') showMobileEditor();
      });
      return;
    }
  }

  // --- Touch Event Listeners ---

  document.addEventListener('touchstart', function(e) {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    // Only trigger back swipe from near the left edge (like native iOS/Android)
    touchStartFromEdge = touch.clientX <= EDGE_ZONE;
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Must be primarily horizontal
    if (absDx < MIN_SWIPE_X || absDy > MAX_SWIPE_Y) return;

    // Ignore if the swipe originated inside a scrollable container
    const target = e.target;
    if (target && target.closest && target.closest('.leafline-track, .note-card, [contenteditable], textarea, input, .modal, .dropdown')) {
      return;
    }

    if (dx > 0) {
      // Swipe RIGHT = go back
      // Only trigger if it started near the left edge (to avoid conflicts with content scrolling)
      if (touchStartFromEdge || isEditorActive() || isLeavesDrawerOpen()) {
        goBack();
      }
    } else {
      // Swipe LEFT = go forward
      goForward();
    }
  }, { passive: true });

  // --- Export for external triggers ---
  window.swipeNav = {
    goBack,
    goForward,
  };

  console.log('[swipe-nav] Gesture navigation active.');
})();
