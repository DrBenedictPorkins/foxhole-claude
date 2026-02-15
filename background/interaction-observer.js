/**
 * Passive Interaction Observer
 *
 * Silently learns which DOM selectors work on a site by analyzing completed
 * tool calls (click_element, type_text, query_selector, etc.). Discovered
 * patterns are injected into Claude's system prompt so it already knows
 * working selectors before the user asks.
 *
 * Mirrors the API Observer architecture. Does not modify tool execution.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const CONFIG = {
    maxPatternsPerDomain: 200,
    persistDebounceMs: 5000,
    maxPromptPatterns: 40,
    minHitsForPrompt: 1,
    storageKey: 'claude_interaction_observer',
  };

  // ---------------------------------------------------------------------------
  // Tool definitions
  // ---------------------------------------------------------------------------

  // Tools where input.selector is the selector to capture
  const SELECTOR_TOOLS = new Map([
    ['click_element', 'click'],
    ['type_text', 'type'],
    ['query_selector', 'query'],
    ['scroll_to_element', 'scroll'],
    ['hover_element', 'hover'],
    ['focus_element', 'focus'],
    ['select_option', 'select'],
    ['set_checkbox', 'checkbox'],
    ['get_element_properties', 'props'],
  ]);

  // Tools where input.fields keys are selectors (each key captured separately)
  const MULTI_SELECTOR_TOOLS = new Map([
    ['fill_form', 'fill'],
  ]);

  // ---------------------------------------------------------------------------
  // Pattern storage (in-memory)
  // ---------------------------------------------------------------------------

  // Map<domain, Map<selector, patternData>>
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

  function processToolResult(toolName, toolInput, toolResult, domain) {
    if (!toolInput || !domain) return;

    // Skip failures
    if (toolResult && toolResult.error) return;

    const now = Date.now();
    let selectors = [];
    let toolLabel = null;

    if (SELECTOR_TOOLS.has(toolName)) {
      toolLabel = SELECTOR_TOOLS.get(toolName);
      let sel = toolInput.selector;
      if (sel && typeof sel === 'string') {
        // Cap selector length to prevent bloated storage
        if (sel.length > 100) {
          sel = sel.slice(0, 100);
        }
        selectors.push(sel);
      }
    } else if (MULTI_SELECTOR_TOOLS.has(toolName)) {
      toolLabel = MULTI_SELECTOR_TOOLS.get(toolName);
      if (toolInput.fields && typeof toolInput.fields === 'object') {
        selectors = Object.keys(toolInput.fields).filter(k => typeof k === 'string' && k.length > 0);
      }
    } else {
      return; // Not a tracked tool
    }

    if (selectors.length === 0 || !toolLabel) return;

    const patterns = getOrCreateDomain(domain);

    for (const selector of selectors) {
      if (patterns.has(selector)) {
        // Merge into existing
        const existing = patterns.get(selector);
        existing.hitCount++;
        existing.lastSeen = now;
        if (!existing.tools.includes(toolLabel)) {
          existing.tools.push(toolLabel);
        }
      } else {
        // New pattern
        patterns.set(selector, {
          selector,
          tools: [toolLabel],
          hitCount: 1,
          firstSeen: now,
          lastSeen: now,
        });

        // Enforce max patterns per domain - evict lowest hitCount
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
      // Truncate long selectors
      const sel = p.selector.length > 45 ? p.selector.slice(0, 42) + '...' : p.selector;
      const padded = sel.padEnd(47);
      const tools = p.tools.join(', ');
      lines.push(`${padded} ${tools.padEnd(18)} (${p.hitCount}x)`);
    }

    return (
      '\n\n' +
      String.fromCodePoint(0x2554) + String.fromCodePoint(0x2550).repeat(62) + String.fromCodePoint(0x2557) + '\n' +
      String.fromCodePoint(0x2551) + '  KNOWN DOM PATTERNS (auto-discovered)' + ' '.repeat(23) + String.fromCodePoint(0x2551) + '\n' +
      String.fromCodePoint(0x255A) + String.fromCodePoint(0x2550).repeat(62) + String.fromCodePoint(0x255D) + '\n' +
      '\n' +
      'Selectors that worked on previous visits. Try these first.\n' +
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
      console.warn('[InteractionObserver] Persist error:', e);
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
      console.log(`[InteractionObserver] Loaded patterns for ${domainPatterns.size} domain(s)`);
    } catch (e) {
      console.warn('[InteractionObserver] Load error:', e);
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

  function getPatternCount(domain) {
    if (!domain) return 0;
    const patterns = domainPatterns.get(domain);
    return patterns ? patterns.size : 0;
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

  window.InteractionObserver = {
    processToolResult,
    formatForPrompt,
    getPatterns,
    getPatternCount,
    clearDomain,
    clearAll,
    loadFromStorage,
  };

  console.log('[InteractionObserver] Passive interaction observer loaded');
})();
