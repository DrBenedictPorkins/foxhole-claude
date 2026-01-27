/**
 * Prompt Loader for Claude Browser Assistant
 * Loads system prompts from external text files with template support
 *
 * Features:
 * - Loads prompts from .txt files (no JS escaping needed)
 * - Supports {{placeholder}} replacements
 * - Caches loaded prompts
 */

// Prompt cache - keyed by filename
const promptCache = new Map();

// Default fallback prompt
const FALLBACK_PROMPT = 'You are a browser automation assistant with tools to control the browser.';

/**
 * Simple template engine - replaces {{key}} with values from context
 * @param {string} template - Template string with {{placeholders}}
 * @param {Object} context - Key-value pairs for replacements
 * @returns {string} Processed template
 */
function renderTemplate(template, context = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : match;
  });
}

/**
 * Load a prompt file from the extension
 * @param {string} filename - File path relative to extension root
 * @returns {Promise<string>} The prompt content
 */
async function loadPromptFile(filename) {
  // Return cached version if available
  if (promptCache.has(filename)) {
    return promptCache.get(filename);
  }

  try {
    const url = browser.runtime.getURL(filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const content = await response.text();
    promptCache.set(filename, content);
    console.log(`[PromptLoader] Loaded: ${filename}`);
    return content;
  } catch (error) {
    console.error(`[PromptLoader] Failed to load ${filename}:`, error);
    return null;
  }
}

/**
 * Load all required prompts at startup
 * @returns {Promise<void>}
 */
async function loadPrompts() {
  await loadPromptFile('background/system-prompt.txt');
}

/**
 * Get the system prompt, optionally with template replacements
 * @param {Object} context - Optional placeholder values
 * @returns {string}
 */
function getSystemPrompt(context = {}) {
  const template = promptCache.get('background/system-prompt.txt');
  if (!template) {
    console.warn('[PromptLoader] System prompt not loaded, using fallback');
    return FALLBACK_PROMPT;
  }
  return Object.keys(context).length > 0 ? renderTemplate(template, context) : template;
}

/**
 * Load and render any prompt file with context
 * @param {string} filename - File path relative to extension root
 * @param {Object} context - Placeholder values
 * @returns {Promise<string>}
 */
async function getPrompt(filename, context = {}) {
  let template = promptCache.get(filename);
  if (!template) {
    template = await loadPromptFile(filename);
  }
  if (!template) {
    return FALLBACK_PROMPT;
  }
  return Object.keys(context).length > 0 ? renderTemplate(template, context) : template;
}
