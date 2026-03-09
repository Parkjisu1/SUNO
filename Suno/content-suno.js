(() => {
  'use strict';

  var selectedSongs = new Map();
  var panelInjected = false;

  // Suno's actual CSS class for form inputs
  var SUNO_INPUT_CLASS = 'bg-background-glass-thin';

  // ═══════════════════════════════════════
  //  FIELD DETECTION
  //  Uses Suno's actual class names + position
  // ═══════════════════════════════════════

  function findSunoFields() {
    var fields = {
      lyrics: null,
      style: null,
      title: null,
      exclude: null,
      sliders: []
    };

    // 1) Find ALL Suno form inputs (they all use bg-background-glass-thin)
    var allInputs = document.querySelectorAll(
      'textarea.' + SUNO_INPUT_CLASS +
      ', textarea[class*="background-glass"]' +
      ', input[type="text"].' + SUNO_INPUT_CLASS +
      ', input[type="text"][class*="background-glass"]' +
      ', input:not([type]).' + SUNO_INPUT_CLASS +
      ', input:not([type])[class*="background-glass"]'
    );

    // Fallback: any visible textarea/input in the main content area
    if (allInputs.length === 0) {
      allInputs = document.querySelectorAll('textarea, input[type="text"], input:not([type])');
    }

    var textareas = [];
    var inputs = [];

    for (var i = 0; i < allInputs.length; i++) {
      var el = allInputs[i];
      if (el.offsetParent === null) continue; // skip hidden
      if (el.closest('#suno-git-panel')) continue; // skip our panel
      if (el.closest('[role="dialog"]')) continue; // skip modals

      if (el.tagName === 'TEXTAREA') {
        textareas.push(el);
      } else {
        inputs.push(el);
      }
    }

    // LYRICS = the main textarea (usually first/largest)
    if (textareas.length > 0) {
      fields.lyrics = textareas[0];
    }

    // Sort inputs by vertical position
    inputs.sort(function(a, b) {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });

    // Identify each input by nearby label text
    for (var j = 0; j < inputs.length; j++) {
      var inp = inputs[j];
      var label = getSurroundingText(inp).toLowerCase();
      var ph = (inp.placeholder || '').toLowerCase();

      if (label.includes('exclude') || label.includes('제외') ||
          ph.includes('exclude') || ph.includes('negative')) {
        fields.exclude = inp;
      } else if (label.includes('title') || label.includes('제목') ||
                 ph.includes('title')) {
        fields.title = inp;
      } else if (label.includes('style') || label.includes('스타일') ||
                 label.includes('genre') || label.includes('장르') ||
                 label.includes('tag') ||
                 ph.includes('style') || ph.includes('genre') || ph.includes('tag')) {
        if (!fields.style) fields.style = inp;
      } else if (!fields.style && j === 0) {
        // First unidentified input is likely Style
        fields.style = inp;
      } else if (!fields.title) {
        fields.title = inp;
      }
    }

    // SLIDERS
    var sliders = document.querySelectorAll('input[type="range"]');
    for (var k = 0; k < sliders.length; k++) {
      if (sliders[k].offsetParent === null) continue;
      var sLabel = getSurroundingText(sliders[k]).toLowerCase();
      fields.sliders.push({
        el: sliders[k],
        label: sLabel,
        type: sLabel.includes('weird') ? 'weirdness' :
              sLabel.includes('style') ? 'styleInfluence' :
              sLabel.includes('audio') ? 'audioInfluence' : 'unknown'
      });
    }

    return fields;
  }

  function getSurroundingText(el) {
    var texts = [];

    // Check placeholder
    if (el.placeholder) texts.push(el.placeholder);

    // Check aria-label
    var aria = el.getAttribute('aria-label');
    if (aria) texts.push(aria);

    // Walk up parents looking for label text
    var parent = el.parentElement;
    for (var i = 0; i < 5 && parent; i++) {
      var children = parent.children;
      for (var j = 0; j < children.length; j++) {
        var child = children[j];
        if (child === el || child.contains(el)) continue;
        var tag = child.tagName;
        if (tag === 'LABEL' || tag === 'SPAN' || tag === 'P' ||
            tag === 'H3' || tag === 'H4' || tag === 'DIV') {
          var t = (child.textContent || '').trim();
          if (t.length > 0 && t.length < 50) {
            texts.push(t);
          }
        }
      }
      // Also check parent's own preceding sibling text
      var prev = parent.previousElementSibling;
      if (prev) {
        var pt = (prev.textContent || '').trim();
        if (pt.length > 0 && pt.length < 50) texts.push(pt);
      }
      parent = parent.parentElement;
    }

    return texts.join(' ');
  }

  function readCurrentValues() {
    var fields = findSunoFields();
    return {
      lyrics: fields.lyrics ? (fields.lyrics.value || '').trim() : '',
      style: fields.style ? (fields.style.value || '').trim() : '',
      title: fields.title ? (fields.title.value || '').trim() : '',
      exclude: fields.exclude ? (fields.exclude.value || '').trim() : '',
      weirdness: '',
      styleInfluence: '',
      audioInfluence: ''
    };
  }

  // ═══════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════

  init();

  function init() {
    injectPanel();
    injectCheckboxes();

    var observer = new MutationObserver(function() {
      if (!document.getElementById('suno-git-panel')) {
        panelInjected = false;
        injectPanel();
      }
      injectCheckboxes();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // SPA navigation
    var lastUrl = location.href;
    setInterval(function() {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        panelInjected = false;
        injectPanel();
        setTimeout(injectCheckboxes, 1000);
      }
    }, 1000);

    // Auto-fill listener
    chrome.runtime.onMessage.addListener(function(msg) {
      if (msg.action === 'fillFromStorage') checkAndFill();
    });
    setTimeout(checkAndFill, 2500);
  }

  // ═══════════════════════════════════════
  //  PANEL
  // ═══════════════════════════════════════

  function injectPanel() {
    if (panelInjected || document.getElementById('suno-git-panel')) return;
    panelInjected = true;

    var panel = document.createElement('div');
    panel.id = 'suno-git-panel';
    panel.innerHTML = [
      '<div class="suno-git-header">',
      '  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
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

    document.getElementById('suno-git-toggle').addEventListener('click', function() {
      panel.classList.toggle('minimized');
      document.getElementById('suno-git-toggle').textContent =
        panel.classList.contains('minimized') ? '+' : '_';
    });

    document.getElementById('suno-git-save').addEventListener('click', handleSave);
  }

  // ═══════════════════════════════════════
  //  CHECKBOXES
  // ═══════════════════════════════════════

  function injectCheckboxes() {
    var songLinks = document.querySelectorAll('a[href*="/song/"]');

    for (var i = 0; i < songLinks.length; i++) {
      var link = songLinks[i];
      var container = findSongContainer(link);
      if (!container || container.hasAttribute('data-suno-git')) continue;
      container.setAttribute('data-suno-git', 'true');

      var songId = extractSongId(link.href);
      if (!songId) continue;

      var cb = document.createElement('div');
      cb.className = 'suno-git-checkbox';
      cb.setAttribute('data-song-id', songId);
      cb.setAttribute('data-song-url', link.href.startsWith('http') ? link.href : 'https://suno.com' + link.getAttribute('href'));
      cb.setAttribute('data-song-title', (link.textContent || '').trim() || 'Untitled');
      cb.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';

      cb.addEventListener('click', onCheckboxClick);
      container.style.position = 'relative';
      container.appendChild(cb);
    }
  }

  function onCheckboxClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var cb = e.currentTarget;
    var cont = cb.closest('[data-suno-git]');
    var id = cb.getAttribute('data-song-id');
    var isSelected = cb.classList.toggle('selected');
    if (cont) cont.classList.toggle('suno-git-selected', isSelected);

    if (isSelected) {
      selectedSongs.set(id, {
        id: id,
        title: cb.getAttribute('data-song-title'),
        url: cb.getAttribute('data-song-url')
      });
    } else {
      selectedSongs.delete(id);
    }
    updateCount();
  }

  function findSongContainer(link) {
    // Try Suno's actual class names first
    var selectors = ['.clip-row', 'div[class*="clip"]', 'div[style*="grid-template-columns"]'];
    for (var i = 0; i < selectors.length; i++) {
      var match = link.closest(selectors[i]);
      if (match) return match;
    }
    // Walk up looking for grid/row/card containers
    var el = link.parentElement;
    for (var j = 0; j < 6 && el; j++) {
      var s = el.getAttribute('style') || '';
      var c = (typeof el.className === 'string') ? el.className : '';
      if (s.includes('grid') || c.includes('clip') || c.includes('row') ||
          c.includes('card') || c.includes('song')) {
        return el;
      }
      el = el.parentElement;
    }
    return link.parentElement;
  }

  function extractSongId(href) {
    var m = href.match(/\/song\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  }

  function updateCount() {
    var el = document.getElementById('suno-git-count');
    var btn = document.getElementById('suno-git-save');
    if (el) el.textContent = 'Selected: ' + selectedSongs.size;
    if (btn) btn.disabled = selectedSongs.size === 0;
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
    showToast('Auto-filling from suhbway.kr...', fill.title || '');

    var attempts = 0;
    var tryFill = setInterval(function() {
      attempts++;
      var result = doFill(fill);
      if (result.filled || attempts > 40) {
        clearInterval(tryFill);
        if (result.filled) {
          chrome.storage.local.remove('suno_pending_fill');
          showToast('Auto-fill complete!', result.details);
        } else {
          showToast('Auto-fill failed', 'Could not find Suno input fields. Try switching to Advanced mode.');
        }
      }
    }, 500);
  }

  function doFill(fill) {
    var fields = findSunoFields();
    var filled = false;
    var details = [];

    // First: if Exclude Styles is needed, try to reveal it
    if (fill.excludeStyles) {
      revealExcludeStyles();
    }

    // Re-detect after possible toggle
    setTimeout(function() {
      fields = findSunoFields();
    }, 300);

    // LYRICS → lyrics textarea
    if (fill.lyrics && fields.lyrics) {
      setReactValue(fields.lyrics, fill.lyrics);
      filled = true;
      details.push('Lyrics');
    }

    // PROMPT → Style of Music input
    if (fill.prompt && fields.style) {
      setReactValue(fields.style, fill.prompt);
      filled = true;
      details.push('Style');
    }

    // TITLE
    if (fill.title && fields.title) {
      setReactValue(fields.title, fill.title);
      filled = true;
      details.push('Title');
    }

    // EXCLUDE STYLES → negativeTags input
    if (fill.excludeStyles && fields.exclude) {
      setReactValue(fields.exclude, fill.excludeStyles);
      filled = true;
      details.push('Exclude');
    }

    // SLIDERS
    if (fill.params) {
      for (var i = 0; i < fields.sliders.length; i++) {
        var s = fields.sliders[i];
        var val = null;
        if (s.type === 'weirdness' && fill.params.weirdness != null) val = fill.params.weirdness;
        if (s.type === 'styleInfluence' && fill.params.styleInfluence != null) val = fill.params.styleInfluence;
        if (s.type === 'audioInfluence' && fill.params.audioInfluence != null) val = fill.params.audioInfluence;
        if (val != null) {
          setReactValue(s.el, String(val));
          filled = true;
          details.push(s.type);
        }
      }
    }

    return { filled: filled, details: details.join(', ') };
  }

  function revealExcludeStyles() {
    // Click the "Exclude Styles" toggle/button to reveal the input
    var buttons = document.querySelectorAll('button, [role="button"], [role="switch"], div[tabindex]');
    for (var i = 0; i < buttons.length; i++) {
      var text = (buttons[i].textContent || '').toLowerCase();
      var aria = (buttons[i].getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('exclude') || aria.includes('exclude') ||
          text.includes('제외') || aria.includes('제외')) {
        // Check if it's currently hidden/off
        var isChecked = buttons[i].getAttribute('aria-checked');
        if (isChecked === 'false' || !isChecked) {
          buttons[i].click();
        }
        return;
      }
    }

    // Also try: look for "More Options" and click it first
    var moreButtons = document.querySelectorAll('button, [role="button"]');
    for (var j = 0; j < moreButtons.length; j++) {
      var mtext = (moreButtons[j].textContent || '').toLowerCase();
      if (mtext.includes('more option') || mtext.includes('advanced') || mtext.includes('더보기')) {
        moreButtons[j].click();
        // After opening more options, try exclude again after a delay
        setTimeout(function() {
          var btns = document.querySelectorAll('button, [role="button"], [role="switch"]');
          for (var k = 0; k < btns.length; k++) {
            var t = (btns[k].textContent || '').toLowerCase();
            if (t.includes('exclude') || t.includes('제외')) {
              var checked = btns[k].getAttribute('aria-checked');
              if (checked === 'false' || !checked) btns[k].click();
              return;
            }
          }
        }, 500);
        return;
      }
    }
  }

  function setReactValue(el, value) {
    var proto = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');

    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    // Reset React's internal value tracker
    var tracker = el._valueTracker;
    if (tracker) tracker.setValue('');

    // Fire all relevant events for React to pick up the change
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function showToast(title, sub) {
    var existing = document.getElementById('suno-fill-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'suno-fill-toast';
    toast.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px;">' + title + '</div>' +
      '<div style="font-size:11px;color:#aaa;">' + (sub || '') + '</div>';
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
    }, 3500);
  }

  // ═══════════════════════════════════════
  //  SAVE TO GITHUB
  //  Reads ALL values from the page at save time
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
      if (!settings.github_token) throw new Error('Set up GitHub in extension popup first');

      var scoreEl = document.getElementById('suno-git-score');
      var score = scoreEl ? scoreEl.value.trim() : '-';

      // READ ALL current values from Suno's form fields NOW
      var fields = findSunoFields();
      var currentLyrics = fields.lyrics ? (fields.lyrics.value || '').trim() : '';
      var currentStyle = fields.style ? (fields.style.value || '').trim() : '';
      var currentExclude = fields.exclude ? (fields.exclude.value || '').trim() : '';
      var currentTitle = fields.title ? (fields.title.value || '').trim() : '';
      var sliderValues = {};
      for (var s = 0; s < fields.sliders.length; s++) {
        sliderValues[fields.sliders[s].type] = fields.sliders[s].el.value;
      }

      var saved = 0;
      var total = selectedSongs.size;

      for (var entry of selectedSongs) {
        var songData = entry[1];

        // Merge LIVE page data
        songData.lyrics = currentLyrics;
        songData.style = currentStyle;
        songData.exclude = currentExclude;
        songData.score = score || '-';
        songData.weirdness = sliderValues.weirdness || '';
        songData.styleInfluence = sliderValues.styleInfluence || '';
        songData.audioInfluence = sliderValues.audioInfluence || '';
        songData.savedAt = new Date().toISOString();
        if (currentTitle && songData.title === 'Untitled') {
          songData.title = currentTitle;
        }

        saved++;
        statusEl.textContent = 'Saving ' + saved + '/' + total + '...';
        var markdown = buildMarkdown(songData);
        await saveToGitHub(settings, songData, markdown);
      }

      // Clear selections (keep checkboxes visible)
      selectedSongs.clear();
      var cbs = document.querySelectorAll('.suno-git-checkbox.selected');
      for (var i = 0; i < cbs.length; i++) {
        cbs[i].classList.remove('selected');
        var p = cbs[i].closest('[data-suno-git]');
        if (p) p.classList.remove('suno-git-selected');
      }
      updateCount();

      statusEl.className = 'suno-git-status success';
      statusEl.textContent = total + ' song(s) saved!';
      setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 3000);
    } catch (err) {
      statusEl.className = 'suno-git-status error';
      statusEl.textContent = err.message;
      setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 4000);
    } finally {
      saveBtn.textContent = 'Save to Git';
      saveBtn.disabled = selectedSongs.size === 0;
    }
  }

  function buildMarkdown(data) {
    var lines = [
      '# ' + data.title,
      '',
      '- **Date**: ' + data.savedAt,
      '- **URL**: [' + data.url + '](' + data.url + ')',
      '- **Song ID**: `' + data.id + '`',
      '- **Score**: ' + (data.score || '-') + ' / 100',
      ''
    ];

    lines.push('## Lyrics', '');
    if (data.lyrics) {
      lines.push('```');
      lines.push(data.lyrics);
      lines.push('```');
    } else {
      lines.push('(no lyrics)');
    }
    lines.push('');

    lines.push('## Style of Music', '');
    lines.push(data.style || '(no style)');
    lines.push('');

    if (data.exclude) {
      lines.push('## Exclude Styles', '');
      lines.push(data.exclude);
      lines.push('');
    }

    var hasParams = data.weirdness || data.styleInfluence || data.audioInfluence;
    if (hasParams) {
      lines.push('## Parameters', '');
      lines.push('| Parameter | Value |');
      lines.push('|-----------|-------|');
      if (data.weirdness) lines.push('| Weirdness | ' + data.weirdness + ' |');
      if (data.styleInfluence) lines.push('| Style Influence | ' + data.styleInfluence + ' |');
      if (data.audioInfluence) lines.push('| Audio Influence | ' + data.audioInfluence + ' |');
      lines.push('');
    }

    return lines.join('\n');
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
        { headers: { 'Authorization': 'Bearer ' + settings.github_token, 'Accept': 'application/vnd.github+json' } }
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
        headers: { 'Authorization': 'Bearer ' + settings.github_token, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github+json' },
        body: JSON.stringify(body)
      }
    );
  }
})();
