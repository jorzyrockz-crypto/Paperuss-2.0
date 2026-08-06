/* ============================================================
   PAPERUSS 2.0 LINK PARSER UTILITY
   URL normalization, security validation, trailing punctuation cleanup,
   and social media platform detection.
   ============================================================ */
(function (global) {
  'use strict';

  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

  const PLATFORM_MAP = [
    { key: 'youtube', name: 'YouTube', match: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i },
    { key: 'twitter', name: 'X / Twitter', match: /(?:^|\.)(?:x\.com|twitter\.com|t\.co)$/i },
    { key: 'github', name: 'GitHub', match: /(?:^|\.)github\.com$/i },
    { key: 'linkedin', name: 'LinkedIn', match: /(?:^|\.)(?:linkedin\.com|lnkd\.in)$/i },
    { key: 'instagram', name: 'Instagram', match: /(?:^|\.)(?:instagram\.com|instagr\.am)$/i },
    { key: 'tiktok', name: 'TikTok', match: /(?:^|\.)tiktok\.com$/i },
    { key: 'facebook', name: 'Facebook', match: /(?:^|\.)(?:facebook\.com|fb\.me|fb\.com)$/i },
    { key: 'reddit', name: 'Reddit', match: /(?:^|\.)(?:reddit\.com|redd\.it)$/i },
    { key: 'medium', name: 'Medium', match: /(?:^|\.)medium\.com$/i },
    { key: 'spotify', name: 'Spotify', match: /(?:^|\.)spotify\.com$/i },
    { key: 'twitch', name: 'Twitch', match: /(?:^|\.)twitch\.tv$/i },
    { key: 'discord', name: 'Discord', match: /(?:^|\.)(?:discord\.com|discord\.gg)$/i },
    { key: 'vimeo', name: 'Vimeo', match: /(?:^|\.)vimeo\.com$/i }
  ];

  /**
   * Cleans trailing punctuation accidentally captured from surrounding text.
   * e.g., "https://github.com." -> "https://github.com"
   * e.g., "(https://github.com/repo)" -> "https://github.com/repo"
   */
  function cleanTrailingPunctuation(str) {
    if (!str) return '';
    let cleaned = String(str).trim();

    // Strip matching wrapping parentheses if captured like (https://example.com)
    if (cleaned.startsWith('(') && cleaned.endsWith(')') && !cleaned.slice(1, -1).includes(')')) {
      cleaned = cleaned.slice(1, -1).trim();
    }
    // Strip matching wrapping square brackets if captured like [https://example.com]
    if (cleaned.startsWith('[') && cleaned.endsWith(']') && !cleaned.slice(1, -1).includes(']')) {
      cleaned = cleaned.slice(1, -1).trim();
    }

    // Remove trailing punctuation: . , ; : ! ? ) ] } unless part of valid query/hash
    cleaned = cleaned.replace(/[.,;:!?)]+$/g, '');
    return cleaned;
  }

  /**
   * Normalizes a raw URL string:
   * - Strips surrounding whitespace & trailing punctuation
   * - Detects plain email addresses and prepends mailto:
   * - Prepends 'https://' if no protocol specified (e.g., 'github.com' -> 'https://github.com')
   */
  function normalizeUrl(rawUrl) {
    let urlStr = cleanTrailingPunctuation(rawUrl);
    if (!urlStr) return '';

    // Check if plain email format without mailto:
    if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(urlStr)) {
      return `mailto:${urlStr}`;
    }

    // Check if protocol exists (e.g. http:, https:, mailto:, javascript:)
    const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(urlStr);
    if (!hasProtocol) {
      // Prepend https:// for naked domain or path
      urlStr = `https://${urlStr}`;
    }

    return urlStr;
  }

  /**
   * Detects social media or major platform from a hostname.
   */
  function detectPlatform(hostname) {
    if (!hostname) return { key: null, name: null };
    const host = String(hostname).toLowerCase().replace(/^www\./, '');
    for (const p of PLATFORM_MAP) {
      if (p.match.test(host)) {
        return { key: p.key, name: p.name };
      }
    }
    return { key: null, name: null };
  }

  /**
   * Validates and parses a raw URL input string.
   * Returns:
   * {
   *   valid: boolean,
   *   url: string,
   *   protocol: string,
   *   hostname: string,
   *   isExternal: boolean,
   *   platform: string|null,
   *   platformName: string|null,
   *   error?: string
   * }
   */
  function parseAndValidateUrl(rawInput) {
    if (!rawInput || !String(rawInput).trim()) {
      return { valid: false, error: 'Please enter a URL or email address.' };
    }

    const normalized = normalizeUrl(rawInput);
    if (!normalized) {
      return { valid: false, error: 'Please enter a valid URL.' };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(normalized);
    } catch (e) {
      return { valid: false, error: 'Invalid URL format. Please check the domain or web address.' };
    }

    const protocol = parsedUrl.protocol.toLowerCase();

    // Enforce protocol whitelist
    if (!ALLOWED_PROTOCOLS.has(protocol)) {
      return {
        valid: false,
        error: `Security restriction: '${protocol}' protocol is not allowed. Only http, https, and mailto links are supported.`
      };
    }

    // Validate http / https
    if (protocol === 'http:' || protocol === 'https:') {
      const hostname = parsedUrl.hostname;
      if (!hostname) {
        return { valid: false, error: 'URL must contain a valid domain name or IP address.' };
      }

      // Check localhost, IP address, or valid TLD domain structure
      const isLocal = hostname === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.endsWith('.local');
      const hasDotDomain = hostname.includes('.') && hostname.split('.').pop().length >= 2;

      if (!isLocal && !hasDotDomain) {
        return { valid: false, error: 'Please enter a valid domain name (e.g., github.com or example.org).' };
      }
    }

    // Validate mailto:
    if (protocol === 'mailto:') {
      const emailPath = parsedUrl.pathname;
      if (!emailPath || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(emailPath)) {
        return { valid: false, error: 'Please enter a valid email address (e.g., name@example.com).' };
      }
    }

    const isExternal = protocol === 'http:' || protocol === 'https:';
    const platformInfo = detectPlatform(parsedUrl.hostname);

    return {
      valid: true,
      url: normalized,
      protocol: protocol,
      hostname: parsedUrl.hostname || '',
      isExternal: isExternal,
      platform: platformInfo.key,
      platformName: platformInfo.name
    };
  }

  /**
   * Resolves relative image paths against a source base URL to turn relative URLs
   * into absolute HTTPS URLs, per Meta Open Graph image specification.
   */
  function resolveImageUrl(imgUrl, baseUrl) {
    if (!imgUrl || typeof imgUrl !== 'string') return null;
    const cleanImg = imgUrl.trim();
    if (!cleanImg) return null;
    if (/^https?:\/\//i.test(cleanImg) || cleanImg.startsWith('data:')) {
      return cleanImg;
    }
    if (!baseUrl) return cleanImg;
    try {
      return new URL(cleanImg, baseUrl).href;
    } catch (_) {
      return cleanImg;
    }
  }

  /**
   * Extracts Meta Open Graph & Twitter Card tags in standard Meta Debugger priority order.
   */
  function extractMetaTags(docOrHtml, sourceUrl) {
    if (!docOrHtml) return null;
    let doc = docOrHtml;
    if (typeof docOrHtml === 'string') {
      try {
        doc = new DOMParser().parseFromString(docOrHtml, 'text/html');
      } catch (_) {
        return null;
      }
    }

    const getMeta = (props) => {
      for (const p of props) {
        const el = doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
        if (el && el.getAttribute('content')) {
          const val = el.getAttribute('content').trim();
          if (val) return val;
        }
      }
      return null;
    };

    const title = getMeta(['og:title', 'twitter:title', 'title']) || doc.querySelector('title')?.textContent?.trim() || null;
    const description = getMeta(['og:description', 'twitter:description', 'description']) || null;
    const rawImage = getMeta(['og:image', 'og:image:src', 'twitter:image', 'twitter:image:src']) || 
                     doc.querySelector('link[rel="image_src"]')?.getAttribute('href') || null;
    const resolvedImage = rawImage ? resolveImageUrl(rawImage, sourceUrl) : null;
    const canonicalUrl = getMeta(['og:url', 'twitter:url']) || doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || sourceUrl || null;
    const siteName = getMeta(['og:site_name', 'application-name']) || null;

    return {
      title,
      description,
      image: resolvedImage,
      url: canonicalUrl,
      siteName
    };
  }

  const metaCache = new Map();

  /**
   * Clears metadata cache for a URL (Manual Rescrape / Scrape Again).
   */
  function scrapeAgain(url) {
    if (!url) {
      metaCache.clear();
      return true;
    }
    return metaCache.delete(url);
  }

  const LinkParser = Object.freeze({
    cleanTrailingPunctuation,
    normalizeUrl,
    detectPlatform,
    parseAndValidateUrl,
    resolveImageUrl,
    extractMetaTags,
    scrapeAgain,
    ALLOWED_PROTOCOLS: Array.from(ALLOWED_PROTOCOLS)
  });

  global.LinkParser = LinkParser;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global));
