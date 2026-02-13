/**
 * Passive API Observer
 *
 * Silently learns what API endpoints a site uses by analyzing completed
 * network requests. Discovered patterns are injected into Claude's system
 * prompt so it already knows the site's API surface before the user asks.
 *
 * Sits between existing webRequest capture (tool-router.js) and prompt
 * building (background.js). Does not modify either system.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const CONFIG = {
    maxPatternsPerDomain: 100,
    persistDebounceMs: 5000,
    maxPromptPatterns: 30,
    minHitsForPrompt: 2,
    storageKey: 'claude_api_observer',
  };

  // ---------------------------------------------------------------------------
  // Noise filters
  // ---------------------------------------------------------------------------

  const TRACKING_DOMAINS = new Set([
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.com',
    'connect.facebook.net',
    'segment.io',
    'api.segment.io',
    'cdn.segment.com',
    'mixpanel.com',
    'api.mixpanel.com',
    'hotjar.com',
    'static.hotjar.com',
    'sentry.io',
    'newrelic.com',
    'bam.nr-data.net',
    'bugsnag.com',
    'notify.bugsnag.com',
    'browser-intake-datadoghq.com',
    'amplitude.com',
    'api.amplitude.com',
    'fullstory.com',
    'rs.fullstory.com',
    'logrocket.com',
    'r.lr-ingest.io',
    'clarity.ms',
    'googlesyndication.com',
    'adservice.google.com',
    'pagead2.googlesyndication.com',
  ]);

  const NOISY_PATH_RE = /^\/(?:favicon\.ico|robots\.txt|sw\.js)|^\/_next\/static\/|^\/static\/(?:js|css)\/|^\/assets\/|^\/fonts\/|^\/sockjs-node\/|\.hot-update\./;
  const HASHED_SEGMENT_RE = /[a-f0-9]{20,}\./;

  const USEFUL_CONTENT_TYPES = [
    'json',
    'xml',
    'text/plain',
    'text/html',
    'form',
    'graphql',
    'protobuf',
    'grpc',
  ];

  /**
   * Returns true if the request looks like a real API call worth tracking.
   */
  function shouldObserve(request) {
    if (request.type !== 'xmlhttprequest') return false;
    if (!request.statusCode || request.statusCode === 0) return false;

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return false;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    // Check tracking domains (match suffix)
    const hostname = url.hostname;
    for (const tracker of TRACKING_DOMAINS) {
      if (hostname === tracker || hostname.endsWith('.' + tracker)) return false;
    }

    // Check noisy paths
    if (NOISY_PATH_RE.test(url.pathname)) return false;

    // Check hashed filenames in any path segment
    const segments = url.pathname.split('/');
    for (const seg of segments) {
      if (HASHED_SEGMENT_RE.test(seg)) return false;
    }

    // Content-type filter
    const ct = (request.responseContentType || '').toLowerCase();
    if (ct) {
      const isUseful = USEFUL_CONTENT_TYPES.some((t) => ct.includes(t));
      if (!isUseful) return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // URL normalization
  // ---------------------------------------------------------------------------

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const MONGO_ID_RE = /^[0-9a-f]{24}$/i;
  const NUMERIC_RE = /^\d+$/;
  const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;
  const LONG_TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;
  const KEBAB_WORDS_RE = /^[a-z]+-[a-z]+(-[a-z]+)*$/;

  function normalizeSegment(seg) {
    if (!seg) return seg;
    if (UUID_RE.test(seg)) return '{uuid}';
    if (MONGO_ID_RE.test(seg)) return '{id}';
    if (NUMERIC_RE.test(seg)) return '{id}';
    if (LONG_HEX_RE.test(seg)) return '{hash}';
    if (LONG_TOKEN_RE.test(seg) && !KEBAB_WORDS_RE.test(seg)) return '{token}';
    return seg;
  }

  /**
   * Normalizes a URL to a pattern string: /api/v2/users/{id}/posts
   * Also returns sorted query parameter keys.
   */
  function normalizeUrlPath(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      return null;
    }

    const segments = url.pathname.split('/').map(normalizeSegment);
    const normalizedPath = segments.join('/') || '/';

    const queryParams = Array.from(url.searchParams.keys()).sort();

    return { path: normalizedPath, queryParams };
  }

  // ---------------------------------------------------------------------------
  // Pattern storage (in-memory)
  // ---------------------------------------------------------------------------

  // Map<domain, Map<patternKey, patternData>>
  const domainPatterns = new Map();

  function getOrCreateDomain(domain) {
    if (!domainPatterns.has(domain)) {
      domainPatterns.set(domain, new Map());
    }
    return domainPatterns.get(domain);
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  function processCompletedRequest(request) {
    if (!shouldObserve(request)) return;

    let url;
    try {
      url = new URL(request.url);
    } catch {
      return;
    }

    const domain = url.hostname.replace(/^www\./, '');
    const normalized = normalizeUrlPath(request.url);
    if (!normalized) return;

    const method = (request.method || 'GET').toUpperCase();
    const patternKey = `${method} ${normalized.path}`;

    const patterns = getOrCreateDomain(domain);
    const now = Date.now();

    // Extract auth header names (never values)
    const authHeaders = [];
    if (request.requestHeaders) {
      for (const h of request.requestHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'authorization' || name === 'x-api-key' || name === 'x-auth-token' || name === 'x-csrf-token') {
          authHeaders.push(h.name);
        }
      }
    }

    // Content type (response)
    const contentType = (request.responseContentType || '').split(';')[0].trim();

    if (patterns.has(patternKey)) {
      // Merge into existing
      const existing = patterns.get(patternKey);
      existing.hitCount++;
      existing.lastSeen = now;
      existing.sampleUrl = request.url;

      if (request.statusCode && !existing.statusCodes.includes(request.statusCode)) {
        existing.statusCodes.push(request.statusCode);
      }

      for (const p of normalized.queryParams) {
        if (!existing.queryParams.includes(p)) {
          existing.queryParams.push(p);
        }
      }

      for (const h of authHeaders) {
        if (!existing.authHeaders.includes(h)) {
          existing.authHeaders.push(h);
        }
      }

      if (contentType && !existing.contentType) {
        existing.contentType = contentType;
      }
    } else {
      // New pattern
      patterns.set(patternKey, {
        method,
        pattern: normalized.path,
        domain,
        queryParams: normalized.queryParams,
        statusCodes: request.statusCode ? [request.statusCode] : [],
        contentType: contentType || '',
        authHeaders,
        hitCount: 1,
        firstSeen: now,
        lastSeen: now,
        sampleUrl: request.url,
      });

      // Enforce max patterns per domain — evict lowest hitCount
      if (patterns.size > CONFIG.maxPatternsPerDomain) {
        let minKey = null;
        let minHits = Infinity;
        for (const [key, data] of patterns) {
          if (data.hitCount < minHits) {
            minHits = data.hitCount;
            minKey = key;
          }
        }
        if (minKey) patterns.delete(minKey);
      }
    }

    schedulePersist();
  }

  // ---------------------------------------------------------------------------
  // Prompt formatting
  // ---------------------------------------------------------------------------

  function formatForPrompt(domain) {
    const patterns = domainPatterns.get(domain);
    if (!patterns) return null;

    // Filter to patterns with enough hits, sort by hitCount desc
    const qualifying = [];
    for (const data of patterns.values()) {
      if (data.hitCount >= CONFIG.minHitsForPrompt) {
        qualifying.push(data);
      }
    }

    if (qualifying.length === 0) return null;

    qualifying.sort((a, b) => b.hitCount - a.hitCount);
    const top = qualifying.slice(0, CONFIG.maxPromptPatterns);

    const lines = [];
    for (const p of top) {
      let line = `${p.method.padEnd(6)} ${p.pattern}`;

      const meta = [];
      if (p.statusCodes.length > 0) {
        meta.push(p.statusCodes.join(','));
      }
      if (p.contentType) {
        const short = p.contentType.replace('application/', '').replace('text/', '');
        meta.push(short);
      }
      if (p.authHeaders.length > 0) {
        meta.push('auth: ' + p.authHeaders.join(', '));
      }
      if (p.queryParams.length > 0) {
        meta.push('params: ' + p.queryParams.join(', '));
      }

      if (meta.length > 0) {
        line += '  [' + meta.join('] [') + ']';
      }

      line += `  (${p.hitCount}x)`;
      lines.push(line);
    }

    return (
      '\n\n' +
      String.fromCodePoint(0x2554) + String.fromCodePoint(0x2550).repeat(62) + String.fromCodePoint(0x2557) + '\n' +
      String.fromCodePoint(0x2551) + '  OBSERVED API PATTERNS (auto-discovered)' + ' '.repeat(20) + String.fromCodePoint(0x2551) + '\n' +
      String.fromCodePoint(0x255A) + String.fromCodePoint(0x2550).repeat(62) + String.fromCodePoint(0x255D) + '\n' +
      '\n' +
      'Endpoints passively observed on this domain. Use them directly.\n' +
      'To save one permanently, use save_site_spec with type "api".\n' +
      '\n' +
      lines.join('\n') +
      '\n\n' +
      String.fromCodePoint(0x2550).repeat(63) +
      '\n'
    );
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  let persistTimer = null;

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      await persistToStorage();
    }, CONFIG.persistDebounceMs);
  }

  async function persistToStorage() {
    try {
      const serializable = {};
      for (const [domain, patterns] of domainPatterns) {
        serializable[domain] = {};
        for (const [key, data] of patterns) {
          serializable[domain][key] = data;
        }
      }
      await browser.storage.local.set({ [CONFIG.storageKey]: serializable });
    } catch (e) {
      console.warn('[ApiObserver] Persist error:', e);
    }
  }

  async function loadFromStorage() {
    try {
      const result = await browser.storage.local.get(CONFIG.storageKey);
      const stored = result[CONFIG.storageKey];
      if (!stored) return;

      for (const [domain, patterns] of Object.entries(stored)) {
        const map = new Map();
        for (const [key, data] of Object.entries(patterns)) {
          map.set(key, data);
        }
        domainPatterns.set(domain, map);
      }
      console.log(`[ApiObserver] Loaded patterns for ${domainPatterns.size} domain(s)`);
    } catch (e) {
      console.warn('[ApiObserver] Load error:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function getPatterns(domain) {
    if (domain) {
      const patterns = domainPatterns.get(domain);
      return patterns ? Object.fromEntries(patterns) : {};
    }
    const all = {};
    for (const [d, patterns] of domainPatterns) {
      all[d] = Object.fromEntries(patterns);
    }
    return all;
  }

  function clearDomain(domain) {
    domainPatterns.delete(domain);
    schedulePersist();
  }

  function clearAll() {
    domainPatterns.clear();
    schedulePersist();
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  loadFromStorage();

  window.ApiObserver = {
    processCompletedRequest,
    formatForPrompt,
    getPatterns,
    clearDomain,
    clearAll,
    loadFromStorage,
  };

  console.log('[ApiObserver] Passive API observer loaded');
})();
