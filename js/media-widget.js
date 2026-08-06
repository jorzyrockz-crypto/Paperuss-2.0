/**
 * js/media-widget.js
 * Persistent Draggable Floating Background Media Player Widget for PapeRuss 2.0.
 * Allows Spotify, YouTube, SoundCloud, and video embeds to continue playing uninterrupted
 * when users switch notes, navigate tabs, or edit documents.
 */

(function (global) {
  'use strict';

  let widgetEl = null;
  let currentEmbedInfo = null;
  let activeIframe = null;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function initMediaWidget() {
    if (document.getElementById('paperussBottomMediaBar')) {
      widgetEl = document.getElementById('paperussBottomMediaBar');
      return;
    }

    widgetEl = document.createElement('div');
    widgetEl.id = 'paperussBottomMediaBar';
    widgetEl.className = 'paperuss-media-widget hidden';
    widgetEl.setAttribute('role', 'region');
    widgetEl.setAttribute('aria-label', 'Floating Media Player');

    widgetEl.innerHTML = `
      <div class="media-widget-header">
        <div class="media-widget-header-left">
          <div class="media-widget-drag-handle" title="Drag to move player">
            <i data-lucide="grip-vertical" class="w-3.5 h-3.5 text-muted"></i>
          </div>
          <div class="media-widget-badge" id="mediaWidgetBadge">SPOTIFY</div>
        </div>
        <div class="media-widget-controls">
          <button type="button" class="media-widget-btn" id="mediaWidgetMinimize" title="Minimize / Expand Player">
            <i data-lucide="minus" class="w-3.5 h-3.5"></i>
          </button>
          <button type="button" class="media-widget-btn" id="mediaWidgetExpand" title="Fullscreen Lightbox">
            <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i>
          </button>
          <button type="button" class="media-widget-btn" id="mediaWidgetReturn" title="Open Link">
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          </button>
          <button type="button" class="media-widget-btn media-widget-btn-close" id="mediaWidgetClose" title="Stop & Close Player">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
      <div class="media-widget-iframe-container" id="mediaWidgetIframeContainer"></div>
    `;

    document.body.appendChild(widgetEl);
    setupDragEvents();
    setupButtonEvents();

    if (typeof global.lucide?.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }

  function setupDragEvents() {
    if (!widgetEl) return;
    const handle = widgetEl.querySelector('.media-widget-drag-handle') || widgetEl;

    const startDrag = (clientX, clientY) => {
      isDragging = true;
      const rect = widgetEl.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
      widgetEl.classList.add('is-dragging');
    };

    const moveDrag = (clientX, clientY) => {
      if (!isDragging) return;
      let newLeft = clientX - dragOffsetX;
      let newTop = clientY - dragOffsetY;

      // Viewport safety boundary check
      const maxLeft = window.innerWidth - widgetEl.offsetWidth - 12;
      const maxTop = window.innerHeight - widgetEl.offsetHeight - 12;
      newLeft = Math.max(12, Math.min(maxLeft, newLeft));
      newTop = Math.max(12, Math.min(maxTop, newTop));

      widgetEl.style.left = `${newLeft}px`;
      widgetEl.style.top = `${newTop}px`;
      widgetEl.style.bottom = 'auto';
      widgetEl.style.right = 'auto';
    };

    const stopDrag = () => {
      if (isDragging) {
        isDragging = false;
        widgetEl.classList.remove('is-dragging');
      }
    };

    // Mouse events
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      startDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) moveDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', stopDrag);

    // Touch events
    handle.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1 && !e.target.closest('button')) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    document.addEventListener('touchend', stopDrag);
  }

  function setupButtonEvents() {
    if (!widgetEl) return;

    const minBtn = widgetEl.querySelector('#mediaWidgetMinimize');
    if (minBtn) {
      minBtn.onclick = () => {
        const isMin = widgetEl.classList.toggle('is-minimized');
        const icon = minBtn.querySelector('[data-lucide]');
        if (icon) {
          icon.setAttribute('data-lucide', isMin ? 'chevron-up' : 'minus');
          if (typeof global.lucide?.createIcons === 'function') global.lucide.createIcons();
        }
      };
    }

    const closeBtn = widgetEl.querySelector('#mediaWidgetClose');
    if (closeBtn) {
      closeBtn.onclick = () => stopPlayback();
    }

    const expandBtn = widgetEl.querySelector('#mediaWidgetExpand');
    if (expandBtn) {
      expandBtn.onclick = () => {
        if (currentEmbedInfo && global.openEmbedLightbox) {
          const tempDiv = document.createElement('div');
          tempDiv.setAttribute('data-canonical-url', currentEmbedInfo.canonicalUrl || '');
          tempDiv.setAttribute('data-embed-url', currentEmbedInfo.embedUrl || '');
          global.openEmbedLightbox(tempDiv);
        }
      };
    }

    const returnBtn = widgetEl.querySelector('#mediaWidgetReturn');
    if (returnBtn) {
      returnBtn.onclick = () => {
        if (currentEmbedInfo && currentEmbedInfo.canonicalUrl) {
          window.open(currentEmbedInfo.canonicalUrl, '_blank', 'noopener,noreferrer');
        }
      };
    }
  }

  /**
   * Scans noteBody for active playing media iframes and docks them into the floating widget.
   */
  function checkAndDockActiveEmbed() {
    initMediaWidget();
    const activeEd = document.getElementById('noteBody');
    if (!activeEd) return;
    const iframes = activeEd.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (widgetEl && widgetEl.contains(iframe)) continue;
      const parentCard = iframe.closest('.paperuss-embed') || iframe.parentElement;
      if (parentCard) {
        dockActiveEmbed(parentCard, iframe);
        break;
      }
    }
  }

  /**
   * Docks an active playing embed iframe into the persistent floating widget bar.
   */
  function dockActiveEmbed(embedElement, targetIframe) {
    if (!embedElement && !targetIframe) return;
    initMediaWidget();

    const provider = (embedElement && embedElement.getAttribute('data-provider')) || 'media';
    const canonicalUrl = (embedElement && embedElement.getAttribute('data-canonical-url')) || '';
    const embedUrl = (embedElement && embedElement.getAttribute('data-embed-url')) || '';
    const title = (embedElement && embedElement.querySelector('strong')?.textContent) || `${provider.toUpperCase()} Player`;
    const brandColor = (embedElement && embedElement.getAttribute('data-brand-color')) || '#1ed760';

    currentEmbedInfo = { provider, canonicalUrl, embedUrl, title, brandColor };

    const iframe = targetIframe || (embedElement && embedElement.querySelector('iframe'));
    const container = widgetEl.querySelector('#mediaWidgetIframeContainer');
    
    if (iframe && container) {
      activeIframe = iframe;
      container.appendChild(iframe); // Migrates DOM node without unmounting or pausing audio!
      iframe.style.height = '80px';
      iframe.style.borderRadius = '10px';
    }

    const badge = widgetEl.querySelector('#mediaWidgetBadge');
    if (badge) {
      badge.textContent = provider.toUpperCase();
      badge.style.background = `${brandColor}25`;
      badge.style.color = brandColor;
      badge.style.border = `1px solid ${brandColor}40`;
    }

    widgetEl.classList.remove('hidden');
    if (typeof global.toast === 'function') {
      global.toast(`Background Play: ${provider.toUpperCase()}`);
    }
  }

  function stopPlayback() {
    if (widgetEl) {
      widgetEl.classList.add('hidden');
      const container = widgetEl.querySelector('#mediaWidgetIframeContainer');
      if (container) container.innerHTML = '';
    }
    activeIframe = null;
    currentEmbedInfo = null;
  }

  // Intercept leaf tab switches to dock active playing embeds automatically
  const origFlush = global.flushActiveLeaf;
  if (typeof origFlush === 'function') {
    global.flushActiveLeaf = function (...args) {
      checkAndDockActiveEmbed();
      return origFlush.apply(this, args);
    };
  }

  // Export module APIs
  global.PaperussMediaWidget = Object.freeze({
    dockActiveEmbed,
    checkAndDockActiveEmbed,
    stopPlayback,
    initMediaWidget
  });

  global.checkAndDockActiveEmbed = checkAndDockActiveEmbed;

  document.addEventListener('DOMContentLoaded', initMediaWidget);

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
