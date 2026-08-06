/**
 * js/media-widget.js
 * Persistent Draggable Floating Media Player Widget for PapeRuss 2.0.
 * Maintains continuous background audio/video playback (Spotify, YouTube, SoundCloud)
 * when switching notes, navigating leaf tabs, or viewing calendar/settings.
 */

(function(global) {
  'use strict';

  let activeEmbedIframe = null;
  let activeMediaInfo = null;
  let widgetContainer = null;
  let isDocked = false;

  // Position memory
  let widgetPosition = { left: null, top: null, right: 24, bottom: 24 };

  function ensureWidgetContainer() {
    if (widgetContainer && document.contains(widgetContainer)) return widgetContainer;

    widgetContainer = document.createElement('div');
    widgetContainer.id = 'paperussBottomMediaBar';
    widgetContainer.className = 'paperuss-media-widget';
    widgetContainer.setAttribute('contenteditable', 'false');
    widgetContainer.style.display = 'none';

    document.body.appendChild(widgetContainer);
    initDragHandlers(widgetContainer);
    return widgetContainer;
  }

  function initDragHandlers(el) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    function onPointerDown(e) {
      const handle = e.target.closest('.media-widget-drag-handle, .media-widget-header');
      if (!handle) return;

      isDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;

      const rect = el.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = `${initialLeft}px`;
      el.style.top = `${initialTop}px`;
      el.classList.add('is-dragging');

      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
      document.addEventListener('touchmove', onPointerMove, { passive: false });
      document.addEventListener('touchend', onPointerUp);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const dx = clientX - startX;
      const dy = clientY - startY;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // Viewport edge collision safety
      const maxLeft = window.innerWidth - el.offsetWidth - 12;
      const maxTop = window.innerHeight - el.offsetHeight - 12;

      newLeft = Math.max(12, Math.min(maxLeft, newLeft));
      newTop = Math.max(12, Math.min(maxTop, newTop));

      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;

      widgetPosition.left = newLeft;
      widgetPosition.top = newTop;
    }

    function onPointerUp() {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove('is-dragging');

      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchmove', onPointerMove);
      document.removeEventListener('touchend', onPointerUp);
    }

    el.addEventListener('mousedown', onPointerDown);
    el.addEventListener('touchstart', onPointerDown, { passive: false });
  }

  /**
   * Dock an active playing embed iframe into the floating widget.
   */
  function dockToFloatingWidget(embedEl) {
    if (!embedEl) return;
    const iframe = embedEl.querySelector('iframe');
    if (!iframe) return;

    const provider = embedEl.getAttribute('data-provider') || 'media';
    const canonicalUrl = embedEl.getAttribute('data-canonical-url') || '';
    const title = embedEl.querySelector('strong')?.textContent || `${provider.toUpperCase()} Background Play`;
    const brandColor = embedEl.getAttribute('data-brand-color') || '#1ed760';

    activeEmbedIframe = iframe;
    activeMediaInfo = { provider, canonicalUrl, title, brandColor, parentEmbed: embedEl };

    const widget = ensureWidgetContainer();
    widget.setAttribute('data-provider', provider);
    widget.style.setProperty('--brand-accent', brandColor);

    // Apply stored drag position or default bottom-right
    if (widgetPosition.left !== null && widgetPosition.top !== null) {
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
      widget.style.left = `${widgetPosition.left}px`;
      widget.style.top = `${widgetPosition.top}px`;
    } else {
      widget.style.left = 'auto';
      widget.style.top = 'auto';
      widget.style.right = '24px';
      widget.style.bottom = '24px';
    }

    widget.innerHTML = `
      <div class="media-widget-header">
        <span class="media-widget-drag-handle" title="Drag to move widget">
          <i data-lucide="grip-vertical" class="w-4 h-4"></i>
        </span>
        <span class="media-widget-badge">${provider.toUpperCase()}</span>
        <span class="media-widget-title" title="${esc(title)}">${esc(title)}</span>
        <div class="media-widget-actions">
          <button type="button" class="media-widget-btn" id="mediaWidgetExpand" title="Fullscreen Lightbox">
            <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i>
          </button>
          <a href="${esc(canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="media-widget-btn" title="Open Source">
            <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          </a>
          <button type="button" class="media-widget-btn media-widget-btn-danger" id="mediaWidgetClose" title="Close Background Player">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
      <div class="media-widget-body"></div>
    `;

    const bodyContainer = widget.querySelector('.media-widget-body');
    // Move existing iframe without unmounting/reloading audio
    bodyContainer.appendChild(iframe);

    widget.style.display = 'flex';
    isDocked = true;

    if (typeof global.lucide?.createIcons === 'function') {
      setTimeout(() => global.lucide.createIcons(), 0);
    }

    const closeBtn = widget.querySelector('#mediaWidgetClose');
    if (closeBtn) closeBtn.onclick = () => closeFloatingWidget();

    const expandBtn = widget.querySelector('#mediaWidgetExpand');
    if (expandBtn) expandBtn.onclick = () => {
      if (typeof global.EmbedTool?.openEmbedLightbox === 'function' && embedEl) {
        global.EmbedTool.openEmbedLightbox(embedEl);
      }
    };
  }

  function closeFloatingWidget() {
    if (!widgetContainer) return;
    widgetContainer.style.display = 'none';
    widgetContainer.innerHTML = '';
    isDocked = false;
    activeEmbedIframe = null;
    activeMediaInfo = null;
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Intercept Leaf / Note Tab switching to keep music playing in floating widget
  function setupLeafSwitchListener() {
    const originalSwitch = window.switchLeafTab;
    if (typeof originalSwitch === 'function' && !window._mediaWidgetPatched) {
      window._mediaWidgetPatched = true;
      window.switchLeafTab = function(leafId) {
        const activeEditor = document.getElementById('noteBody');
        if (activeEditor) {
          const playingEmbed = activeEditor.querySelector('.paperuss-embed[data-paperuss-embed="true"] iframe');
          if (playingEmbed) {
            const embedParent = playingEmbed.closest('.paperuss-embed');
            if (embedParent) {
              dockToFloatingWidget(embedParent);
            }
          }
        }
        return originalSwitch.apply(this, arguments);
      };
    }
  }

  document.addEventListener('DOMContentLoaded', setupLeafSwitchListener);
  setTimeout(setupLeafSwitchListener, 1000);

  global.PaperussMediaWidget = Object.freeze({
    ensureWidgetContainer,
    dockToFloatingWidget,
    closeFloatingWidget,
    isDocked: () => isDocked
  });

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
