/**
 * Site Knowledge System
 * Unified storage for site-specific knowledge learned by Claude
 *
 * Consolidates the former Experiences and SiteSpecs systems into a single API.
 *
 * Data Model:
 * {
 *   id: string,
 *   domain: string,           // 'amazon.com' or '*' for global
 *   path: string,             // '*' or '/specific/path'
 *   type: 'dom' | 'issue' | 'shortcut' | 'api' | 'behavior',
 *   title: string,            // Short description
 *   content: string,          // The actual knowledge
 *   selector: string | null,  // Optional CSS selector
 *   created: number,          // timestamp
 *   lastUsed: number,         // timestamp
 *   useCount: number,
 *   expiryDays: number        // Default 60
 * }
 */

// Storage keys
const STORAGE_KEY = 'claude_site_knowledge';
const META_KEY = 'claude_site_knowledge_meta';
const RAW_KEY = 'claude_site_knowledge_raw';
const MIGRATION_FLAG = 'claude_site_knowledge_migrated';

// Legacy storage keys (for migration)
const LEGACY_EXPERIENCES_KEY = 'claude_experiences';
const LEGACY_SPECS_KEY = 'claude_site_notes';
const LEGACY_SPECS_META_KEY = 'claude_site_notes_meta';
const LEGACY_RAW_KEY = 'claude_raw_notes';

// Defaults
const DEFAULT_EXPIRY_DAYS = 60;
const MAX_ITEMS_PER_DOMAIN = 50;

// ============================================================================
// MIGRATION
// ============================================================================

/**
 * Check if migration is needed and perform it
 * @returns {Promise<boolean>} True if migration was performed
 */
async function ensureMigrated() {
  const data = await browser.storage.local.get(MIGRATION_FLAG);
  if (data[MIGRATION_FLAG]) {
    return false; // Already migrated
  }

  console.log('[SiteKnowledge] Starting migration from legacy storage...');

  const knowledge = {};

  // Migrate Experiences (claude_experiences)
  const expData = await browser.storage.local.get(LEGACY_EXPERIENCES_KEY);
  const experiences = expData[LEGACY_EXPERIENCES_KEY] || {};

  for (const domain in experiences) {
    if (!knowledge[domain]) {
      knowledge[domain] = [];
    }

    for (const exp of experiences[domain]) {
      knowledge[domain].push({
        id: exp.id || generateId(),
        domain: domain,
        path: exp.context === 'any' ? '*' : (exp.context || '*'),
        type: 'issue',
        title: exp.issue,
        content: exp.solution,
        selector: exp.selector || null,
        created: new Date(exp.created).getTime() || Date.now(),
        lastUsed: new Date(exp.lastUsed).getTime() || Date.now(),
        useCount: exp.useCount || 0,
        expiryDays: DEFAULT_EXPIRY_DAYS
      });
    }
  }

  // Migrate SiteSpecs (claude_site_notes)
  const specData = await browser.storage.local.get(LEGACY_SPECS_KEY);
  const specs = specData[LEGACY_SPECS_KEY] || {};

  for (const domain in specs) {
    if (!knowledge[domain]) {
      knowledge[domain] = [];
    }

    for (const spec of specs[domain]) {
      // Build content from spec fields
      let content = spec.content || '';

      // If no content, build from legacy fields
      if (!content) {
        const parts = [];

        if (spec.happy_path && spec.happy_path.length > 0) {
          parts.push('Steps:\n' + spec.happy_path.map((s, i) => `${i + 1}. ${s}`).join('\n'));
        }

        if (spec.selectors && Object.keys(spec.selectors).length > 0) {
          parts.push('Selectors:\n' + Object.entries(spec.selectors)
            .map(([name, sel]) => `- ${name}: ${sel}`)
            .join('\n'));
        }

        if (spec.avoid && spec.avoid.length > 0) {
          parts.push('Avoid:\n' + spec.avoid.map(a => `- ${a}`).join('\n'));
        }

        content = parts.join('\n\n');
      }

      knowledge[domain].push({
        id: spec.id || generateId(),
        domain: domain,
        path: spec.path || '*',
        type: spec.type || 'dom',
        title: spec.goal || spec.description || 'Untitled',
        content: content,
        selector: null,
        created: new Date(spec.created).getTime() || Date.now(),
        lastUsed: new Date(spec.lastUsed).getTime() || Date.now(),
        useCount: 0,
        expiryDays: DEFAULT_EXPIRY_DAYS
      });
    }
  }

  // Migrate raw specs
  const rawData = await browser.storage.local.get(LEGACY_RAW_KEY);
  const rawSpecs = rawData[LEGACY_RAW_KEY] || {};
  const migratedRaw = {};

  for (const domain in rawSpecs) {
    migratedRaw[domain] = {
      content: rawSpecs[domain].content,
      updated: new Date(rawSpecs[domain].updated).getTime() || Date.now()
    };
  }

  // Migrate meta
  const metaData = await browser.storage.local.get(LEGACY_SPECS_META_KEY);
  const legacyMeta = metaData[LEGACY_SPECS_META_KEY] || {};
  const migratedMeta = {};

  for (const domain in legacyMeta) {
    migratedMeta[domain] = {
      lastReviewed: legacyMeta[domain].lastReviewed
        ? new Date(legacyMeta[domain].lastReviewed).getTime()
        : null
    };
  }

  // Save migrated data
  await browser.storage.local.set({
    [STORAGE_KEY]: knowledge,
    [RAW_KEY]: migratedRaw,
    [META_KEY]: migratedMeta,
    [MIGRATION_FLAG]: true
  });

  // Clear legacy storage
  await browser.storage.local.remove([
    LEGACY_EXPERIENCES_KEY,
    LEGACY_SPECS_KEY,
    LEGACY_SPECS_META_KEY,
    LEGACY_RAW_KEY
  ]);

  const totalItems = Object.values(knowledge).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`[SiteKnowledge] Migration complete. Migrated ${totalItems} items across ${Object.keys(knowledge).length} domains.`);

  return true;
}

// ============================================================================
// CORE CRUD OPERATIONS
// ============================================================================

/**
 * Get all knowledge items for a domain
 * @param {string} domain - The domain to lookup (e.g., "amazon.com")
 * @param {string} [path] - Optional path filter
 * @returns {Promise<Array>} Array of knowledge objects
 */
async function get(domain, path) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  // Clean up expired items
  await cleanupExpired(knowledge);

  const items = knowledge[domain] || [];

  if (path) {
    return items.filter(item => matchesPath(item.path, path));
  }

  return items;
}

/**
 * Get all knowledge across all domains
 * @returns {Promise<Object>} All knowledge keyed by domain
 */
async function getAll() {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};
  await cleanupExpired(knowledge);
  return knowledge;
}

/**
 * Add a new knowledge item for a domain
 * @param {string} domain - The domain
 * @param {Object} item - The knowledge item
 * @returns {Promise<Object|null>} The saved item with ID, or null if duplicate
 */
async function add(domain, item) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  if (!knowledge[domain]) {
    knowledge[domain] = [];
  }

  // Check for duplicate by title (case-insensitive) or near-identical content
  const normalizeContent = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const newContent = normalizeContent(item.content);
  const isDuplicate = knowledge[domain].some(existing =>
    existing.title.toLowerCase() === item.title.toLowerCase() ||
    (newContent.length > 20 && normalizeContent(existing.content) === newContent)
  );

  if (isDuplicate) {
    console.log('[SiteKnowledge] Skipping duplicate item:', item.title);
    return null;
  }

  const now = Date.now();
  const newItem = {
    id: generateId(),
    domain: domain,
    path: item.path || '*',
    type: item.type || 'dom',
    title: item.title,
    content: item.content || '',
    selector: item.selector || null,
    created: now,
    lastUsed: now,
    useCount: 0,
    expiryDays: item.expiryDays || DEFAULT_EXPIRY_DAYS
  };

  knowledge[domain].push(newItem);

  // Keep only last MAX_ITEMS_PER_DOMAIN
  if (knowledge[domain].length > MAX_ITEMS_PER_DOMAIN) {
    // Remove oldest items first
    knowledge[domain].sort((a, b) => b.lastUsed - a.lastUsed);
    knowledge[domain] = knowledge[domain].slice(0, MAX_ITEMS_PER_DOMAIN);
  }

  await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
  console.log('[SiteKnowledge] Added item for', domain, ':', newItem.title);

  return newItem;
}

/**
 * Update an existing knowledge item
 * @param {string} domain - The domain
 * @param {string} id - The item ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated item or null if not found
 */
async function update(domain, id, updates) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  if (!knowledge[domain]) {
    console.log('[SiteKnowledge] Domain not found:', domain);
    return null;
  }

  const index = knowledge[domain].findIndex(item => item.id === id);
  if (index === -1) {
    console.log('[SiteKnowledge] Item not found:', id);
    return null;
  }

  const existing = knowledge[domain][index];
  const updated = {
    ...existing,
    ...updates,
    // Preserve immutable fields
    id: existing.id,
    domain: existing.domain,
    created: existing.created,
    lastUsed: Date.now()
  };

  knowledge[domain][index] = updated;
  await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
  console.log('[SiteKnowledge] Updated item:', id, 'for', domain);

  return updated;
}

/**
 * Delete a knowledge item
 * @param {string} domain - The domain
 * @param {string} id - The item ID
 * @returns {Promise<boolean>} True if deleted
 */
async function deleteItem(domain, id) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  if (!knowledge[domain]) {
    return false;
  }

  const originalLength = knowledge[domain].length;
  knowledge[domain] = knowledge[domain].filter(item => item.id !== id);

  if (knowledge[domain].length === originalLength) {
    return false;
  }

  // Remove domain key if empty
  if (knowledge[domain].length === 0) {
    delete knowledge[domain];
  }

  await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
  console.log('[SiteKnowledge] Deleted item:', id, 'from', domain);

  return true;
}

/**
 * Clear all knowledge for a domain
 * @param {string} domain - The domain
 * @returns {Promise<void>}
 */
async function clear(domain) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  if (knowledge[domain]) {
    delete knowledge[domain];
    await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
    console.log('[SiteKnowledge] Cleared all items for', domain);
  }
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get knowledge items for a specific path, including global domain
 * @param {string} domain - The domain
 * @param {string} path - The URL path
 * @returns {Promise<Array>} Filtered items
 */
async function getForPath(domain, path) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  await cleanupExpired(knowledge);

  // Get domain-specific items
  const domainItems = (knowledge[domain] || []).filter(item =>
    matchesPath(item.path, path)
  );

  // Get global items
  let globalItems = [];
  if (domain !== '*') {
    globalItems = (knowledge['*'] || []).filter(item =>
      matchesPath(item.path, path)
    );
  }

  return [...domainItems, ...globalItems];
}

/**
 * Get count of knowledge items for a domain
 * @param {string} domain - The domain
 * @returns {Promise<number>}
 */
async function getCount(domain) {
  const items = await get(domain);
  return items.length;
}

/**
 * Check if a path matches a pattern
 * @param {string} pattern - The pattern ('*' or '/specific/path')
 * @param {string} path - The actual path
 * @returns {boolean}
 */
function matchesPath(pattern, path) {
  if (!pattern || pattern === '*') return true;

  const patterns = pattern.split(',').map(p => p.trim());
  return patterns.some(p => p === '*' || p === path || path.startsWith(p));
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse LEARNED blocks from Claude's response
 * @param {string} response - Claude's full response text
 * @returns {Array} Array of parsed knowledge objects
 */
function parseLearnedBlocks(response) {
  const items = [];
  const regex = /<!--LEARNED\s*([\s\S]*?)-->/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    const block = match[1].trim();
    const parsed = parseKeyValueBlock(block, {
      titleKey: 'issue',
      contentKey: 'solution',
      defaultType: 'issue'
    });

    if (parsed) {
      items.push(parsed);
    }
  }

  return items;
}

/**
 * Parse SPEC blocks from Claude's response
 * @param {string} response - Claude's full response text
 * @returns {Array} Array of parsed knowledge objects
 */
function parseSpecBlocks(response) {
  const items = [];
  const regex = /<!--SPEC\s*([\s\S]*?)-->/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    const block = match[1].trim();
    const parsed = parseKeyValueBlock(block, {
      titleKey: 'description',
      contentKey: 'content',
      defaultType: 'dom'
    });

    if (parsed) {
      items.push(parsed);
    }
  }

  return items;
}

/**
 * Parse a key-value block (shared logic for LEARNED and SPEC)
 * @param {string} block - The block content
 * @param {Object} options - Parsing options
 * @returns {Object|null} Parsed object or null
 */
function parseKeyValueBlock(block, options) {
  const { titleKey, contentKey, defaultType } = options;

  const result = {
    type: defaultType,
    domain: null,
    path: '*',
    title: null,
    content: null,
    selector: null
  };

  const lines = block.split('\n');
  let inContent = false;
  let contentLines = [];
  let unmatchedLines = [];

  for (const line of lines) {
    if (inContent) {
      contentLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Parse known keys
    if (trimmed.startsWith('type:')) {
      result.type = trimmed.slice(5).trim();
    } else if (trimmed.startsWith('domain:')) {
      result.domain = trimmed.slice(7).trim();
    } else if (trimmed.startsWith('path:')) {
      result.path = trimmed.slice(5).trim();
    } else if (trimmed.startsWith('selector:')) {
      result.selector = trimmed.slice(9).trim();
    } else if (trimmed.startsWith('context:')) {
      // Legacy: context maps to path
      const ctx = trimmed.slice(8).trim();
      result.path = ctx === 'any' ? '*' : ctx;
    } else if (trimmed.startsWith(`${titleKey}:`) || trimmed.startsWith('goal:')) {
      // Handle both titleKey (issue/description) and goal (legacy)
      const keyLen = trimmed.startsWith('goal:') ? 5 : titleKey.length + 1;
      result.title = trimmed.slice(keyLen).trim();
    } else if (trimmed.startsWith(`${contentKey}:`) || trimmed.startsWith('solution:')) {
      // Handle both contentKey and solution (legacy)
      const keyLen = trimmed.startsWith('solution:') ? 9 : contentKey.length + 1;
      const inlineContent = trimmed.slice(keyLen).trim();
      if (inlineContent && inlineContent !== '|') {
        result.content = inlineContent;
      } else {
        inContent = true;
      }
    } else {
      unmatchedLines.push(line);
    }
  }

  // Process multiline content
  if (contentLines.length > 0) {
    result.content = dedentBlock(contentLines);
  }

  // Fallback: use unmatched lines as content
  if (!result.content && unmatchedLines.length > 0) {
    const dedented = dedentBlock(unmatchedLines);
    if (dedented) {
      result.content = dedented;
    }
  }

  // Must have at least title
  if (!result.title) {
    console.warn('[SiteKnowledge] Invalid block - missing title');
    return null;
  }

  return result;
}

/**
 * Remove common leading whitespace from lines
 * @param {Array<string>} lines - Lines to dedent
 * @returns {string} Dedented content
 */
function dedentBlock(lines) {
  const nonEmptyLines = lines.filter(l => l.trim());
  if (nonEmptyLines.length === 0) return '';

  const minIndent = Math.min(...nonEmptyLines.map(l => {
    const match = l.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }));

  return lines
    .map(l => l.slice(minIndent))
    .join('\n')
    .trim();
}

/**
 * Strip all knowledge blocks from response for display
 * @param {string} response - Claude's full response
 * @returns {string} Response with LEARNED and SPEC blocks removed
 */
function stripKnowledgeBlocks(response) {
  return response
    .replace(/<!--LEARNED\s*[\s\S]*?-->\s*/g, '')
    .replace(/<!--SPEC\s*[\s\S]*?-->\s*/g, '');
}

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Format knowledge items for injection into system prompt
 * @param {Array} items - Array of knowledge objects
 * @param {string} domain - The domain name
 * @returns {string} Formatted string for system prompt
 */
function formatForPrompt(items, domain) {
  if (!items || items.length === 0) return '';

  const MAX_SPECS_IN_PROMPT = 15;

  // Sort by relevance: most recently used first, then by creation date
  const sorted = [...items].sort((a, b) => {
    // Prioritize frequently used specs
    const aScore = (a.useCount || 0) + ((a.lastUsed || a.created) / 1e12);
    const bScore = (b.useCount || 0) + ((b.lastUsed || b.created) / 1e12);
    return bScore - aScore;
  }).slice(0, MAX_SPECS_IN_PROMPT);

  // Extract profile (always first, distinct formatting)
  const profile = sorted.find(item => item.type === 'profile');
  const rest = sorted.filter(item => item.type !== 'profile');

  let text = '\n\n';

  // Render profile first with distinct formatting
  if (profile) {
    text += '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\n';
    text += '\u2551  SITE PROFILE \u2014 READ THIS FIRST                            \u2551\n';
    text += '\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n\n';
    text += profile.content + '\n\n';
    text += '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n';
  }

  text += `## SITE SPECS — ${domain.toUpperCase()} (newest first; on conflict use newer)\n\n`;

  for (const item of rest) {
    const age = getRelativeAge(item.created);
    const typeBadge = item.type ? `[${item.type}]` : '';

    const diffDays = item.created ? Math.floor((Date.now() - item.created) / 86400000) : 0;
    let staleBadge = '';
    if (diffDays > 60) {
      staleBadge = ' [STALE — verify before using]';
    } else if (diffDays > 21) {
      staleBadge = ' [aging]';
    }

    // spec_id inlined in heading — Claude needs it to call delete_site_spec on any spec
    const idSuffix = item.id ? ` #${item.id}` : '';
    text += `### ${item.title} ${typeBadge} ${age ? `(${age})` : ''}${staleBadge}${idSuffix}\n`;

    if (item.content) {
      const escapedContent = item.content.replace(/```/g, '`\u200B``');
      text += '```\n' + escapedContent + '\n```\n\n';
    }

    if (item.selector) {
      text += `**Selector:** \`${item.selector}\`\n\n`;
    }
  }

  return text;
}

/**
 * Get relative age string for a timestamp
 * @param {number} timestamp - Unix timestamp in ms
 * @returns {string} Relative age string
 */
function getRelativeAge(timestamp) {
  if (!timestamp) return '';

  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 5) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string|null} Domain (e.g., "amazon.com") or null
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    // Remove www. prefix for consistency
    return urlObj.hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

/**
 * Mark a knowledge item as used
 * @param {string} domain - The domain
 * @param {string} id - The item ID
 * @param {boolean} [success=true] - Whether the knowledge was helpful
 * @returns {Promise<void>}
 */
async function markUsed(domain, id, success = true) {
  await ensureMigrated();

  const data = await browser.storage.local.get(STORAGE_KEY);
  const knowledge = data[STORAGE_KEY] || {};

  if (!knowledge[domain]) return;

  const item = knowledge[domain].find(i => i.id === id);
  if (item) {
    item.lastUsed = Date.now();
    item.useCount = (item.useCount || 0) + 1;
    if (success) {
      item.successCount = (item.successCount || 0) + 1;
    }
    await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
  }
}

/**
 * Generate a unique ID
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ============================================================================
// EXPIRY / CLEANUP
// ============================================================================

/**
 * Remove items that haven't been used past their expiry
 * @param {Object} knowledge - The knowledge object (modified in place)
 * @returns {Promise<void>}
 */
async function cleanupExpired(knowledge) {
  const now = Date.now();
  let cleaned = false;

  for (const domain in knowledge) {
    const original = knowledge[domain].length;

    knowledge[domain] = knowledge[domain].filter(item => {
      const expiryMs = (item.expiryDays || DEFAULT_EXPIRY_DAYS) * 24 * 60 * 60 * 1000;
      const lastUsed = item.lastUsed || item.created;
      return (now - lastUsed) < expiryMs;
    });

    if (knowledge[domain].length === 0) {
      delete knowledge[domain];
      cleaned = true;
    } else if (knowledge[domain].length < original) {
      cleaned = true;
    }
  }

  if (cleaned) {
    await browser.storage.local.set({ [STORAGE_KEY]: knowledge });
  }
}

// ============================================================================
// REVIEW TRACKING
// ============================================================================

/**
 * Get count of NEW items added since last review
 * @param {string} domain - The domain
 * @returns {Promise<number>}
 */
async function getNewCount(domain) {
  const items = await get(domain);
  const lastReviewed = await getLastReviewed(domain);

  if (!lastReviewed) {
    return items.length;
  }

  return items.filter(item => item.created > lastReviewed).length;
}

/**
 * Get last-reviewed timestamp for a domain
 * @param {string} domain - The domain
 * @returns {Promise<number|null>} Timestamp or null
 */
async function getLastReviewed(domain) {
  await ensureMigrated();

  const data = await browser.storage.local.get(META_KEY);
  const meta = data[META_KEY] || {};
  return meta[domain]?.lastReviewed || null;
}

/**
 * Set last-reviewed timestamp for a domain to now
 * @param {string} domain - The domain
 * @returns {Promise<void>}
 */
async function setLastReviewed(domain) {
  await ensureMigrated();

  const data = await browser.storage.local.get(META_KEY);
  const meta = data[META_KEY] || {};

  if (!meta[domain]) {
    meta[domain] = {};
  }
  meta[domain].lastReviewed = Date.now();

  await browser.storage.local.set({ [META_KEY]: meta });
}

// ============================================================================
// RAW MARKDOWN
// ============================================================================

/**
 * Set raw markdown content for a domain
 * @param {string} domain - The domain
 * @param {string} content - Raw markdown content
 * @returns {Promise<boolean>} Success
 */
async function setRaw(domain, content) {
  await ensureMigrated();

  const data = await browser.storage.local.get(RAW_KEY);
  const raw = data[RAW_KEY] || {};

  if (content && content.trim()) {
    raw[domain] = {
      content: content,
      updated: Date.now()
    };
  } else {
    delete raw[domain];
  }

  await browser.storage.local.set({ [RAW_KEY]: raw });
  console.log('[SiteKnowledge] Set raw content for', domain);
  return true;
}

/**
 * Get raw markdown content for a domain
 * @param {string} domain - The domain
 * @returns {Promise<string|null>} Raw markdown or null
 */
async function getRaw(domain) {
  await ensureMigrated();

  const data = await browser.storage.local.get(RAW_KEY);
  const raw = data[RAW_KEY] || {};
  return raw[domain]?.content || null;
}

// ============================================================================
// EXPORT
// ============================================================================

if (typeof window !== 'undefined') {
  window.SiteKnowledge = {
    // Core CRUD
    get,
    getAll,
    add,
    update,
    delete: deleteItem,
    clear,

    // Query helpers
    getForPath,
    getCount,

    // Parsing
    parseLearnedBlocks,
    parseSpecBlocks,
    stripKnowledgeBlocks,

    // Formatting
    formatForPrompt,

    // Utilities
    extractDomain,
    markUsed,

    // Review tracking
    getNewCount,
    getLastReviewed,
    setLastReviewed,

    // Raw markdown
    setRaw,
    getRaw,

    // Migration (exposed for testing/debugging)
    _ensureMigrated: ensureMigrated
  };
}
