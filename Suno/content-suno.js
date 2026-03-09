(() => {
  'use strict';

  // ─── State ───
  const selectedSongs = new Map();
  let panelInjected = false;

  // ─── Selectors ───
  const SEL = {
    songContainers: [
      '.clip-row',
      'div[class*="clip"]',
      'div[style*="grid-template-columns"]',
    ],
    songLink: 'a[href*="/song/"]',
  };

  // ─── Init: inject panel + start observers ───
  init();

  function init() {
    injectPanel();
    injectCheckboxes();

    // Observe DOM for new song cards (React re-renders)
    const observer = new MutationObserver(() => {
      if (!document.getElementById('suno-git-panel')) {
        panelInjected = false;
        injectPanel();
      }
      injectCheckboxes();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA navigation detection
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        panelInjected = false;
        injectPanel();
        injectCheckboxes();
      }
    }, 1000);

    // Auto-fill listener
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'fillFromStorage') {
        checkAndFill();
      }
    });
    setTimeout(checkAndFill, 2000);
  }

  // ═══════════════════════════════════════
  //  PANEL (Save to Git)
  // ═══════════════════════════════════════
  function injectPanel() {
    if (panelInjected || document.getElementById('suno-git-panel')) return;
    panelInjected = true;

    const panel = document.createElement('div');
    panel.id = 'suno-git-panel';
    panel.innerHTML = [
      '<div class="suno-git-header">',
      '  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">',
      '    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38',
      '      0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13',
      '      -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66',
      '      .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15',
      '      -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0',
      '      1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82',
      '      1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01',
      '      1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
      '  </svg>',
      '  <span>Suno to Git</span>',
      '</div>',
      '<div id="suno-git-count">Selected: 0</div>',
      '<div id="suno-git-score-wrap">',
      '  <label for="suno-git-score">Score</label>',
      '  <input type="number" id="suno-git-score" min="0" max="100" value="" placeholder="0-100" />',
      '</div>',
      '<button id="suno-git-save" disabled>Save to Git</button>',
      '<div id="suno-git-status"></div>',
      '<button id="suno-git-toggle" title="Minimize">_</button>',
    ].join('\n');

    document.body.appendChild(panel);

    document.getElementById('suno-git-toggle').addEventListener('click', () => {
      panel.classList.toggle('minimized');
      document.getElementById('suno-git-toggle').textContent =
        panel.classList.contains('minimized') ? '+' : '_';
    });

    document.getElementById('suno-git-save').addEventListener('click', handleSave);
  }

  // ═══════════════════════════════════════
  //  CHECKBOXES on song cards
  // ═══════════════════════════════════════
  function injectCheckboxes() {
    const songLinks = document.querySelectorAll(SEL.songLink);

    songLinks.forEach(function(link) {
      const container = findSongContainer(link);
      if (!container || container.hasAttribute('data-suno-git')) return;
      container.setAttribute('data-suno-git', 'true');

      const songId = extractSongId(link.href);
      if (!songId) return;

      const checkbox = document.createElement('div');
      checkbox.className = 'suno-git-checkbox';
      checkbox.setAttribute('data-song-id', songId);
      checkbox.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3">' +
        '<polyline points="20 6 9 17 4 12"/>' +
        '</svg>';

      checkbox.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleSong(checkbox, container, link);
      });

      container.style.position = 'relative';
      container.appendChild(checkbox);
    });
  }

  function findSongContainer(link) {
    for (var i = 0; i < SEL.songContainers.length; i++) {
      var match = link.closest(SEL.songContainers[i]);
      if (match) return match;
    }
    var el = link.parentElement;
    for (var j = 0; j < 5; j++) {
      if (!el) break;
      var style = el.getAttribute('style') || '';
      var cls = (typeof el.className === 'string') ? el.className : '';
      if (style.includes('grid') || cls.includes('clip') || cls.includes('row') || cls.includes('card')) {
        return el;
      }
      el = el.parentElement;
    }
    return link.parentElement;
  }

  function extractSongId(href) {
    var match = href.match(/\/song\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  function toggleSong(checkbox, container, link) {
    var songId = checkbox.getAttribute('data-song-id');
    var isSelected = checkbox.classList.toggle('selected');
    container.classList.toggle('suno-git-selected', isSelected);

    if (isSelected) {
      var title = (link.textContent || '').trim() || 'Untitled';
      var songUrl = link.href;
      if (!songUrl.startsWith('http')) {
        songUrl = 'https://suno.com' + link.getAttribute('href');
      }

      var prompt = extractPrompt(container);
      var style = extractStyle();

      selectedSongs.set(songId, {
        id: songId,
        title: title,
        url: songUrl,
        prompt: prompt,
        style: style,
        savedAt: new Date().toISOString()
      });
    } else {
      selectedSongs.delete(songId);
    }

    updateCount();
  }

  function extractPrompt(container) {
    // Try lyrics/prompt from nearby elements
    var selectors = ['[class*="lyric"]', '[class*="Lyric"]', '[class*="prompt"]', '[class*="description"]'];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = container.querySelector(selectors[i]);
        if (el) {
          var text = (el.textContent || '').trim();
          if (text.length > 2) return text;
        }
      } catch (e) {}
    }

    // Try main textarea on the page
    var textareas = document.querySelectorAll('textarea');
    for (var j = 0; j < textareas.length; j++) {
      var val = (textareas[j].value || '').trim();
      if (val.length > 2) return val;
    }

    // Try text blocks inside container
    var spans = container.querySelectorAll('span, p, div');
    for (var k = 0; k < spans.length; k++) {
      var txt = (spans[k].textContent || '').trim();
      if (txt.length > 20 && txt.indexOf('http') === -1 && spans[k].children.length === 0) {
        return txt;
      }
    }

    return '(prompt not found)';
  }

  function extractStyle() {
    // Look for "Style of Music" input (NOT exclude)
    var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var ph = (inputs[i].placeholder || '').toLowerCase();
      var val = (inputs[i].value || '').trim();
      // Skip exclude fields
      if (ph.includes('exclude') || ph.includes('negative')) continue;
      if (ph.includes('style') || ph.includes('genre')) {
        if (val.length > 1) return val;
      }
    }
    return '(style not found)';
  }

  function updateCount() {
    var countEl = document.getElementById('suno-git-count');
    var saveBtn = document.getElementById('suno-git-save');
    if (countEl) countEl.textContent = 'Selected: ' + selectedSongs.size;
    if (saveBtn) saveBtn.disabled = selectedSongs.size === 0;
  }

  // ═══════════════════════════════════════
  //  AUTO-FILL from suhbway.kr
  // ═══════════════════════════════════════
  async function checkAndFill() {
    var data = await new Promise(function(r) {
      chrome.storage.local.get(['suno_pending_fill'], r);
    });
    if (!data.suno_pending_fill) return;

    var fill = data.suno_pending_fill;
    showFillNotification(fill);

    var attempts = 0;
    var tryFill = setInterval(function() {
      attempts++;
      var filled = doFill(fill);
      if (filled || attempts > 30) {
        clearInterval(tryFill);
        if (filled) {
          chrome.storage.local.remove('suno_pending_fill');
        }
      }
    }, 500);
  }

  function doFill(fill) {
    var filledAny = false;

    // Collect ALL inputs and textareas on the page
    var allTextareas = document.querySelectorAll('textarea');
    var allInputs = document.querySelectorAll('input[type="text"], input:not([type])');

    // ──────────────────────────────────
    // 1) LYRICS → largest textarea
    // ──────────────────────────────────
    if (fill.lyrics) {
      for (var i = 0; i < allTextareas.length; i++) {
        var ph = (allTextareas[i].placeholder || '').toLowerCase();
        if (ph.includes('lyric') || ph.includes('write') || ph.includes('enter') || allTextareas.length === 1) {
          setReactValue(allTextareas[i], fill.lyrics);
          filledAny = true;
          break;
        }
      }
      // Fallback: just use the first textarea
      if (!filledAny && allTextareas.length > 0) {
        setReactValue(allTextareas[0], fill.lyrics);
        filledAny = true;
      }
    }

    // ──────────────────────────────────
    // 2) PROMPT → "Style of Music" input
    //    (NOT textarea, NOT exclude)
    // ──────────────────────────────────
    if (fill.prompt) {
      for (var j = 0; j < allInputs.length; j++) {
        var ph2 = (allInputs[j].placeholder || '').toLowerCase();
        var label = findLabelFor(allInputs[j]);

        // Skip exclude/negative fields
        if (ph2.includes('exclude') || ph2.includes('negative')) continue;
        if (label.includes('exclude') || label.includes('negative')) continue;

        // Match style/genre fields
        if (ph2.includes('style') || ph2.includes('genre') ||
            label.includes('style') || label.includes('genre')) {
          setReactValue(allInputs[j], fill.prompt);
          filledAny = true;
          break;
        }
      }
    }

    // ──────────────────────────────────
    // 3) EXCLUDE → "Exclude Styles" input
    //    (must contain "exclude" in placeholder/label)
    // ──────────────────────────────────
    if (fill.excludeStyles) {
      for (var k = 0; k < allInputs.length; k++) {
        var ph3 = (allInputs[k].placeholder || '').toLowerCase();
        var label3 = findLabelFor(allInputs[k]);

        if (ph3.includes('exclude') || ph3.includes('negative') ||
            label3.includes('exclude') || label3.includes('negative')) {
          setReactValue(allInputs[k], fill.excludeStyles);
          filledAny = true;
          break;
        }
      }
    }

    // ──────────────────────────────────
    // 4) PARAMETERS → sliders
    // ──────────────────────────────────
    if (fill.params) {
      var sliders = document.querySelectorAll('input[type="range"]');
      sliders.forEach(function(slider) {
        var sliderLabel = findLabelFor(slider);
        if (sliderLabel.includes('weird') && fill.params.weirdness != null) {
          setReactValue(slider, String(fill.params.weirdness));
        } else if (sliderLabel.includes('style') && fill.params.styleInfluence != null) {
          setReactValue(slider, String(fill.params.styleInfluence));
        } else if (sliderLabel.includes('audio') && fill.params.audioInfluence != null) {
          setReactValue(slider, String(fill.params.audioInfluence));
        }
      });
    }

    return filledAny;
  }

  function findLabelFor(el) {
    // Check aria-label
    var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    if (ariaLabel) return ariaLabel;

    // Check parent for label/span text
    var parent = el.parentElement;
    for (var i = 0; i < 3 && parent; i++) {
      var labelEl = parent.querySelector('label, span');
      if (labelEl) {
        var text = (labelEl.textContent || '').toLowerCase();
        if (text.length < 50) return text;
      }
      parent = parent.parentElement;
    }
    return '';
  }

  function setReactValue(el, value) {
    // React controlled inputs need native setter
    var proto = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');

    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Also try React's synthetic event
    var tracker = el._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function showFillNotification(fill) {
    var existing = document.getElementById('suno-fill-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'suno-fill-toast';
    toast.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px;">Auto-filled from suhbway.kr</div>' +
      '<div style="font-size:11px;color:#aaa;">' + (fill.title || 'Prompt loaded') + '</div>';
    toast.style.cssText =
      'position:fixed;top:20px;right:20px;z-index:999999;' +
      'padding:14px 20px;background:#1a1a2e;color:#fff;' +
      'border:1px solid #6c63ff;border-radius:10px;' +
      'box-shadow:0 8px 30px rgba(0,0,0,0.5);' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;' +
      'font-size:13px;transition:opacity 0.3s;';
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // ═══════════════════════════════════════
  //  SAVE TO GITHUB
  // ═══════════════════════════════════════
  async function handleSave() {
    var saveBtn = document.getElementById('suno-git-save');
    var statusEl = document.getElementById('suno-git-status');
    if (!saveBtn || !statusEl) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusEl.textContent = '';
    statusEl.className = '';

    try {
      var settings = await new Promise(function(r) {
        chrome.storage.local.get(['github_token', 'github_owner', 'github_repo'], r);
      });
      if (!settings.github_token) {
        throw new Error('Set up GitHub in extension popup first');
      }

      var scoreEl = document.getElementById('suno-git-score');
      var score = scoreEl ? scoreEl.value.trim() : '-';

      var saved = 0;
      var total = selectedSongs.size;

      for (var entry of selectedSongs) {
        var songId = entry[0];
        var songData = entry[1];
        songData.score = score || '-';
        saved++;
        statusEl.textContent = 'Saving ' + saved + '/' + total + '...';
        var markdown = buildMarkdown(songData);
        await saveToGitHub(settings, songData, markdown);
      }

      // Show success but keep buttons/checkboxes visible
      statusEl.className = 'suno-git-status success';
      statusEl.textContent = total + ' song(s) saved!';

      // Clear selection state but keep checkboxes
      selectedSongs.clear();
      var cbs = document.querySelectorAll('.suno-git-checkbox.selected');
      for (var i = 0; i < cbs.length; i++) {
        cbs[i].classList.remove('selected');
        var parent = cbs[i].closest('[data-suno-git]');
        if (parent) parent.classList.remove('suno-git-selected');
      }
      updateCount();

      setTimeout(function() {
        statusEl.textContent = '';
        statusEl.className = '';
      }, 3000);
    } catch (err) {
      statusEl.className = 'suno-git-status error';
      statusEl.textContent = err.message;
      setTimeout(function() {
        statusEl.textContent = '';
        statusEl.className = '';
      }, 4000);
    } finally {
      // ALWAYS restore button text and state
      saveBtn.textContent = 'Save to Git';
      saveBtn.disabled = selectedSongs.size === 0;
    }
  }

  function buildMarkdown(data) {
    return [
      '# ' + data.title,
      '',
      '- **Date**: ' + data.savedAt,
      '- **URL**: [' + data.url + '](' + data.url + ')',
      '- **Song ID**: `' + data.id + '`',
      '- **Score**: ' + (data.score || '-') + ' / 100',
      '',
      '## Prompt / Lyrics',
      '',
      '```',
      data.prompt,
      '```',
      '',
      '## Style',
      '',
      data.style,
      ''
    ].join('\n');
  }

  async function saveToGitHub(settings, songData, markdown) {
    var date = new Date().toISOString().split('T')[0];
    var safeName = songData.title.replace(/[^a-zA-Z0-9\uAC00-\uD7A3\s-]/g, '').trim().replace(/\s+/g, '-') || 'untitled';
    var path = 'songs/' + date + '_' + safeName + '_' + songData.id.slice(0, 8) + '.md';

    var content = btoa(unescape(encodeURIComponent(markdown)));

    var res = await fetch(
      'https://api.github.com/repos/' + settings.github_owner + '/' + settings.github_repo + '/contents/' + path,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + settings.github_token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          message: 'Add: ' + songData.title + ' (' + date + ')',
          content: content
        })
      }
    );

    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.message || 'GitHub error: ' + res.status);
    }

    await updateIndex(settings, songData, date);
  }

  async function updateIndex(settings, songData, date) {
    var indexPath = 'README.md';
    var existingSha = null;
    var existingContent = '# Suno Music History\n\n| Date | Title | Score | URL |\n|------|-------|-------|-----|\n';

    try {
      var res = await fetch(
        'https://api.github.com/repos/' + settings.github_owner + '/' + settings.github_repo + '/contents/' + indexPath,
        {
          headers: {
            'Authorization': 'Bearer ' + settings.github_token,
            'Accept': 'application/vnd.github+json'
          }
        }
      );
      if (res.ok) {
        var data = await res.json();
        existingSha = data.sha;
        existingContent = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      }
    } catch (e) {}

    var newRow = '| ' + date + ' | ' + songData.title + ' | ' + (songData.score || '-') + ' | [Listen](' + songData.url + ') |';
    var updatedContent = existingContent.trimEnd() + '\n' + newRow + '\n';
    var content = btoa(unescape(encodeURIComponent(updatedContent)));

    var body = { message: 'Update index: ' + songData.title, content: content };
    if (existingSha) body.sha = existingSha;

    await fetch(
      'https://api.github.com/repos/' + settings.github_owner + '/' + settings.github_repo + '/contents/' + indexPath,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + settings.github_token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify(body)
      }
    );
  }
})();
