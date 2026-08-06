/* ============================================================
   PAPERUSS 2.1.8 - EMBED TOOL MODULE
   Safe browser-side detection, canonical persistence, hydration/dehydration,
   Facebook plugin iframe handling, and editor management toolbar.
   ============================================================ */
(function (global) {
  'use strict';

  // In-memory metadata cache to avoid refetching on every render
  const METADATA_CACHE_KEY = 'paperuss_embed_meta_cache_v1';
  let metadataCache = {};
  try {
    const saved = localStorage.getItem(METADATA_CACHE_KEY);
    if (saved) metadataCache = JSON.parse(saved);
  } catch (e) {
    metadataCache = {};
  }

  function saveMetadataCache() {
    try {
      localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(metadataCache));
    } catch (e) {}
  }

  function getCachedMetadata(url) {
    return metadataCache[url] || null;
  }

  function setCachedMetadata(url, meta) {
    metadataCache[url] = { ...meta, _cachedAt: Date.now() };
    saveMetadataCache();
  }

  /**
   * Safe browser-side provider detection.
   * Handles direct URLs for 9 providers + Facebook plugin iframe HTML extraction.
   * Returns canonical info object or null (for unknown providers -> standard normal link).
   */
  function detectEmbedProvider(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const inputStr = rawInput.trim();

    // 1. Check if input is Facebook plugin iframe HTML
    // e.g. <iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fweb.facebook.com%2Felevatemindhqq%2Fposts%2Fpfbid...&show_text=true&width=500" ...>
    if (inputStr.toLowerCase().includes('<iframe') && inputStr.includes('facebook.com/plugins/')) {
      const srcMatch = inputStr.match(/src=["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1]) {
        let pluginUrlStr = srcMatch[1];
        // Must be from https://www.facebook.com/plugins/post.php or video.php
        if (pluginUrlStr.startsWith('https://www.facebook.com/plugins/') || pluginUrlStr.startsWith('https://web.facebook.com/plugins/')) {
          try {
            // Unescape HTML entities in URL if any
            pluginUrlStr = pluginUrlStr.replace(/&amp;/g, '&');
            const urlObj = new URL(pluginUrlStr);
            const hrefParam = urlObj.searchParams.get('href');
            if (hrefParam) {
              const decodedHref = decodeURIComponent(hrefParam);
              // Extract preferred height if supplied
              let preferredHeight = 600;
              const heightMatch = inputStr.match(/height=["']?(\d+)["']?/i);
              if (heightMatch && heightMatch[1]) {
                const parsedH = parseInt(heightMatch[1], 10);
                preferredHeight = Math.max(200, Math.min(1000, parsedH || 600));
              }
              const isVideo = pluginUrlStr.includes('video.php') || decodedHref.includes('/videos/') || decodedHref.includes('fb.watch');
              return {
                provider: 'facebook',
                providerName: 'Facebook',
                contentType: isVideo ? 'video' : 'post',
                canonicalUrl: decodedHref,
                embedUrl: `https://www.facebook.com/plugins/${isVideo ? 'video.php' : 'post.php'}?href=${encodeURIComponent(decodedHref)}&show_text=true`,
                preferredHeight: preferredHeight,
                widthPreset: 'medium',
                displayMode: 'interactive',
                title: null,
                description: null,
                thumbnail: null,
                author: null
              };
            }
          } catch (e) {
            console.warn('Failed to parse pasted Facebook iframe HTML:', e);
          }
        }
      }
    }

    // 2. Normalize standard URL via LinkParser if available
    let urlStr = inputStr;
    if (typeof global.LinkParser?.normalizeUrl === 'function') {
      urlStr = global.LinkParser.normalizeUrl(inputStr);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      return null; // Not a valid URL
    }

    const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsedUrl.pathname || '';

    // YouTube: watch, youtu.be, shorts, embed
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      let videoId = null;
      if (host === 'youtu.be') {
        videoId = path.slice(1).split('/')[0];
      } else if (path.startsWith('/watch')) {
        videoId = parsedUrl.searchParams.get('v');
      } else if (path.startsWith('/shorts/') || path.startsWith('/embed/')) {
        videoId = path.split('/')[2];
      }
      if (videoId && /^[a-zA-Z0-9_-]{10,12}$/.test(videoId)) {
        return {
          provider: 'youtube',
          providerName: 'YouTube',
          contentType: 'video',
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
          preferredHeight: 360,
          widthPreset: 'medium',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          author: null
        };
      }
    }

    // Vimeo
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const vimeoMatch = path.match(/(?:video\/|)(\d+)/);
      if (vimeoMatch && vimeoMatch[1]) {
        const videoId = vimeoMatch[1];
        return {
          provider: 'vimeo',
          providerName: 'Vimeo',
          contentType: 'video',
          canonicalUrl: `https://vimeo.com/${videoId}`,
          embedUrl: `https://player.vimeo.com/video/${videoId}`,
          preferredHeight: 360,
          widthPreset: 'medium',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: null,
          author: null
        };
      }
    }

    // Spotify: track, album, playlist, episode, show
    if (host === 'spotify.com' || host === 'open.spotify.com') {
      const spMatch = path.match(/^\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
      if (spMatch && spMatch[1] && spMatch[2]) {
        const type = spMatch[1];
        const id = spMatch[2];
        return {
          provider: 'spotify',
          providerName: 'Spotify',
          contentType: type,
          canonicalUrl: `https://open.spotify.com/${type}/${id}`,
          embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`,
          preferredHeight: type === 'track' ? 152 : 352,
          widthPreset: 'medium',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: null,
          author: null
        };
      }
    }

    // SoundCloud
    if (host === 'soundcloud.com' || host === 'w.soundcloud.com') {
      if (path && path.length > 2 && !path.startsWith('/pages/')) {
        return {
          provider: 'soundcloud',
          providerName: 'SoundCloud',
          contentType: 'audio',
          canonicalUrl: urlStr,
          embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(urlStr)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
          preferredHeight: 166,
          widthPreset: 'medium',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: null,
          author: null
        };
      }
    }

    // TikTok
    if (host === 'tiktok.com' || host === 'vm.tiktok.com') {
      const ttMatch = path.match(/\/(@[a-zA-Z0-9_.-]+)\/video\/(\d+)/);
      let videoId = ttMatch ? ttMatch[2] : null;
      let author = ttMatch ? ttMatch[1] : null;
      if (videoId) {
        return {
          provider: 'tiktok',
          providerName: 'TikTok',
          contentType: 'video',
          canonicalUrl: urlStr,
          embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
          preferredHeight: 600,
          widthPreset: 'small',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: null,
          author: author
        };
      }
    }

    // Instagram: post, reel
    if (host === 'instagram.com' || host === 'instagr.am') {
      const igMatch = path.match(/^\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
      if (igMatch && igMatch[1]) {
        const id = igMatch[1];
        const isReel = path.includes('reel');
        return {
          provider: 'instagram',
          providerName: 'Instagram',
          contentType: isReel ? 'reel' : 'post',
          canonicalUrl: `https://www.instagram.com/p/${id}/`,
          embedUrl: `https://www.instagram.com/p/${id}/embed/`,
          preferredHeight: 600,
          widthPreset: 'small',
          displayMode: 'interactive',
          title: null,
          description: null,
          thumbnail: null,
          author: null
        };
      }
    }

    // Facebook direct URL: share, post, reel, video, watch
    if (host === 'facebook.com' || host === 'web.facebook.com' || host === 'm.facebook.com' || host === 'fb.watch' || host === 'fb.com') {
      const isVideo = path.includes('/videos/') || path.includes('/watch') || host === 'fb.watch';
      return {
        provider: 'facebook',
        providerName: 'Facebook',
        contentType: isVideo ? 'video' : 'post',
        canonicalUrl: urlStr,
        embedUrl: `https://www.facebook.com/plugins/${isVideo ? 'video.php' : 'post.php'}?href=${encodeURIComponent(urlStr)}&show_text=true`,
        preferredHeight: 600,
        widthPreset: 'medium',
        displayMode: 'interactive',
        title: null,
        description: null,
        thumbnail: null,
        author: null
      };
    }

    // X / Twitter: status URLs
    if (host === 'x.com' || host === 'twitter.com' || host === 't.co') {
      const xMatch = path.match(/^\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
      if (xMatch && xMatch[1] && xMatch[2]) {
        const author = `@${xMatch[1]}`;
        return {
          provider: 'x',
          providerName: 'X / Twitter',
          contentType: 'post',
          canonicalUrl: `https://x.com/${xMatch[1]}/status/${xMatch[2]}`,
          embedUrl: null, // X does not support clean zero-script public iframe; use card fallback
          preferredHeight: 220,
          widthPreset: 'medium',
          displayMode: 'preview',
          title: `Post by ${author}`,
          description: null,
          thumbnail: null,
          author: author
        };
      }
    }

    // Google Maps
    if (host.includes('google') && (path.startsWith('/maps') || host === 'maps.google.com' || host === 'maps.app.goo.gl')) {
      return {
        provider: 'google-maps',
        providerName: 'Google Maps',
        contentType: 'map',
        canonicalUrl: urlStr,
        embedUrl: `https://www.google.com/maps?q=${encodeURIComponent(urlStr)}&output=embed`,
        preferredHeight: 380,
        widthPreset: 'large',
        displayMode: 'interactive',
        title: 'Google Maps Location',
        description: null,
        thumbnail: null,
        author: null
      };
    }

    // Email / mailto links
    if (parsedUrl.protocol === 'mailto:') {
      const email = parsedUrl.pathname || urlStr.replace(/^mailto:/i, '');
      return {
        provider: 'email',
        providerName: 'Email',
        contentType: 'link',
        canonicalUrl: urlStr,
        embedUrl: null,
        preferredHeight: 100,
        widthPreset: 'medium',
        displayMode: 'inline',
        title: email,
        description: `Email: ${email}`,
        thumbnail: null,
        author: null
      };
    }

    // General Web Link fallback -> return web provider info for Rich Link Cards & Previews
    const platformInfo = global.LinkParser?.detectPlatform ? global.LinkParser.detectPlatform(host) : { key: null, name: null };
    const providerName = platformInfo.name || host;
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    let title = providerName;
    if (path && path !== '/') {
      const cleanPathName = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
      if (cleanPathName) title = `${cleanPathName} - ${providerName}`;
    }
    return {
      provider: platformInfo.key || 'web',
      providerName: providerName,
      contentType: 'link',
      canonicalUrl: urlStr,
      embedUrl: null,
      preferredHeight: 140,
      widthPreset: 'medium',
      displayMode: 'preview',
      title: title,
      description: urlStr,
      thumbnail: null,
      author: null
    };
  }

  /**
   * Escape HTML helper for attribute and inner strings.
   */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generates pure canonical HTML for storing inside #noteBody.
   * Never contains editor controls, loading UI, resize handles, or temporary menus.
   */
  function buildCanonicalEmbedHtml(info) {
    if (!info || !info.provider) return '';
    const provider = esc(info.provider);
    const providerName = esc(info.providerName || info.provider);
    const contentType = esc(info.contentType || 'embed');
    const canonicalUrl = esc(info.canonicalUrl || '');
    const embedUrl = esc(info.embedUrl || '');
    const displayMode = esc(info.displayMode || 'interactive');
    const widthPreset = esc(info.widthPreset || 'medium');
    const preferredHeight = parseInt(info.preferredHeight, 10) || 400;

    let hostName = info.hostname || providerName;
    try {
      if (canonicalUrl) hostName = new URL(canonicalUrl).hostname.replace(/^www\./, '');
    } catch (_) {}

    const title = info.title ? esc(info.title) : `${providerName} ${contentType}`;
    const desc = info.description ? `<p class="embed-fallback-desc">${esc(info.description)}</p>` : '';
    
    // Check if thumbnail is a favicon vs real article/video hero image
    const isFaviconUrl = info.thumbnail && info.thumbnail.includes('favicons?domain=');
    const faviconUrl = isFaviconUrl ? info.thumbnail : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostName)}&sz=64`;
    
    // Only render full hero banner if we have a REAL article/video hero image (NOT a favicon)
    const heroThumb = (info.thumbnail && !isFaviconUrl) 
      ? `<div class="embed-hero-wrap"><img src="${esc(info.thumbnail)}" alt="${title}" class="embed-fallback-thumb" onerror="this.parentElement.remove()"></div>` 
      : '';

    // Canonical structure stored in HTML
    return `<div class="paperuss-embed embed-mode-${displayMode} embed-width-${widthPreset}" ` +
      `data-paperuss-embed="true" ` +
      `data-provider="${provider}" ` +
      `data-content-type="${contentType}" ` +
      `data-canonical-url="${canonicalUrl}" ` +
      `data-embed-url="${embedUrl}" ` +
      `data-display-mode="${displayMode}" ` +
      `data-width-preset="${widthPreset}" ` +
      `data-preferred-height="${preferredHeight}" ` +
      `contenteditable="false">` +
      `<div class="embed-canonical-card">` +
      `<div class="embed-canonical-header">` +
      `<div class="embed-provider-badge-wrap">` +
      `<img src="${esc(faviconUrl)}" class="embed-favicon-icon" alt="" onerror="this.style.display='none'">` +
      `<span class="embed-provider-badge">${providerName}</span>` +
      `</div>` +
      `<a href="${canonicalUrl}" class="embed-canonical-link" target="_blank" rel="noopener noreferrer">${canonicalUrl}</a>` +
      `</div>` +
      `${heroThumb}` +
      `<div class="embed-canonical-body">` +
      `<div class="embed-canonical-text">` +
      `<strong>${title}</strong>` +
      `${desc}` +
      `</div>` +
      `</div>` +
      `</div>` +
      `</div>`;
  }

  /**
   * Returns approved sandbox and allow permissions per provider.
   */
  function getProviderSecurityAttrs(provider) {
    switch (provider) {
      case 'facebook':
        return {
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
          allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share'
        };
      case 'youtube':
      case 'vimeo':
      case 'spotify':
      case 'soundcloud':
      case 'tiktok':
      case 'instagram':
        return {
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
          allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture'
        };
      case 'google-maps':
        return {
          sandbox: 'allow-scripts allow-same-origin',
          allow: 'fullscreen'
        };
      default:
        return {
          sandbox: 'allow-scripts allow-same-origin',
          allow: ''
        };
    }
  }

  /**
   * Dehydrates all embed blocks inside rootElement before saving, exporting, or cloud sync.
   * Removes any temporary editor UI (toolbar overlays, resize handles, active iframes)
   * so only pure canonical markup is persisted.
   */
  function dehydrateEmbeds(rootElement) {
    if (!rootElement) return;
    const embeds = rootElement.querySelectorAll('.paperuss-embed[data-paperuss-embed="true"]');
    embeds.forEach(embed => {
      embed.removeAttribute('data-hydrated');
      embed._needsRehydration = false;
      // Remove temporary UI elements
      const toolbars = embed.querySelectorAll('.embed-editor-toolbar, .embed-resize-handle, .embed-live-player-wrap');
      toolbars.forEach(el => el.remove());
      // Ensure canonical card is visible
      const canonicalCard = embed.querySelector('.embed-canonical-card');
      if (canonicalCard) {
        canonicalCard.style.display = '';
      }
    });
  }

  /**
   * Hydrates all embed blocks inside rootElement for editor interaction.
   * Generates interactive players (iframes) or rich cards according to display mode,
   * and attaches transient Embed Management toolbar overlays.
   */
  function hydrateEmbeds(rootElement) {
    if (!rootElement) return;
    const embeds = rootElement.querySelectorAll('.paperuss-embed[data-paperuss-embed="true"]');
    const isOnline = typeof navigator !== 'undefined' && navigator.onLine !== false;

    embeds.forEach(embed => {
      if (embed.getAttribute('data-hydrated') === 'true' && !embed._needsRehydration) return;
      embed.setAttribute('data-hydrated', 'true');
      embed._needsRehydration = false;

      const provider = embed.getAttribute('data-provider') || 'unknown';
      const canonicalUrl = embed.getAttribute('data-canonical-url') || '';
      const embedUrl = embed.getAttribute('data-embed-url') || '';
      const displayMode = embed.getAttribute('data-display-mode') || 'interactive';
      const widthPreset = embed.getAttribute('data-width-preset') || 'medium';
      const preferredHeight = parseInt(embed.getAttribute('data-preferred-height'), 10) || 400;

      // Ensure class matches mode & width
      embed.className = `paperuss-embed embed-mode-${displayMode} embed-width-${widthPreset}`;

      // Clean old transient UI if any
      const oldUI = embed.querySelectorAll('.embed-editor-toolbar, .embed-resize-handle, .embed-live-player-wrap');
      oldUI.forEach(el => el.remove());

      const canonicalCard = embed.querySelector('.embed-canonical-card');

      // If in interactive mode and we have a safe embedUrl and we are online
      if (displayMode === 'interactive' && embedUrl && isOnline) {
        if (canonicalCard) canonicalCard.style.display = 'none';

        const security = getProviderSecurityAttrs(provider);
        const playerWrap = document.createElement('div');
        playerWrap.className = 'embed-live-player-wrap';

        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.title = `${provider} embed`;
        iframe.setAttribute('style', `border:none;overflow:hidden;width:100%;height:${preferredHeight}px;`);
        iframe.style.width = '100%';
        iframe.style.height = `${preferredHeight}px`;
        iframe.setAttribute('scrolling', 'no');
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('loading', 'lazy');
        if (security.sandbox) iframe.setAttribute('sandbox', security.sandbox);
        if (security.allow) iframe.setAttribute('allow', security.allow);

        // Failure/blocked detection
        iframe.onerror = () => {
          playerWrap.remove();
          if (canonicalCard) {
            canonicalCard.style.display = '';
            const textEl = canonicalCard.querySelector('.embed-canonical-text strong');
            if (textEl) textEl.textContent = `${provider} post unavailable.`;
          }
        };

        playerWrap.appendChild(iframe);

        // Add source footer
        const footer = document.createElement('div');
        footer.className = 'embed-player-footer';
        footer.innerHTML = `<a href="${esc(canonicalUrl)}" target="_blank" rel="noopener noreferrer">Open on ${esc(provider)}</a>`;
        playerWrap.appendChild(footer);

        embed.appendChild(playerWrap);
      } else {
        // Compact or Preview or Offline mode -> show canonical card
        if (canonicalCard) {
          canonicalCard.style.display = '';
          if (!isOnline) {
            const badge = canonicalCard.querySelector('.embed-provider-badge');
            if (badge && !badge.textContent.includes('(Offline)')) {
              badge.textContent = `${badge.textContent} (Offline)`;
            }
          }
        }
      }

      // If inside editable noteBody, attach Embed Management Toolbar overlay
      if (embed.closest('#noteBody') && !embed.querySelector('.embed-editor-toolbar')) {
        const toolbar = buildEmbedEditorToolbar(embed);
        embed.insertBefore(toolbar, embed.firstChild);
      }
    });
  }

  /**
   * Builds the transient Embed Management overlay toolbar.
   */
  function buildEmbedEditorToolbar(embed) {
    const bar = document.createElement('div');
    bar.className = 'embed-editor-toolbar';
    bar.setAttribute('contenteditable', 'false');

    const canonicalUrl = embed.getAttribute('data-canonical-url') || '';
    const displayMode = embed.getAttribute('data-display-mode') || 'interactive';
    const widthPreset = embed.getAttribute('data-width-preset') || 'medium';

    bar.innerHTML = `
      <div class="embed-tb-group">
        <button type="button" class="embed-tb-btn" data-action="edit-url" title="Edit URL">Edit URL</button>
        <select class="embed-tb-select" data-action="mode" title="Display Mode" aria-label="Display Mode">
          <option value="compact" ${displayMode === 'compact' ? 'selected' : ''}>Compact</option>
          <option value="preview" ${displayMode === 'preview' ? 'selected' : ''}>Preview</option>
          <option value="interactive" ${displayMode === 'interactive' ? 'selected' : ''}>Interactive</option>
        </select>
        <select class="embed-tb-select" data-action="width" title="Width" aria-label="Width Preset">
          <option value="small" ${widthPreset === 'small' ? 'selected' : ''}>Small</option>
          <option value="medium" ${widthPreset === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="large" ${widthPreset === 'large' ? 'selected' : ''}>Large</option>
          <option value="full" ${widthPreset === 'full' ? 'selected' : ''}>Full Width</option>
        </select>
      </div>
      <div class="embed-tb-group">
        <button type="button" class="embed-tb-btn" data-action="refresh" title="Refresh Metadata">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
        </button>
        <button type="button" class="embed-tb-btn" data-action="copy" title="Copy Link">
          <i data-lucide="copy" class="w-3.5 h-3.5"></i>
        </button>
        <a href="${esc(canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="embed-tb-btn" title="Open Source">
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
        </a>
        <button type="button" class="embed-tb-btn embed-tb-btn-danger" data-action="remove" title="Remove Embed">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    // Event listeners
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const act = btn.getAttribute('data-action');
      if (act === 'remove') {
        embed.remove();
        if (typeof global.toast === 'function') global.toast('Embed removed');
        if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
      } else if (act === 'copy') {
        if (navigator.clipboard && canonicalUrl) {
          navigator.clipboard.writeText(canonicalUrl);
          if (typeof global.toast === 'function') global.toast('Link copied to clipboard');
        }
      } else if (act === 'refresh') {
        embed._needsRehydration = true;
        embed.removeAttribute('data-hydrated');
        hydrateEmbeds(embed.parentElement || document.getElementById('noteBody'));
        if (typeof global.toast === 'function') global.toast('Embed refreshed');
      } else if (act === 'edit-url') {
        openEmbedModal({
          initialUrl: canonicalUrl,
          targetEmbed: embed
        });
      }
    });

    const modeSel = bar.querySelector('select[data-action="mode"]');
    if (modeSel) {
      modeSel.addEventListener('change', (e) => {
        embed.setAttribute('data-display-mode', e.target.value);
        embed._needsRehydration = true;
        embed.removeAttribute('data-hydrated');
        hydrateEmbeds(embed.parentElement || document.getElementById('noteBody'));
        if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
      });
    }

    const widthSel = bar.querySelector('select[data-action="width"]');
    if (widthSel) {
      widthSel.addEventListener('change', (e) => {
        embed.setAttribute('data-width-preset', e.target.value);
        embed._needsRehydration = true;
        embed.removeAttribute('data-hydrated');
        hydrateEmbeds(embed.parentElement || document.getElementById('noteBody'));
        if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
      });
    }

    return bar;
  }

  /**
   * Helper to save selection in noteBody.
   */
  let savedEditorRange = null;
  function saveEditorSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const noteBody = document.getElementById('noteBody');
      if (noteBody && noteBody.contains(range.commonAncestorContainer)) {
        savedEditorRange = range.cloneRange();
        return;
      }
    }
    savedEditorRange = null;
  }

  function restoreEditorSelection() {
    const sel = window.getSelection();
    if (sel && savedEditorRange) {
      sel.removeAllRanges();
      sel.addRange(savedEditorRange);
    }
  }

  /**
   * Opens the viewport-safe Embed Tool dialog modal.
   */
  function openEmbedModal(options = {}) {
    saveEditorSelection();

    const root = document.getElementById('modalRoot');
    if (!root) return;

    const initialUrl = options.initialUrl || '';
    const initialText = options.initialText || (window.getSelection ? window.getSelection().toString().trim() : '');
    const targetEmbed = options.targetEmbed || null;
    const defaultMode = options.defaultMode || options.initialMode || (initialText ? 'inline' : 'preview');

    root.innerHTML = `
      <div class="modal-overlay">
        <div class="embed-modal-card" role="dialog" aria-label="Embed or Link URL">
          <div class="embed-modal-header">
            <h3><i data-lucide="link" class="w-5 h-5 mr-1 inline"></i> Insert Link & Embed Tool</h3>
            <button type="button" class="changelog-close" id="embedModalClose" aria-label="Close"><i data-lucide="x"></i></button>
          </div>
          <div class="embed-modal-body">
            <div class="embed-modal-field">
              <label for="embedUrlInput">Web Address, Email, or Embed URL</label>
              <input type="text" id="embedUrlInput" class="link-modal-input" placeholder="e.g. https://example.com, github.com, YouTube or Spotify link..." value="${esc(initialUrl)}" autocomplete="off" spellcheck="false">
              <div class="embed-modal-hint" id="embedProviderBadge">Supports web links, email, YouTube, Vimeo, Spotify, SoundCloud, TikTok, Instagram, Facebook, X, Google Maps</div>
            </div>
            <div class="embed-modal-field">
              <label for="embedTextInput">Display Text (optional for Inline Link)</label>
              <input type="text" id="embedTextInput" class="link-modal-input" placeholder="Text to display in note" value="${esc(initialText)}" autocomplete="off">
            </div>
            <div class="embed-modal-field">
              <label>Display Mode</label>
              <div class="embed-mode-picker">
                <label class="embed-mode-option">
                  <input type="radio" name="embedMode" value="inline" ${defaultMode === 'inline' ? 'checked' : ''}>
                  <span>Inline Link</span>
                </label>
                <label class="embed-mode-option">
                  <input type="radio" name="embedMode" value="compact" ${defaultMode === 'compact' ? 'checked' : ''}>
                  <span>Compact Card</span>
                </label>
                <label class="embed-mode-option">
                  <input type="radio" name="embedMode" value="preview" ${defaultMode === 'preview' ? 'checked' : ''}>
                  <span>Rich Preview</span>
                </label>
                <label class="embed-mode-option">
                  <input type="radio" name="embedMode" value="interactive" ${defaultMode === 'interactive' ? 'checked' : ''}>
                  <span>Interactive Embed</span>
                </label>
              </div>
            </div>
            <div class="embed-modal-preview-section">
              <label>Live Preview</label>
              <div class="embed-live-preview-box" id="embedLivePreviewBox">
                <div class="embed-preview-empty">Paste a URL above to preview</div>
              </div>
            </div>
          </div>
          <div class="embed-modal-actions">
            <button type="button" class="btn" id="embedModalCancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="embedModalSubmit">Insert Link / Embed</button>
          </div>
        </div>
      </div>
    `;

    if (typeof global.lucide?.createIcons === 'function') global.lucide.createIcons();

    const urlInput = document.getElementById('embedUrlInput');
    const textInput = document.getElementById('embedTextInput');
    const badgeEl = document.getElementById('embedProviderBadge');
    const previewBox = document.getElementById('embedLivePreviewBox');
    const submitBtn = document.getElementById('embedModalSubmit');
    const cancelBtn = document.getElementById('embedModalCancel');
    const closeBtn = document.getElementById('embedModalClose');

    let currentDetectedInfo = null;

    function updatePreview() {
      const val = urlInput.value.trim();
      const txtVal = textInput.value.trim() || initialText || val;
      if (!val) {
        badgeEl.textContent = 'Supports web links, email, YouTube, Vimeo, Spotify, SoundCloud, TikTok, Instagram, Facebook, X, Google Maps';
        previewBox.innerHTML = '<div class="embed-preview-empty">Paste a URL above to preview</div>';
        currentDetectedInfo = null;
        return;
      }
      const info = detectEmbedProvider(val);
      currentDetectedInfo = info;
      const selectedMode = document.querySelector('input[name="embedMode"]:checked')?.value || 'inline';

      if (selectedMode === 'inline' || !info) {
        const normUrl = global.LinkParser ? global.LinkParser.normalizeUrl(val) : (val.startsWith('http') ? val : 'https://' + val);
        const displayLabel = txtVal || normUrl;
        let host = '';
        try { host = new URL(normUrl).hostname; } catch(_) {}
        const faviconSrc = host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
        const faviconHtml = faviconSrc ? `<img src="${esc(faviconSrc)}" class="inline-link-icon" alt="" onerror="this.style.display='none'">` : '';
        badgeEl.textContent = info ? `Detected Provider: ${info.providerName} (${info.contentType}) · Inline Link Mode` : 'Web / Email Link';
        previewBox.innerHTML = `<div class="embed-preview-card" style="padding:16px;font-size:14px;display:flex;align-items:center;gap:8px;">Inline Link Preview: <a href="${esc(normUrl)}" class="paperuss-inline-link" target="_blank" rel="noopener noreferrer">${faviconHtml}<span>${esc(displayLabel)}</span></a></div>`;
        return;
      }

      badgeEl.textContent = `Detected Provider: ${info.providerName} (${info.contentType})`;
      info.displayMode = selectedMode;
      const canonicalHtml = buildCanonicalEmbedHtml(info);
      previewBox.innerHTML = canonicalHtml;
      // Hydrate preview for live demo
      hydrateEmbeds(previewBox);
    }

    urlInput.addEventListener('input', updatePreview);
    textInput.addEventListener('input', updatePreview);
    document.querySelectorAll('input[name="embedMode"]').forEach(radio => {
      radio.addEventListener('change', updatePreview);
    });

    const closeModal = () => {
      root.innerHTML = '';
      const noteBody = document.getElementById('noteBody');
      if (noteBody) noteBody.focus();
    };

    if (cancelBtn) cancelBtn.onclick = closeModal;
    if (closeBtn) closeBtn.onclick = closeModal;

    if (submitBtn) {
      submitBtn.onclick = () => {
        const val = urlInput.value.trim();
        if (!val) {
          if (typeof global.toast === 'function') global.toast('Please enter a URL or email address');
          urlInput.focus();
          return;
        }

        const selectedMode = document.querySelector('input[name="embedMode"]:checked')?.value || 'inline';
        const txtVal = textInput.value.trim() || initialText;

        restoreEditorSelection();

        if (selectedMode === 'inline' || !currentDetectedInfo) {
          // Insert standard inline <a> hyperlink with favicon & accent highlight
          const parsed = global.LinkParser ? global.LinkParser.parseAndValidateUrl(val) : { valid: true, url: val.startsWith('http') ? val : 'https://' + val, isExternal: true };
          const finalUrl = parsed.url || val;
          const displayLabel = txtVal || finalUrl;
          const targetAttr = parsed.isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
          let host = '';
          try { host = new URL(finalUrl).hostname; } catch(_) {}
          const faviconSrc = host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
          const faviconHtml = faviconSrc ? `<img src="${esc(faviconSrc)}" class="inline-link-icon" alt="" onerror="this.style.display='none'">` : '';

          const ed = document.getElementById('noteBody');
          const curSel = window.getSelection();
          if (curSel && curSel.rangeCount && !curSel.isCollapsed && ed && ed.contains(curSel.anchorNode)) {
            document.execCommand('createLink', false, finalUrl);
            const anchor = (curSel.anchorNode.nodeType === 3 ? curSel.anchorNode.parentElement : curSel.anchorNode).closest?.('a');
            if (anchor) {
              anchor.className = 'paperuss-inline-link';
              anchor.innerHTML = `${faviconHtml}<span>${esc(displayLabel)}</span>`;
              if (parsed.isExternal) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
            }
          } else {
            const linkHtml = `<a href="${esc(finalUrl)}" class="paperuss-inline-link"${targetAttr}>${faviconHtml}<span>${esc(displayLabel)}</span></a>`;
            if (typeof global.insertHTMLAtCaret === 'function') {
              global.insertHTMLAtCaret(linkHtml + '&nbsp;');
            } else if (ed) {
              ed.insertAdjacentHTML('beforeend', linkHtml + '&nbsp;');
            }
          }
          if (typeof global.handleBodyInput === 'function') global.handleBodyInput();
          closeModal();
          if (typeof global.toast === 'function') global.toast('Link inserted');
          if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
          return;
        }

        // Rich card / Interactive embed mode
        if (targetEmbed && currentDetectedInfo) {
          // Editing existing embed
          currentDetectedInfo.displayMode = selectedMode;
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = buildCanonicalEmbedHtml(currentDetectedInfo);
          const newEmbed = tempDiv.firstElementChild;
          targetEmbed.replaceWith(newEmbed);
          hydrateEmbeds(newEmbed.parentElement || document.getElementById('noteBody'));
        } else if (currentDetectedInfo) {
          // Insert new embed block
          currentDetectedInfo.displayMode = selectedMode;
          const canonicalHtml = buildCanonicalEmbedHtml(currentDetectedInfo);
          if (typeof global.insertHTMLAtCaret === 'function') {
            global.insertHTMLAtCaret(canonicalHtml + '<p><br></p>');
          } else {
            const noteBody = document.getElementById('noteBody');
            if (noteBody) noteBody.insertAdjacentHTML('beforeend', canonicalHtml + '<p><br></p>');
          }
          const noteBody = document.getElementById('noteBody');
          if (noteBody) hydrateEmbeds(noteBody);
        }

        closeModal();
        if (typeof global.toast === 'function') global.toast(`Inserted ${currentDetectedInfo.providerName} embed`);
        if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
      };
    }

    // Run initial preview if URL or text was passed
    if (initialUrl || initialText) {
      updatePreview();
    }
    setTimeout(() => urlInput.focus(), 50);
  }

  // Export module APIs
  global.EmbedTool = Object.freeze({
    detectEmbedProvider,
    buildCanonicalEmbedHtml,
    hydrateEmbeds,
    dehydrateEmbeds,
    openEmbedModal
  });

  global.detectEmbedProvider = detectEmbedProvider;
  global.buildCanonicalEmbedHtml = buildCanonicalEmbedHtml;
  global.hydrateEmbeds = hydrateEmbeds;
  global.dehydrateEmbeds = dehydrateEmbeds;
  global.openEmbedModal = openEmbedModal;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
