/**
 * Content Sanitizer — Prompt Injection Defense
 *
 * Detects common injection patterns in page content and marks them with
 * [SUSPICIOUS:LABEL] tags so Claude can recognize and ignore them.
 * Does NOT block content — marks it for transparency.
 *
 * Two entry points:
 *   sanitizeForConversation(content, source) — mark patterns, prepend summary
 *   sanitizeForStorage(content)             — mark + escape fences + cap length
 */

(function () {
  'use strict';

  const MAX_STORAGE_LENGTH = 10000;

  // ---------------------------------------------------------------------------
  // Detection patterns
  // ---------------------------------------------------------------------------

  const PATTERNS = [
    {
      label: 'INSTRUCTION_OVERRIDE',
      description: 'Instruction hijacking',
      regex: /\b(ignore\s+(all\s+)?previous\s+instructions|forget\s+everything\s+(above|before)|disregard\s+(all\s+)?(prior|previous|above)\s+(instructions|context|rules))\b/gi,
    },
    {
      label: 'ROLE_IMPERSONATION',
      description: 'Role impersonation',
      regex: /(?:^|\n)\s*(?:System|Assistant|User)\s*:/gm,
    },
    {
      label: 'ROLE_IMPERSONATION',
      description: 'Role impersonation (markup)',
      regex: /<\|(?:system|user|assistant|im_start|im_end)\|>/gi,
    },
    {
      label: 'FAKE_URGENCY',
      description: 'Fake urgency prefix',
      regex: /(?:^|\n)\s*(?:IMPORTANT|CRITICAL|URGENT|ATTENTION)\s*:/gm,
    },
    {
      label: 'FAKE_TOOL_MARKUP',
      description: 'Fake tool / function markup',
      regex: /<(?:tool_use|function_calls|invoke\s+name=|tool_result|antml:)/gi,
    },
    {
      label: 'DATA_EXFILTRATION',
      description: 'Data exfiltration attempt',
      regex: /\b(?:send\s+(?:all\s+)?cookies?\s+to|exfiltrate|navigator\.sendBeacon)\b/gi,
    },
    {
      label: 'DATA_EXFILTRATION',
      description: 'Suspicious fetch/XMLHttpRequest to external URL',
      regex: /(?:fetch|XMLHttpRequest|new\s+Image\(\)\.src)\s*\(\s*["'`]https?:\/\//gi,
    },
  ];

  // ---------------------------------------------------------------------------
  // sanitizeForConversation
  // ---------------------------------------------------------------------------

  /**
   * Scan content for injection patterns and wrap matches with markers.
   * Prepends a summary header if any patterns are detected.
   *
   * @param {string} content  — The raw content string
   * @param {string} source   — Label for the source tool (e.g. 'get_page_content')
   * @returns {string} Content with suspicious spans marked
   */
  function sanitizeForConversation(content, source) {
    if (!content || typeof content !== 'string') return content;

    const detections = []; // { label, description, index }

    let result = content;

    for (const pattern of PATTERNS) {
      // Reset lastIndex for global regexes
      pattern.regex.lastIndex = 0;

      result = result.replace(pattern.regex, (match) => {
        detections.push({
          label: pattern.label,
          description: pattern.description,
        });
        return `[SUSPICIOUS:${pattern.label}]${match}[/SUSPICIOUS]`;
      });
    }

    if (detections.length > 0) {
      // Deduplicate labels for summary
      const uniqueLabels = [...new Set(detections.map(d => `${d.label} (${d.description})`))];

      const header =
        `[INJECTION_DETECTED] ${detections.length} suspicious pattern(s) found in ${source || 'page content'}:\n` +
        uniqueLabels.map(l => `  - ${l}`).join('\n') +
        '\n[/INJECTION_DETECTED]\n\n';

      result = header + result;

      console.log(
        `[ContentSanitizer] Detected ${detections.length} pattern(s) in ${source || 'unknown'}:`,
        uniqueLabels
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // sanitizeForStorage
  // ---------------------------------------------------------------------------

  /**
   * Sanitize content for persistent storage.
   * Runs conversation sanitizer first, then escapes code fences and caps length.
   *
   * @param {string} content — The raw content string
   * @returns {string} Sanitized content safe for storage
   */
  function sanitizeForStorage(content) {
    if (!content || typeof content !== 'string') return content;

    // Run injection detection first
    let result = sanitizeForConversation(content, 'storage');

    // Escape triple backtick code fences (insert zero-width space after first backtick)
    // This prevents stored content from breaking out of code fence formatting
    result = result.replace(/```/g, '`\u200B``');

    // Cap length
    if (result.length > MAX_STORAGE_LENGTH) {
      result = result.slice(0, MAX_STORAGE_LENGTH) + '\n[... truncated at 10000 chars ...]';
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  window.ContentSanitizer = {
    sanitizeForConversation,
    sanitizeForStorage,
  };

  console.log('[ContentSanitizer] Prompt injection defense loaded');
})();
