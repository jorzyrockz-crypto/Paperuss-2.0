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
            <i data-lucide="grip-vertical" class="w-4 h-4 text-emerald-400"></i>
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

  function toggleMinimizeWidget(forceState) {
    if (!widgetEl) return;
    const shouldMin = forceState !== undefined ? forceState : !widgetEl.classList.contains('is-minimized');
    widgetEl.classList.toggle('is-minimized', shouldMin);
    const minBtn = widgetEl.querySelector('#mediaWidgetMinimize');
    if (minBtn) {
      minBtn.innerHTML = `<i data-lucide="${shouldMin ? 'chevron-up' : 'minus'}" class="w-3.5 h-3.5"></i>`;
      if (typeof global.lucide?.createIcons === 'function') global.lucide.createIcons();
    }
  }

  function setupButtonEvents() {
    if (!widgetEl) return;

    const minBtn = widgetEl.querySelector('#mediaWidgetMinimize');
    if (minBtn) {
      minBtn.onclick = () => toggleMinimizeWidget();
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
   * Scans noteBody for active playing media iframes and docks them into the persistent floating widget bar.
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
    let embedUrl = (embedElement && embedElement.getAttribute('data-embed-url')) || '';
    const title = (embedElement && embedElement.querySelector('strong')?.textContent) || `${provider.toUpperCase()} Player`;
    const brandColor = (embedElement && embedElement.getAttribute('data-brand-color')) || '#1ed760';

    currentEmbedInfo = { provider, canonicalUrl, embedUrl, title, brandColor };

    const iframe = targetIframe || (embedElement && embedElement.querySelector('iframe'));
    const container = widgetEl.querySelector('#mediaWidgetIframeContainer');
    
    if (iframe && container) {
      activeIframe = iframe;
      if (iframe.parentElement !== container) {
        container.innerHTML = '';
        container.appendChild(iframe);
      }
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

    // INSTANT WIDGET EXPANSION & UN-MINIMIZE ON PLAYLIST PLAY
    widgetEl.classList.remove('hidden', 'is-minimized');
    widgetEl.style.opacity = '1';

    // Show pulsing green status dot on bottom bar button
    const dot = document.getElementById('musicHubDot');
    if (dot) dot.classList.remove('hidden');

    if (typeof global.toast === 'function') {
      global.toast(`Background Play: ${provider.toUpperCase()}`);
    }
  }

  function stopPlayback() {
    if (!widgetEl) return;
    const container = widgetEl.querySelector('#mediaWidgetIframeContainer');
    if (container) container.innerHTML = '';
    activeIframe = null;
    currentEmbedInfo = null;
    widgetEl.classList.add('hidden');
    
    // Hide pulsing green dot
    const dot = document.getElementById('musicHubDot');
    if (dot) dot.classList.add('hidden');

    if (typeof global.toast === 'function') {
      global.toast('Playback Stopped');
    }
  }

  // Open / Close Music Player Hub Modal
  function openMusicHubModal() {
    const overlay = document.getElementById('musicHubModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    
    // If widget is minimized, toggle expansion when clicking bottom bar button
    if (widgetEl && widgetEl.classList.contains('is-minimized')) {
      toggleMinimizeWidget(false);
    }

    scanVaultForMusicEmbeds();
  }

  function closeMusicHubModal() {
    const overlay = document.getElementById('musicHubModalOverlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function playPresetMusic(embedUrl, providerName = 'Spotify') {
    initMediaWidget();
    
    // Ensure autoplay parameter is appended if missing
    let targetUrl = embedUrl;
    if (targetUrl && !targetUrl.includes('autoplay=1')) {
      targetUrl += (targetUrl.includes('?') ? '&' : '?') + 'autoplay=1';
    }

    const tempWrap = document.createElement('div');
    tempWrap.setAttribute('data-provider', providerName.toLowerCase());
    tempWrap.setAttribute('data-canonical-url', targetUrl);
    tempWrap.setAttribute('data-embed-url', targetUrl);
    tempWrap.setAttribute('data-brand-color', '#1ed760');
    tempWrap.innerHTML = `<strong>${providerName} Stream</strong>`;

    const iframe = document.createElement('iframe');
    iframe.src = targetUrl;
    iframe.allow = 'autoplay; clipboard-write; encrypted-media; picture-in-picture; background-play';
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '80px';
    tempWrap.appendChild(iframe);

    dockActiveEmbed(tempWrap, iframe);
    closeMusicHubModal();
  }

  async function scanVaultForMusicEmbeds() {
    const vaultList = document.getElementById('musicHubVaultList');
    if (!vaultList) return;

    const foundMap = new Map(); // Keyed by embedUrl to avoid duplicates!

    const processHtml = (htmlContent, sourceTitle) => {
      if (!htmlContent || typeof htmlContent !== 'string') return;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const embeds = doc.querySelectorAll('.paperuss-embed, [data-embed-url]');
        embeds.forEach(embed => {
          const provider = embed.getAttribute('data-provider') || 'media';
          const embedUrl = embed.getAttribute('data-embed-url') || embed.querySelector('iframe')?.src || '';
          const title = embed.querySelector('strong')?.textContent || `${provider.toUpperCase()} Embed`;
          if (embedUrl && !foundMap.has(embedUrl)) {
            foundMap.set(embedUrl, { noteTitle: sourceTitle || 'Active Note', provider, embedUrl, title });
          }
        });

        // Also check raw <iframe> tags in note HTML
        const iframes = doc.querySelectorAll('iframe');
        iframes.forEach(iframe => {
          const src = iframe.src;
          if (src && !foundMap.has(src)) {
            let provider = 'media';
            if (src.includes('spotify.com')) provider = 'spotify';
            else if (src.includes('youtube.com') || src.includes('youtu.be')) provider = 'youtube';
            else if (src.includes('soundcloud.com')) provider = 'soundcloud';
            foundMap.set(src, { noteTitle: sourceTitle || 'Active Note', provider, embedUrl: src, title: `${provider.toUpperCase()} Embed` });
          }
        });
      } catch (_) {}
    };

    // 1. Scan current active note in editor
    const activeEd = document.getElementById('noteBody');
    const activeTitle = document.getElementById('noteTitle')?.value || 'Current Note';
    if (activeEd) {
      processHtml(activeEd.innerHTML, activeTitle);
    }

    // 2. Scan window.notes / window.state.notes
    const memoryNotes = global.notes || global.state?.notes || [];
    memoryNotes.forEach(n => {
      processHtml(n.body || n.content || '', n.title || 'Untitled Note');
    });

    // 3. Scan IndexedDB leaves if available
    if (global.paperussLeaves && typeof global.paperussLeaves.leafGetAll === 'function') {
      try {
        const leaves = await global.paperussLeaves.leafGetAll();
        leaves.forEach(leaf => {
          processHtml(leaf.content || leaf.body || '', leaf.title || 'Note Leaf');
        });
      } catch (_) {}
    }

    // 4. Scan localStorage fallback
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('octonotes:') || key.startsWith('paperuss:'))) {
          const val = localStorage.getItem(key);
          if (val && (val.includes('<iframe') || val.includes('paperuss-embed'))) {
            try {
              const parsed = JSON.parse(val);
              if (Array.isArray(parsed)) {
                parsed.forEach(n => processHtml(n.content || n.body || '', n.title || 'Note'));
              } else if (parsed && typeof parsed === 'object') {
                processHtml(parsed.content || parsed.body || '', parsed.title || 'Note');
              }
            } catch (_) {
              processHtml(val, 'Saved Note');
            }
          }
        }
      }
    } catch (_) {}

    const foundEmbeds = Array.from(foundMap.values());

    if (foundEmbeds.length === 0) {
      vaultList.innerHTML = `
        <div class="music-hub-empty">
          <i data-lucide="music-4" class="w-6 h-6 text-muted"></i>
          <span>No saved music embeds found in your notes yet.<br>Paste a Spotify or YouTube link into any note to save it here!</span>
        </div>
      `;
    } else {
      vaultList.innerHTML = foundEmbeds.map(item => `
        <div class="vault-music-item">
          <div class="vmi-info">
            <strong>${esc(item.title)}</strong>
            <span>${esc(item.noteTitle)} • ${esc(item.provider.toUpperCase())}</span>
          </div>
          <button class="btn btn-sm btn-primary" data-action="play-vault-item" data-embed-url="${esc(item.embedUrl)}" data-provider="${esc(item.provider)}">
            <i data-lucide="play" class="w-3.5 h-3.5"></i> Play
          </button>
        </div>
      `).join('');
    }

    if (typeof global.lucide?.createIcons === 'function') global.lucide.createIcons();
  }

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function handlePastePlay() {
    const pasteInput = document.getElementById('musicHubPasteInput');
    if (!pasteInput) return;
    const val = pasteInput.value.trim();
    if (!val) return;
    let targetUrl = val;
    // Check if raw iframe paste
    const iframeMatch = val.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch) targetUrl = iframeMatch[1];
    
    // If Spotify regular link, convert to embedUrl
    if (global.LinkParser && global.LinkParser.parseUrl) {
      const parsed = global.LinkParser.parseUrl(targetUrl);
      if (parsed && parsed.embedUrl) targetUrl = parsed.embedUrl;
    }

    playPresetMusic(targetUrl, 'Media');
    pasteInput.value = '';
  }

  function setupHubEvents() {
    const hubBtn = document.getElementById('musicHubBtn');
    if (hubBtn) hubBtn.onclick = () => openMusicHubModal();

    const closeBtn = document.getElementById('closeMusicHubBtn');
    if (closeBtn) closeBtn.onclick = () => closeMusicHubModal();

    const overlay = document.getElementById('musicHubModalOverlay');
    if (overlay) {
      overlay.onclick = (e) => {
        if (e.target === overlay) closeMusicHubModal();
      };
    }

    const pasteBtn = document.getElementById('musicHubPastePlayBtn');
    if (pasteBtn) pasteBtn.onclick = () => handlePastePlay();
  }

  // Delegated global click listener for all Music Player buttons & modal actions
  document.addEventListener('click', (e) => {
    // Open Hub
    const musicBtn = e.target.closest('#musicHubBtn, #sidebarMusicBtn, [data-action="open-music-hub"]');
    if (musicBtn) {
      e.preventDefault();
      openMusicHubModal();
      return;
    }

    // Close Hub
    const closeBtn = e.target.closest('#closeMusicHubBtn, [data-action="close-music-hub"]');
    if (closeBtn) {
      e.preventDefault();
      closeMusicHubModal();
      return;
    }

    // Quick Paste Play
    const pasteBtn = e.target.closest('#musicHubPastePlayBtn');
    if (pasteBtn) {
      e.preventDefault();
      handlePastePlay();
      return;
    }

    // Ambient Preset Cards
    const presetCard = e.target.closest('.music-preset-card');
    if (presetCard) {
      e.preventDefault();
      const url = presetCard.getAttribute('data-preset-url');
      if (url) playPresetMusic(url, 'Spotify Preset');
      return;
    }

    // Play Vault Item
    const vaultBtn = e.target.closest('[data-action="play-vault-item"]');
    if (vaultBtn) {
      e.preventDefault();
      const url = vaultBtn.getAttribute('data-embed-url');
      const provider = vaultBtn.getAttribute('data-provider') || 'Media';
      if (url) playPresetMusic(url, provider);
      return;
    }
  });

  // Support Enter key in Quick Paste input
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.id === 'musicHubPasteInput') {
      e.preventDefault();
      handlePastePlay();
    }
  });

  // Export module APIs
  global.PaperussMediaWidget = Object.freeze({
    dockActiveEmbed,
    checkAndDockActiveEmbed,
    stopPlayback,
    initMediaWidget,
    openMusicHubModal,
    closeMusicHubModal,
    playPresetMusic,
    scanVaultForMusicEmbeds
  });

  global.checkAndDockActiveEmbed = checkAndDockActiveEmbed;
  global.openMusicHubModal = openMusicHubModal;
  global.closeMusicHubModal = closeMusicHubModal;

  document.addEventListener('DOMContentLoaded', () => {
    initMediaWidget();
    setupHubEvents();
  });

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
