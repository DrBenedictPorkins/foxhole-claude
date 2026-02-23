/**
 * Specs Manager Module
 * Handles site specs/notes management including display, editing, and persistence.
 * Extracted from sidebar.js for modularity.
 */

// Use window.RenderUtils and window.Helpers (loaded before this script)

/**
 * @typedef {Object} Spec
 * @property {string} id - Unique identifier for the spec
 * @property {string} [goal] - Goal/description of the spec
 * @property {string} [description] - Alternative to goal for legacy format
 * @property {string} [type] - Type badge (e.g., 'selector', 'workflow')
 * @property {string} [content] - Main content block
 * @property {string[]} [happy_path] - Legacy format: steps
 * @property {Object<string, string>} [selectors] - Legacy format: CSS selectors
 * @property {string[]} [avoid] - Legacy format: things to avoid
 * @property {string} [path] - URL path pattern this spec applies to
 */

/**
 * @typedef {Object} SpecsManagerElements
 * @property {HTMLElement} notesModal - The modal container
 * @property {HTMLElement} notesDomain - Element showing current domain
 * @property {HTMLElement} notesRendered - Container for rendered specs
 * @property {HTMLElement} notesSource - Container for source/markdown view
 * @property {HTMLTextAreaElement} notesMarkdown - Textarea for raw markdown
 * @property {HTMLElement} notesEmpty - Empty state container
 * @property {HTMLElement} notesCount - Element showing spec count
 * @property {HTMLElement} notesViewRendered - Button for rendered view
 * @property {HTMLElement} notesViewSource - Button for source view
 * @property {HTMLElement} notesBadge - Badge showing new/unreviewed count
 */

/**
 * Creates a specs manager instance.
 * Encapsulates state and provides methods for managing site specs.
 *
 * @param {SpecsManagerElements} elements - DOM elements for the specs UI
 * @param {Function} sendMessage - Function to send messages to background script
 * @returns {Object} Specs manager public API
 */
function createSpecsManager(elements, sendMessage) {
  // Private state
  let currentSpecsDomain = '';
  let currentSpecsData = [];
  let currentRawSpecs = '';

  const {
    notesModal,
    notesDomain,
    notesRendered,
    notesSource,
    notesMarkdown,
    notesEmpty,
    notesCount,
    notesViewRendered,
    notesViewSource,
    notesBadge
  } = elements;

  // ============================================================================
  // BADGE MANAGEMENT
  // ============================================================================

  /**
   * Fetches the count of new/unreviewed specs for a domain.
   *
   * @param {string} domain - The domain to check
   * @returns {Promise<number>} Count of new specs
   */
  async function fetchSpecsCount(domain) {
    const response = await sendMessage({
      type: 'GET_NEW_NOTES_COUNT',
      domain
    });
    return response?.count || 0;
  }

  /**
   * Updates the badge DOM element with the given count.
   *
   * @param {number} count - Number to display
   */
  function updateBadgeDisplay(count) {
    if (count > 0) {
      notesBadge.textContent = getBadgeText(count);
      notesBadge.classList.remove('hidden');
    } else {
      notesBadge.classList.add('hidden');
    }
  }

  /**
   * Returns the appropriate text for a badge count.
   * Caps display at 99+ for large numbers.
   *
   * @param {number} count - The actual count
   * @returns {string} Display text for the badge
   */
  function getBadgeText(count) {
    return count > 99 ? '99+' : String(count);
  }

  /**
   * Updates the notes badge to show NEW (unreviewed) notes count.
   * Gets current tab URL and fetches count from background.
   */
  async function updateNotesBadge() {
    try {
      const response = await sendMessage({ type: 'GET_CURRENT_TAB_URL' });
      if (!response?.url) {
        notesBadge.classList.add('hidden');
        return;
      }

      const url = new URL(response.url);
      const domain = url.hostname.replace(/^www\./, '');

      console.log('[SiteSpecs Badge] Domain:', domain);

      const count = await fetchSpecsCount(domain);
      console.log('[SiteSpecs Badge] Count:', count);

      updateBadgeDisplay(count);
    } catch (error) {
      console.error('[SiteSpecs Badge] Error:', error);
      notesBadge.classList.add('hidden');
    }
  }

  // ============================================================================
  // SPEC RENDERING
  // ============================================================================

  /**
   * Renders a single spec as an HTML card.
   *
   * @param {Spec} spec - The spec to render
   * @returns {string} HTML string for the card
   */
  function renderSpecCard(spec) {
    let html = `<div class="note-card" data-note-id="${window.RenderUtils.escapeHtml(spec.id)}">`;

    // Header with title and actions
    html += '<div class="note-header">';
    const title = spec.title || spec.goal || spec.description || 'Untitled Spec';
    html += `<h3 class="note-title">${window.RenderUtils.escapeHtml(title)}</h3>`;
    html += '<div class="note-actions">';
    if (spec.type) {
      html += `<span class="spec-type-badge">${window.RenderUtils.escapeHtml(spec.type)}</span>`;
    }
    html += `<button class="note-delete-btn" data-note-id="${window.RenderUtils.escapeHtml(spec.id)}" title="Delete spec">&times;</button>`;
    html += '</div>';
    html += '</div>';

    // Content block (new format)
    if (spec.content) {
      html += `<div class="note-section"><pre class="spec-content">${window.RenderUtils.escapeHtml(spec.content)}</pre></div>`;
    }

    // Legacy format: happy_path steps
    if (spec.happy_path?.length > 0) {
      html += '<div class="note-section"><strong>Steps:</strong><ol>';
      for (const step of spec.happy_path) {
        html += `<li>${window.RenderUtils.escapeHtml(step)}</li>`;
      }
      html += '</ol></div>';
    }

    // Legacy format: selectors
    if (spec.selectors && Object.keys(spec.selectors).length > 0) {
      html += '<div class="note-section"><strong>Selectors:</strong><ul>';
      for (const [name, selector] of Object.entries(spec.selectors)) {
        html += `<li><code>${window.RenderUtils.escapeHtml(name)}</code>: <code>${window.RenderUtils.escapeHtml(selector)}</code></li>`;
      }
      html += '</ul></div>';
    }

    // Legacy format: avoid list
    if (spec.avoid?.length > 0) {
      html += '<div class="note-section note-avoid"><strong>Avoid:</strong><ul>';
      for (const item of spec.avoid) {
        html += `<li>${window.RenderUtils.escapeHtml(item)}</li>`;
      }
      html += '</ul></div>';
    }

    // Path constraint
    if (spec.path && spec.path !== '*') {
      html += `<div class="note-path">Applies to: ${window.RenderUtils.escapeHtml(spec.path)}</div>`;
    }

    html += '</div>';
    return html;
  }

  /**
   * Renders all specs as HTML cards.
   *
   * @returns {string} HTML string for all spec cards
   */
  function renderSpecsAsCards() {
    if (currentSpecsData.length === 0) return '';
    return currentSpecsData.map(renderSpecCard).join('');
  }

  /**
   * Generates markdown for a single spec.
   *
   * @param {Spec} spec - The spec to convert
   * @returns {string} Markdown string
   */
  function generateSpecMarkdown(spec) {
    let md = '';
    const title = spec.title || spec.goal || spec.description || 'Untitled Spec';

    md += `## ${title}`;
    if (spec.type) {
      md += ` [${spec.type}]`;
    }
    md += '\n\n';

    // New format: content block
    if (spec.content) {
      md += '```\n' + spec.content + '\n```\n\n';
    }

    // Legacy format: steps
    if (spec.happy_path?.length > 0) {
      md += '**Steps:**\n';
      spec.happy_path.forEach((step, i) => {
        md += `${i + 1}. ${step}\n`;
      });
      md += '\n';
    }

    // Legacy format: selectors
    if (spec.selectors && Object.keys(spec.selectors).length > 0) {
      md += '**Selectors:**\n';
      for (const [name, selector] of Object.entries(spec.selectors)) {
        md += `- \`${name}\`: \`${selector}\`\n`;
      }
      md += '\n';
    }

    // Legacy format: avoid
    if (spec.avoid?.length > 0) {
      md += '**Avoid:**\n';
      for (const item of spec.avoid) {
        md += `- ${item}\n`;
      }
      md += '\n';
    }

    // Path constraint
    if (spec.path && spec.path !== '*') {
      md += `*Applies to: ${spec.path}*\n`;
    }

    md += '\n';
    return md;
  }

  /**
   * Generates markdown from all specs data.
   *
   * @returns {string} Complete markdown string
   */
  function generateSpecsMarkdown() {
    if (currentSpecsData.length === 0) return '';
    return currentSpecsData.map(generateSpecMarkdown).join('');
  }

  // ============================================================================
  // VIEW MANAGEMENT
  // ============================================================================

  /**
   * Shows empty state UI when no specs exist.
   */
  function showEmptySpecs() {
    notesRendered.classList.add('hidden');
    notesSource.classList.add('hidden');
    notesEmpty.classList.remove('hidden');
    currentSpecsData = [];
    currentRawSpecs = '';
    notesCount.textContent = '0 specs';
  }

  /**
   * Renders specs in the modal based on current data and view mode.
   */
  function renderSpecs() {
    notesEmpty.classList.add('hidden');

    // Determine markdown source: raw specs take priority
    const markdown = currentRawSpecs || generateSpecsMarkdown();
    notesMarkdown.value = markdown;

    // Render HTML view
    if (currentRawSpecs) {
      notesRendered.innerHTML = `<div class="notes-markdown-rendered">${window.RenderUtils.renderMarkdownContent(currentRawSpecs)}</div>`;
    } else {
      notesRendered.innerHTML = renderSpecsAsCards();
      attachSpecActionListeners();
    }

    // Show appropriate view based on active tab
    const isSourceView = notesViewSource.classList.contains('active');
    if (isSourceView) {
      notesRendered.classList.add('hidden');
      notesSource.classList.remove('hidden');
    } else {
      notesRendered.classList.remove('hidden');
      notesSource.classList.add('hidden');
    }
  }

  /**
   * Sets the view mode (rendered or source).
   *
   * @param {'rendered'|'source'} view - The view to switch to
   */
  function setNotesView(view) {
    if (view === 'rendered') {
      notesViewRendered.classList.add('active');
      notesViewSource.classList.remove('active');
      notesRendered.classList.remove('hidden');
      notesSource.classList.add('hidden');
    } else {
      notesViewRendered.classList.remove('active');
      notesViewSource.classList.add('active');
      notesRendered.classList.add('hidden');
      notesSource.classList.remove('hidden');
    }
  }

  /**
   * Updates the spec count display.
   */
  function updateSpecCount() {
    const specCount = currentSpecsData.length || (currentRawSpecs ? 1 : 0);
    notesCount.textContent = `${specCount} spec${specCount !== 1 ? 's' : ''}`;
  }

  // ============================================================================
  // SPEC ACTIONS
  // ============================================================================

  /**
   * Attaches event listeners to spec action buttons (delete, etc.).
   */
  function attachSpecActionListeners() {
    notesRendered.querySelectorAll('.note-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const specId = e.target.dataset.noteId;
        const spec = currentSpecsData.find(s => s.id === specId);
        if (spec && confirm(`Delete spec: "${spec.goal || spec.description}"?`)) {
          await deleteSpec(specId);
        }
      });
    });
  }

  /**
   * Deletes a spec by ID.
   *
   * @param {string} specId - The ID of the spec to delete
   */
  async function deleteSpec(specId) {
    try {
      const result = await sendMessage({
        type: 'DELETE_SITE_NOTE',
        domain: currentSpecsDomain,
        noteId: specId
      });

      if (result?.success) {
        currentSpecsData = currentSpecsData.filter(s => s.id !== specId);
        if (currentSpecsData.length === 0 && !currentRawSpecs) {
          showEmptySpecs();
        } else {
          renderSpecs();
        }
        updateSpecCount();
        updateNotesBadge();
      }
    } catch (error) {
      console.error('Error deleting spec:', error);
    }
  }

  /**
   * Clears all specs for the current domain.
   */
  async function handleClearAllSpecs() {
    if (!currentSpecsDomain) return;

    const confirmed = confirm(`Clear all specs for ${currentSpecsDomain}?`);
    if (!confirmed) return;

    try {
      await sendMessage({
        type: 'CLEAR_SITE_NOTES',
        domain: currentSpecsDomain
      });

      await sendMessage({
        type: 'SET_RAW_SITE_NOTES',
        domain: currentSpecsDomain,
        content: ''
      });

      showEmptySpecs();
      updateNotesBadge();
    } catch (error) {
      console.error('Error clearing specs:', error);
    }
  }

  /**
   * Saves raw markdown specs from the editor.
   *
   * @param {HTMLButtonElement} saveBtn - The save button element for status updates
   */
  async function handleSaveRawSpecs(saveBtn) {
    if (!currentSpecsDomain) return;

    const content = notesMarkdown.value;

    try {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;

      const result = await sendMessage({
        type: 'SET_RAW_SITE_NOTES',
        domain: currentSpecsDomain,
        content
      });

      if (result?.success) {
        currentRawSpecs = content;
        renderSpecs();
        saveBtn.textContent = 'Saved!';
        setTimeout(() => {
          saveBtn.textContent = 'Save Changes';
          saveBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error(result?.error || 'Failed to save');
      }
    } catch (error) {
      console.error('Error saving raw specs:', error);
      saveBtn.textContent = 'Error!';
      setTimeout(() => {
        saveBtn.textContent = 'Save Changes';
        saveBtn.disabled = false;
      }, 2000);
    }
  }

  // ============================================================================
  // MODAL MANAGEMENT
  // ============================================================================

  /**
   * Loads specs for the current domain from storage.
   */
  async function loadSpecs() {
    if (!currentSpecsDomain) {
      showEmptySpecs();
      return;
    }

    try {
      const [specsResponse, rawResponse] = await Promise.all([
        sendMessage({
          type: 'GET_SITE_NOTES',
          domain: currentSpecsDomain
        }),
        sendMessage({
          type: 'GET_RAW_SITE_NOTES',
          domain: currentSpecsDomain
        })
      ]);

      console.log('[SiteSpecs] Loading for domain:', currentSpecsDomain);
      console.log('[SiteSpecs] Structured specs response:', specsResponse);
      console.log('[SiteSpecs] Raw specs response:', rawResponse);

      currentSpecsData = specsResponse?.specs || [];
      currentRawSpecs = rawResponse?.content || '';

      console.log('[SiteSpecs] Structured count:', currentSpecsData.length);
      console.log('[SiteSpecs] Has raw specs:', !!currentRawSpecs);

      if (currentSpecsData.length === 0 && !currentRawSpecs) {
        showEmptySpecs();
      } else {
        renderSpecs();
      }

      updateSpecCount();
    } catch (error) {
      console.error('[SiteSpecs] Error loading specs:', error);
      showEmptySpecs();
    }
  }

  /**
   * Shows the notes modal and loads specs for the current tab's domain.
   */
  async function show() {
    try {
      const response = await sendMessage({ type: 'GET_CURRENT_TAB_URL' });
      if (response?.url) {
        const url = new URL(response.url);
        currentSpecsDomain = url.hostname.replace(/^www\./, '');
        notesDomain.textContent = currentSpecsDomain;
        await loadSpecs();
      } else {
        notesDomain.textContent = 'Unknown';
        showEmptySpecs();
      }
    } catch (error) {
      console.error('Error getting current tab:', error);
      notesDomain.textContent = 'Error';
      showEmptySpecs();
    }

    window.Helpers.showModal(notesModal);
  }

  /**
   * Hides the notes modal and marks specs as reviewed.
   */
  async function hide() {
    window.Helpers.hideModal(notesModal);

    if (currentSpecsDomain) {
      try {
        await sendMessage({
          type: 'SET_NOTES_REVIEWED',
          domain: currentSpecsDomain
        });
        updateNotesBadge();
      } catch (error) {
        console.error('Error marking specs as reviewed:', error);
      }
    }
  }

  /**
   * Returns the current domain being viewed.
   *
   * @returns {string} Current domain
   */
  function getCurrentDomain() {
    return currentSpecsDomain;
  }

  /**
   * Returns the current specs data.
   *
   * @returns {Spec[]} Array of specs
   */
  function getSpecsData() {
    return currentSpecsData;
  }

  /**
   * Returns the raw specs markdown.
   *
   * @returns {string} Raw markdown content
   */
  function getRawSpecs() {
    return currentRawSpecs;
  }

  // Public API
  return {
    show,
    hide,
    load: loadSpecs,
    updateBadge: updateNotesBadge,
    setView: setNotesView,
    clearAll: handleClearAllSpecs,
    saveRaw: handleSaveRawSpecs,
    getCurrentDomain,
    getSpecsData,
    getRawSpecs
  };
}

// Export for MV2 compatibility (script tag loading)
if (typeof window !== 'undefined') {
  window.SpecsManager = { createSpecsManager };
}
