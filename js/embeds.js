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

    let urlStr = inputStr;
    // Extract URL if input is a raw HTML <iframe> snippet
    const iframeMatch = urlStr.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
      urlStr = iframeMatch[1];
    }

    // 2. Normalize standard URL via LinkParser if available
    if (typeof global.LinkParser?.normalizeUrl === 'function') {
      urlStr = global.LinkParser.normalizeUrl(urlStr);
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
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
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
          brandColor: '#ff0000',
          title: null,
          description: null,
          thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          author: null
        };
      }
    }

    // Vimeo: video
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const vimeoMatch = path.match(/^\/(?:video\/)?(\d+)/);
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

    // Spotify: track, album, playlist, episode, artist, show (including /embed/ URLs)
    if (host === 'spotify.com' || host === 'open.spotify.com') {
      const spMatch = path.match(/^\/(?:embed\/)?(track|album|playlist|episode|artist|show)\/([a-zA-Z0-9]+)/i);
      if (spMatch && spMatch[1] && spMatch[2]) {
        const type = spMatch[1].toLowerCase();
        const id = spMatch[2];
        return {
          provider: 'spotify',
          providerName: 'Spotify',
          contentType: type,
          canonicalUrl: `https://open.spotify.com/${type}/${id}`,
          embedUrl: `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`,
          preferredHeight: (type === 'track' || type === 'playlist') ? 152 : 352,
          widthPreset: 'medium',
          displayMode: 'interactive',
          brandColor: '#1ed760',
          title: `Spotify ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          description: `https://open.spotify.com/${type}/${id}`,
          thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
          author: 'Spotify'
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

    // Spotify: track, album, playlist, episode, artist, show
    if (host === 'spotify.com' || host === 'open.spotify.com') {
      const spMatch = path.match(/^\/(track|album|playlist|episode|artist|show)\/([a-zA-Z0-9]+)/);
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
          brandColor: '#1ed760',
          title: `Spotify ${type.charAt(0).toUpperCase() + type.slice(1)}`,
          description: urlStr,
          thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
          author: 'Spotify'
        };
      }
    }

    // Shopee: e-commerce product links
    if (/shopee\.(com|ph|sg|id|tw|vn|co\.th|cl|com\.br)/.test(host)) {
      return {
        provider: 'shopee',
        providerName: 'Shopee',
        contentType: 'product',
        canonicalUrl: urlStr,
        embedUrl: null,
        preferredHeight: 220,
        widthPreset: 'medium',
        displayMode: 'preview',
        brandColor: '#ee4d2d',
        title: `Shopee Product`,
        description: urlStr,
        thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
        author: 'Shopee Official Store'
      };
    }

    // Temu: e-commerce product links
    if (/temu\.(com|to)/.test(host)) {
      return {
        provider: 'temu',
        providerName: 'Temu',
        contentType: 'product',
        canonicalUrl: urlStr,
        embedUrl: null,
        preferredHeight: 220,
        widthPreset: 'medium',
        displayMode: 'preview',
        brandColor: '#fb7701',
        title: `Temu Product & Deal`,
        description: urlStr,
        thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
        author: 'Temu Store'
      };
    }

    // Lazada: e-commerce product links
    if (/lazada\.(com|com\.ph|sg|co\.id|com\.my|vn|co\.th)/.test(host)) {
      return {
        provider: 'lazada',
        providerName: 'Lazada',
        contentType: 'product',
        canonicalUrl: urlStr,
        embedUrl: null,
        preferredHeight: 220,
        widthPreset: 'medium',
        displayMode: 'preview',
        brandColor: '#0f146d',
        title: `Lazada Official Store`,
        description: urlStr,
        thumbnail: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
        author: 'Lazada'
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
      thumbnail: favicon,
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
    const desc = info.description ? esc(info.description) : canonicalUrl;
    
    // Check if thumbnail is a favicon vs real article/video hero image
    const isFaviconUrl = info.thumbnail && info.thumbnail.includes('favicons?domain=');
    let resolvedHeroUrl = info.thumbnail;
    if (resolvedHeroUrl && !isFaviconUrl && global.LinkParser?.resolveImageUrl) {
      resolvedHeroUrl = global.LinkParser.resolveImageUrl(resolvedHeroUrl, canonicalUrl);
    }
    const faviconUrl = isFaviconUrl ? info.thumbnail : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostName)}&sz=64`;
    
    // Render hero image or crisp glassmorphism placeholder banner matching user screenshot
    let heroThumb = '';
    if (resolvedHeroUrl && !isFaviconUrl) {
      heroThumb = `<div class="embed-hero-wrap"><img src="${esc(resolvedHeroUrl)}" alt="${title}" class="embed-fallback-thumb" onerror="this.parentElement.className='embed-hero-wrap embed-hero-placeholder'; this.parentElement.innerHTML='<div class=&quot;embed-glass-hero-badge&quot;><img src=&quot;${faviconUrl}&quot; alt=&quot;${title}&quot; class=&quot;embed-placeholder-thumb&quot;></div>';"></div>`;
    } else {
      heroThumb = `<div class="embed-hero-wrap embed-hero-placeholder"><div class="embed-glass-hero-badge"><img src="${faviconUrl}" alt="${title}" class="embed-placeholder-thumb"></div></div>`;
    }

    const aspectRatio = esc(info.aspectRatio || '16-9');
    const brandColor = esc(info.brandColor || '');

    // Render compact 1-row HERO ICON | LINK layout if displayMode is compact
    let innerCardContent = '';
    if (displayMode === 'compact') {
      innerCardContent = `<div class="embed-compact-card">` +
        `<div class="embed-compact-hero-icon">` +
        `<img src="${faviconUrl}" alt="${title}" class="embed-favicon-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostName)}&sz=64'">` +
        `</div>` +
        `<span class="embed-compact-divider"></span>` +
        `<div class="embed-compact-info">` +
        `<strong class="embed-compact-title" contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${title}</strong>` +
        `<span class="embed-compact-link">Web Embed · ${hostName}</span>` +
        `</div>` +
        `<a href="${canonicalUrl}" target="_blank" rel="noopener noreferrer" class="mc-action-compact" title="Open Link" style="background:var(--accent-soft);color:var(--accent)">` +
        `<i data-lucide="external-link" class="w-4 h-4"></i>` +
        `</a>` +
        `</div>`;
    } else {
      innerCardContent = `<div class="embed-canonical-card">` +
        `<div class="embed-canonical-header">` +
        `<div class="embed-provider-badge-wrap">` +
        `<span class="embed-provider-badge">${hostName}</span>` +
        `</div>` +
        `<a href="${canonicalUrl}" class="embed-canonical-link" target="_blank" rel="noopener noreferrer">${canonicalUrl}</a>` +
        `</div>` +
        `${heroThumb}` +
        `<div class="embed-canonical-body">` +
        `<div class="embed-canonical-text">` +
        `<strong contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${title}</strong>` +
        `<p class="embed-fallback-desc" contenteditable="true" data-action="inline-edit-desc" title="Click to edit description">${desc}</p>` +
        `</div>` +
        `</div>` +
        `</div>`;
    }

    // Canonical structure stored in HTML
    return `<div class="paperuss-embed embed-mode-${displayMode} embed-width-${widthPreset} embed-aspect-${aspectRatio}" ` +
      `data-paperuss-embed="true" ` +
      `data-provider="${provider}" ` +
      `data-content-type="${contentType}" ` +
      `data-canonical-url="${canonicalUrl}" ` +
      `data-embed-url="${embedUrl}" ` +
      `data-display-mode="${displayMode}" ` +
      `data-width-preset="${widthPreset}" ` +
      `data-aspect-ratio="${aspectRatio}" ` +
      `data-brand-color="${brandColor}" ` +
      `data-preferred-height="${preferredHeight}" ` +
      `style="${brandColor ? '--brand-accent:' + brandColor + ';' : ''}" ` +
      `contenteditable="false" draggable="true">` +
      `${innerCardContent}` +
      `<div class="card-resize-handle" title="Drag to resize card"></div>` +
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
          allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; background-play'
        };
      case 'youtube':
      case 'vimeo':
      case 'spotify':
      case 'soundcloud':
      case 'tiktok':
      case 'instagram':
        return {
          sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms',
          allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share; background-play'
        };
      case 'google-maps':
        return {
          sandbox: 'allow-scripts allow-same-origin',
          allow: 'fullscreen'
        };
      default:
        return {
          sandbox: 'allow-scripts allow-same-origin',
          allow: 'autoplay; clipboard-write; encrypted-media; picture-in-picture; background-play'
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

    const soundCards = rootElement.querySelectorAll('.paperuss-card-audio');
    soundCards.forEach(card => {
      card.querySelector('.embed-editor-toolbar')?.remove();
      const audio = card.querySelector('.audio-native-player');
      if (audio) {
        audio.removeAttribute('src');
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
   * Helper to re-serialize canonical embed HTML on settings change for 100% setup persistence.
   */
  function updateEmbedSetup(embed, newAttrs = {}) {
    if (!embed) return;
    const provider = newAttrs.provider || embed.getAttribute('data-provider') || 'web';
    const canonicalUrl = newAttrs.canonicalUrl || embed.getAttribute('data-canonical-url') || '';
    const embedUrl = newAttrs.embedUrl || embed.getAttribute('data-embed-url') || '';
    const contentType = newAttrs.contentType || embed.getAttribute('data-content-type') || 'embed';
    const displayMode = newAttrs.displayMode || embed.getAttribute('data-display-mode') || 'interactive';
    const widthPreset = newAttrs.widthPreset || embed.getAttribute('data-width-preset') || 'medium';
    const aspectRatio = newAttrs.aspectRatio || embed.getAttribute('data-aspect-ratio') || '16-9';
    const brandColor = newAttrs.brandColor || embed.getAttribute('data-brand-color') || '';
    const preferredHeight = newAttrs.preferredHeight || embed.getAttribute('data-preferred-height') || '400';
    
    let title = newAttrs.title;
    if (!title) {
      title = embed.querySelector('.embed-canonical-text strong, .embed-compact-title')?.textContent || provider;
    }
    let description = newAttrs.description;
    if (!description) {
      description = embed.querySelector('.embed-fallback-desc')?.textContent || canonicalUrl;
    }
    const thumbnail = embed.querySelector('.embed-fallback-thumb, .embed-favicon-icon')?.src || null;

    const info = {
      provider,
      providerName: embed.getAttribute('data-provider-name') || provider,
      contentType,
      canonicalUrl,
      embedUrl,
      displayMode,
      widthPreset,
      aspectRatio,
      brandColor,
      preferredHeight,
      title,
      description,
      thumbnail
    };

    const cardWrap = newAttrs.cardWrap || embed.getAttribute('data-card-wrap') || 'none';
    const newHtml = buildCanonicalEmbedHtml(info);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = newHtml;
    const newEmbed = tempDiv.firstElementChild;
    if (newEmbed && embed.parentElement) {
      newEmbed.setAttribute('data-card-wrap', cardWrap);
      embed.replaceWith(newEmbed);
      hydrateEmbeds(newEmbed.parentElement);
      if (typeof global.handleBodyInput === 'function') global.handleBodyInput();
      if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
    }
  }

  /**
   * Builds the transient Embed Management micro-pill overlay toolbar with Lucide icons.
   */
  function buildEmbedEditorToolbar(embed) {
    const bar = document.createElement('div');
    bar.className = 'embed-editor-toolbar';
    bar.setAttribute('contenteditable', 'false');

    const canonicalUrl = embed.getAttribute('data-canonical-url') || '';
    const displayMode = embed.getAttribute('data-display-mode') || 'interactive';
    const widthPreset = embed.getAttribute('data-width-preset') || 'medium';
    const aspectRatio = embed.getAttribute('data-aspect-ratio') || '16-9';
    const currentWrap = embed.getAttribute('data-card-wrap') || 'none';

    const sizeLabels = {
      'small': 'S',
      'medium': 'M',
      'large': 'L',
      'full': 'Full'
    };
    const activeSizeLabel = sizeLabels[widthPreset] || 'M';

    const modeIcons = {
      'compact': 'align-justify',
      'preview': 'image',
      'interactive': 'tv'
    };
    const activeModeIcon = modeIcons[displayMode] || 'tv';

    const wrapIcons = {
      'none': 'rows-2',
      'left': 'panel-left',
      'right': 'panel-right',
      'inline': 'move-horizontal'
    };
    const activeWrapIcon = 'wrap-text';

    bar.innerHTML = `
      <div class="embed-tb-segment">
        <button type="button" class="embed-tb-btn card-drag-handle" title="Drag card to move & snap" style="cursor:grab">
          <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
        </button>
      </div>
      <div class="embed-tb-segment" style="position:relative">
        <button type="button" class="embed-tb-btn" data-action="toggle-size-menu" title="Card Size (${activeSizeLabel})">
          <i data-lucide="scaling" class="w-4 h-4"></i>
        </button>
        <div class="embed-tb-dropdown embed-size-dropdown hidden" contenteditable="false">
          <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('small') ? 'active' : ''}" data-action="set-width" data-val="small">
            <span class="embed-sz-badge">S</span> Small (220px)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('medium') ? 'active' : ''}" data-action="set-width" data-val="medium">
            <span class="embed-sz-badge">M</span> Medium (420px)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('large') ? 'active' : ''}" data-action="set-width" data-val="large">
            <span class="embed-sz-badge">L</span> Large (680px)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'full' ? 'active' : ''}" data-action="set-width" data-val="full">
            <span class="embed-sz-badge">Full</span> Full Width (100%)
          </button>
        </div>
      </div>
      <div class="embed-tb-segment" style="position:relative">
        <button type="button" class="embed-tb-btn" data-action="toggle-wrap-menu" title="Wrap Text Mode">
          <i data-lucide="${activeWrapIcon}" class="w-4 h-4 embed-wrap-icon"></i>
        </button>
        <div class="embed-tb-dropdown embed-wrap-dropdown hidden" contenteditable="false">
          <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'none' ? 'active' : ''}" data-action="set-wrap" data-val="none">
            <i data-lucide="rows-2" class="w-4 h-4"></i> Break Text (No Wrap)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'left' ? 'active' : ''}" data-action="set-wrap" data-val="left">
            <i data-lucide="panel-left" class="w-4 h-4"></i> Wrap Text Right (Float Left)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'right' ? 'active' : ''}" data-action="set-wrap" data-val="right">
            <i data-lucide="panel-right" class="w-4 h-4"></i> Wrap Text Left (Float Right)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'inline' ? 'active' : ''}" data-action="set-wrap" data-val="inline">
            <i data-lucide="move-horizontal" class="w-4 h-4"></i> Inline with Text
          </button>
        </div>
      </div>
      <div class="embed-tb-segment" style="position:relative">
        <button type="button" class="embed-tb-btn" data-action="toggle-mode-menu" title="Display Mode">
          <i data-lucide="${activeModeIcon}" class="w-4 h-4 embed-mode-icon"></i>
        </button>
        <div class="embed-tb-dropdown embed-mode-dropdown hidden" contenteditable="false">
          <button type="button" class="embed-tb-dropdown-item ${displayMode === 'compact' ? 'active' : ''}" data-action="set-mode" data-val="compact">
            <i data-lucide="align-justify" class="w-4 h-4"></i> Compact Card (1-Row)
          </button>
          <button type="button" class="embed-tb-dropdown-item ${displayMode === 'preview' ? 'active' : ''}" data-action="set-mode" data-val="preview">
            <i data-lucide="image" class="w-4 h-4"></i> Rich Preview Card
          </button>
          <button type="button" class="embed-tb-dropdown-item ${displayMode === 'interactive' ? 'active' : ''}" data-action="set-mode" data-val="interactive">
            <i data-lucide="tv" class="w-4 h-4"></i> Live Interactive Embed
          </button>
        </div>
      </div>
      <div class="embed-tb-segment">
        <select class="embed-tb-select" data-action="set-aspect" title="Aspect Ratio">
          <option value="16-9" ${aspectRatio === '16-9' ? 'selected' : ''}>16:9</option>
          <option value="4-3" ${aspectRatio === '4-3' ? 'selected' : ''}>4:3</option>
          <option value="1-1" ${aspectRatio === '1-1' ? 'selected' : ''}>1:1</option>
          <option value="9-16" ${aspectRatio === '9-16' ? 'selected' : ''}>9:16</option>
        </select>
      </div>
      <div class="embed-tb-segment" style="position:relative">
        <button type="button" class="embed-tb-btn" data-action="open-media-info" title="Asset Info & Specs">
          <i data-lucide="info" class="w-3.5 h-3.5"></i>
        </button>
        <button type="button" class="embed-tb-btn" data-action="expand" title="Fullscreen Lightbox">
          <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i>
        </button>
        <button type="button" class="embed-tb-btn" data-action="toggle-more-menu" title="More Options">
          <i data-lucide="more-vertical" class="w-3.5 h-3.5"></i>
        </button>
        <button type="button" class="embed-tb-btn embed-tb-btn-danger" data-action="remove" title="Remove Embed">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
        <div class="embed-tb-dropdown embed-more-menu hidden" contenteditable="false">
          <button type="button" class="embed-more-item" data-action="copy">
            <i data-lucide="copy" class="w-4 h-4"></i> Copy Link
          </button>
          <a href="${esc(canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="embed-more-item">
            <i data-lucide="external-link" class="w-4 h-4"></i> Open Source Link
          </a>
          <button type="button" class="embed-more-item" data-action="edit-url">
            <i data-lucide="edit-3" class="w-4 h-4"></i> Edit Source URL
          </button>
        </div>
      </div>
    `;

    setTimeout(() => {
      if (typeof global.lucide?.createIcons === 'function') global.lucide.createIcons();
    }, 0);

    const closeAllDropdownsExcept = (exceptMenu) => {
      bar.querySelectorAll('.embed-tb-dropdown').forEach(m => {
        if (m !== exceptMenu) m.classList.add('hidden');
      });
    };

    // Event listeners for micro-pill buttons
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button[data-action], a[data-action]');
      if (!btn) return;
      const act = btn.getAttribute('data-action');
      const val = btn.getAttribute('data-val');

      if (act === 'toggle-size-menu') {
        const menu = bar.querySelector('.embed-size-dropdown');
        closeAllDropdownsExcept(menu);
        if (menu) menu.classList.toggle('hidden');
      } else if (act === 'toggle-wrap-menu') {
        const menu = bar.querySelector('.embed-wrap-dropdown');
        closeAllDropdownsExcept(menu);
        if (menu) menu.classList.toggle('hidden');
      } else if (act === 'toggle-mode-menu') {
        const menu = bar.querySelector('.embed-mode-dropdown');
        closeAllDropdownsExcept(menu);
        if (menu) menu.classList.toggle('hidden');
      } else if (act === 'toggle-more-menu') {
        const menu = bar.querySelector('.embed-more-menu');
        closeAllDropdownsExcept(menu);
        if (menu) menu.classList.toggle('hidden');
      } else if (act === 'set-width') {
        updateEmbedSetup(embed, { widthPreset: val });
        bar.querySelectorAll('.embed-size-dropdown .embed-tb-dropdown-item').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-val') === val);
        });
        const labelEl = bar.querySelector('[data-action="toggle-size-menu"] .embed-tb-label');
        if (labelEl) labelEl.textContent = sizeLabels[val] || 'M';
      } else if (act === 'set-wrap') {
        embed.setAttribute('data-card-wrap', val);
        bar.querySelectorAll('.embed-wrap-dropdown .embed-tb-dropdown-item').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-val') === val);
        });
        closeAllDropdownsExcept(null);
        if (typeof handleBodyInput === 'function') handleBodyInput();
        if (typeof save === 'function') save();
      } else if (act === 'toggle-more-menu') {
        const menu = bar.querySelector('.embed-more-menu');
        closeAllDropdownsExcept(menu);
        if (menu) menu.classList.toggle('hidden');
      } else if (act === 'set-width') {
        updateEmbedSetup(embed, { widthPreset: val });
        bar.querySelectorAll('.embed-size-dropdown .embed-tb-dropdown-item').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-val') === val);
        });
        const labelEl = bar.querySelector('[data-action="toggle-size-menu"] .embed-tb-label');
        if (labelEl) labelEl.textContent = sizeLabels[val] || 'M';
      } else if (act === 'set-mode') {
        updateEmbedSetup(embed, { displayMode: val });
        bar.querySelectorAll('.embed-mode-dropdown .embed-tb-dropdown-item').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-val') === val);
        });
      } else if (act === 'remove') {
        closeAllDropdownsExcept(null);
        embed.remove();
        if (typeof global.toast === 'function') global.toast('Embed removed');
        if (typeof global.flushActiveLeaf === 'function') global.flushActiveLeaf();
      } else if (act === 'copy') {
        closeAllDropdownsExcept(null);
        if (navigator.clipboard && canonicalUrl) {
          navigator.clipboard.writeText(canonicalUrl);
          if (typeof global.toast === 'function') global.toast('Link copied to clipboard');
        }
      } else if (act === 'open-media-info') {
        closeAllDropdownsExcept(null);
        const title = embed.querySelector('.embed-canonical-text strong, .embed-compact-title')?.textContent || provider;
        const mediaId = embed.getAttribute('data-media-id') || canonicalUrl;
        const embedInfo = {
          id: mediaId,
          name: title,
          kind: 'link',
          type: `${provider.toUpperCase()} Embed`,
          url: canonicalUrl,
          host: provider,
          createdAt: Date.now()
        };
        if (typeof global.showMediaInfoModal === 'function') {
          global.showMediaInfoModal(embedInfo);
        } else if (typeof showMediaInfoModal === 'function') {
          showMediaInfoModal(embedInfo);
        }
      } else if (act === 'expand') {
        closeAllDropdownsExcept(null);
        openEmbedLightbox(embed);
      } else if (act === 'edit-url') {
        closeAllDropdownsExcept(null);
        openEmbedModal({
          initialUrl: canonicalUrl,
          targetEmbed: embed
        });
      }
    });

    const onOutsideClick = (e) => {
      if (!bar.contains(e.target)) {
        closeAllDropdownsExcept(null);
      }
    };
    document.addEventListener('click', onOutsideClick);

    const aspectSel = bar.querySelector('select[data-action="set-aspect"]');
    if (aspectSel) {
      aspectSel.addEventListener('change', (e) => {
        updateEmbedSetup(embed, { aspectRatio: e.target.value });
      });
    }

    // ── Touch Focus Guard ──────────────────────────────────────────────────
    // Prevent the contenteditable editor from placing a text cursor/caret
    // when the user taps on the card (not on a toolbar button/input/link).
    // Using pointerdown covers both mouse and touch (pen/finger).
    const isInteractiveTarget = (el) =>
      el && el.closest('button, a, input, select, textarea, [contenteditable="true"]');

    embed.addEventListener('pointerdown', (e) => {
      if (!isInteractiveTarget(e.target)) {
        // Prevent the editor from receiving focus and placing a caret
        e.preventDefault();
      }
    });

    // Belt-and-suspenders: also block touchstart default on iOS Safari
    embed.addEventListener('touchstart', (e) => {
      if (!isInteractiveTarget(e.target)) {
        e.preventDefault();
      }
    }, { passive: false });
    // ── End Touch Focus Guard ──────────────────────────────────────────────

    return bar;
  }

  function openEmbedLightbox(embed) {
    const canonicalUrl = embed.getAttribute('data-canonical-url') || '';
    const embedUrl = embed.getAttribute('data-embed-url') || '';
    const title = embed.querySelector('strong')?.textContent || 'Fullscreen Embed View';
    const heroImg = embed.querySelector('.embed-fallback-thumb')?.src || '';

    const root = document.getElementById('modalRoot') || document.body;
    const lightbox = document.createElement('div');
    lightbox.className = 'embed-lightbox-overlay';
    lightbox.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10010;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;';
    
    let contentHtml = '';
    if (embedUrl) {
      contentHtml = `<iframe src="${esc(embedUrl)}" style="width:100%;max-width:960px;height:650px;border:none;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.5);" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"></iframe>`;
    } else if (heroImg) {
      contentHtml = `<img src="${esc(heroImg)}" alt="${esc(title)}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.5);">`;
    } else {
      contentHtml = `<div style="color:#fff;font-size:18px;text-align:center;"><p style="font-weight:700;margin-bottom:12px;">${esc(title)}</p><a href="${esc(canonicalUrl)}" target="_blank" style="color:var(--accent);text-decoration:underline;">${esc(canonicalUrl)}</a></div>`;
    }

    lightbox.innerHTML = `
      <div style="position:absolute;top:20px;right:20px;display:flex;gap:12px;">
        <a href="${esc(canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm" style="color:#fff;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);">Open Link ↗</a>
        <button type="button" class="btn btn-sm" id="closeLightbox" style="color:#fff;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);">✕ Close</button>
      </div>
      ${contentHtml}
    `;

    root.appendChild(lightbox);
    const closeBtn = lightbox.querySelector('#closeLightbox');
    if (closeBtn) closeBtn.onclick = () => lightbox.remove();
    lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.remove(); };
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
        badgeEl.textContent = info ? `Detected Provider: ${info.providerName} (${info.contentType}) · Inline Link Mode` : 'Web / Email Link';
        previewBox.innerHTML = `<div class="embed-preview-card" style="padding:16px;font-size:14px;display:flex;align-items:center;gap:8px;">Inline Link Preview: <a href="${esc(normUrl)}" class="paperuss-inline-link" target="_blank" rel="noopener noreferrer">${esc(displayLabel)}</a></div>`;
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
          // Insert standard inline <a> hyperlink with global accent highlight
          const parsed = global.LinkParser ? global.LinkParser.parseAndValidateUrl(val) : { valid: true, url: val.startsWith('http') ? val : 'https://' + val, isExternal: true };
          const finalUrl = parsed.url || val;
          const displayLabel = txtVal || finalUrl;
          const targetAttr = parsed.isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

          const ed = document.getElementById('noteBody');
          const curSel = window.getSelection();
          if (curSel && curSel.rangeCount && !curSel.isCollapsed && ed && ed.contains(curSel.anchorNode)) {
            document.execCommand('createLink', false, finalUrl);
            const anchor = (curSel.anchorNode.nodeType === 3 ? curSel.anchorNode.parentElement : curSel.anchorNode).closest?.('a');
            if (anchor) {
              anchor.className = 'paperuss-inline-link';
              anchor.textContent = displayLabel;
              if (parsed.isExternal) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
            }
          } else {
            const linkHtml = `<a href="${esc(finalUrl)}" class="paperuss-inline-link"${targetAttr}>${esc(displayLabel)}</a>`;
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
  global.updateEmbedSetup = updateEmbedSetup;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
