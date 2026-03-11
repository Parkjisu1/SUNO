(() => {
  'use strict';

  var selectedSongs = new Map();
  var panelInjected = false;

  // ═══════════════════════════════════════
  //  FETCH SONG DATA - Multi-strategy
  //  Based on: github.com/gcui-art/suno-api
  //  Real API: studio-api.prod.suno.com
  //  Auth: Bearer token from Clerk session
  // ═══════════════════════════════════════

  var STUDIO_API = 'https://studio-api.prod.suno.com';
  var authToken = null;

  function mapClipData(clip, clipId) {
    return {
      id: clip.id || clipId,
      title: clip.title || clip.display_name || 'Untitled',
      lyrics: clip.metadata?.prompt || clip.lyrics || clip.lyric || '',
      style: clip.metadata?.tags || clip.style || clip.tags || '',
      exclude: clip.metadata?.negative_tags || clip.negative_tags || '',
      prompt: clip.metadata?.gpt_description_prompt || clip.gpt_description_prompt || '',
      audioUrl: clip.audio_url || '',
      imageUrl: clip.image_url || '',
      duration: clip.duration || '',
      model: clip.model_name || clip.major_model_version || '',
      createdAt: clip.created_at || '',
      url: 'https://suno.com/song/' + clipId
    };
  }

  // Extract Clerk auth token from cookies/localStorage
  function getAuthToken() {
    if (authToken) return authToken;
    try {
      // Try localStorage (Clerk stores session here)
      var clerkDb = localStorage.getItem('__clerk_db_jwt');
      if (clerkDb) { authToken = clerkDb.replace(/"/g, ''); return authToken; }

      // Try sessionStorage
      var sessToken = sessionStorage.getItem('__clerk_db_jwt');
      if (sessToken) { authToken = sessToken.replace(/"/g, ''); return authToken; }

      // Try cookies
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var c = cookies[i].trim();
        if (c.startsWith('__session=') || c.startsWith('__client_uat=')) {
          authToken = c.split('=').slice(1).join('=');
          return authToken;
        }
      }
    } catch (e) {}
    return null;
  }

  async function fetchSongData(clipId) {
    var token = getAuthToken();

    // Strategy 1: Studio API /api/feed/v2 (batch endpoint, most reliable)
    if (token) {
      try {
        var feedRes = await fetch(STUDIO_API + '/api/feed/v2?ids=' + clipId, {
          headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json'
          }
        });
        if (feedRes.ok) {
          var feedData = await feedRes.json();
          // feed/v2 returns array of clips
          var clips = Array.isArray(feedData) ? feedData : (feedData.clips || feedData.results || [feedData]);
          for (var i = 0; i < clips.length; i++) {
            if (clips[i] && (clips[i].id === clipId || clips.length === 1)) {
              return mapClipData(clips[i], clipId);
            }
          }
        }
      } catch (e) {}
    }

    // Strategy 2: Studio API /api/clip/{id}
    if (token) {
      try {
        var clipRes = await fetch(STUDIO_API + '/api/clip/' + clipId, {
          headers: {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json'
          }
        });
        if (clipRes.ok) {
          var clipJson = await clipRes.json();
          var clip = clipJson.clip || clipJson;
          if (clip && (clip.metadata || clip.title)) {
            return mapClipData(clip, clipId);
          }
        }
      } catch (e) {}
    }

    // Strategy 3: Proxy via suno.com (relative URL, uses page cookies)
    try {
      var proxyRes = await fetch('/api/clip/' + clipId, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (proxyRes.ok) {
        var proxyData = await proxyRes.json();
        var proxyClip = proxyData.clip || proxyData;
        if (proxyClip && (proxyClip.metadata || proxyClip.title)) {
          return mapClipData(proxyClip, clipId);
        }
      }
    } catch (e) {}

    // Strategy 4: React fiber extraction from current page DOM
    var fiberData = extractFromReactFiber(clipId);
    if (fiberData) return fiberData;

    // Strategy 5: Background worker (opens song page tab, extracts rendered DOM)
    try {
      var bgResult = await new Promise(function(resolve) {
        chrome.runtime.sendMessage({ action: 'fetchClipData', clipId: clipId }, resolve);
      });
      if (bgResult && bgResult.success && bgResult.data) {
        var bgData = bgResult.data;
        if (bgData.metadata) return mapClipData(bgData, clipId);
        if (bgData.title || bgData.lyrics || bgData.style) {
          return {
            id: bgData.id || clipId,
            title: bgData.title || 'Untitled',
            lyrics: bgData.lyrics || '',
            style: bgData.style || '',
            exclude: bgData.exclude || '',
            prompt: bgData.prompt || '',
            audioUrl: bgData.audioUrl || bgData.audio_url || '',
            imageUrl: bgData.imageUrl || bgData.image_url || '',
            duration: bgData.duration || '',
            model: bgData.model || '',
            createdAt: bgData.createdAt || bgData.created_at || '',
            url: 'https://suno.com/song/' + clipId
          };
        }
      }
    } catch (e) {}

    throw new Error('Could not fetch song data');
  }

  function extractFromReactFiber(clipId) {
    var link = document.querySelector('a[href*="/song/' + clipId + '"]');
    if (!link) return null;

    var fiberKey = null;
    var keys = Object.keys(link);
    for (var k = 0; k < keys.length; k++) {
      if (keys[k].startsWith('__reactFiber$') || keys[k].startsWith('__reactInternalInstance$')) {
        fiberKey = keys[k];
        break;
      }
    }
    if (!fiberKey) return null;

    var fiber = link[fiberKey];
    var node = fiber;
    for (var i = 0; i < 30 && node; i++) {
      if (node.memoizedProps) {
        var props = node.memoizedProps;
        var candidate = props.clip || props.song || props.data || props.item;
        if (candidate && typeof candidate === 'object' && candidate.metadata) {
          return mapClipData(candidate, clipId);
        }
      }
      node = node.return;
    }
    return null;
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
      selectedSongs.set(id, { id: id });
    } else {
      selectedSongs.delete(id);
    }
    updateCount();
  }

  function findSongContainer(link) {
    var selectors = ['.clip-row', 'div[class*="clip"]', 'div[style*="grid-template-columns"]'];
    for (var i = 0; i < selectors.length; i++) {
      var match = link.closest(selectors[i]);
      if (match) return match;
    }
    var el = link.parentElement;
    for (var j = 0; j < 6 && el; j++) {
      var s = el.getAttribute('style') || '';
      var c = (typeof el.className === 'string') ? el.className : '';
      if (s.includes('grid') || c.includes('clip') || c.includes('row') || c.includes('card') || c.includes('song')) {
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
  //  Phased approach: Custom mode → wait → fill each field with retries
  // ═══════════════════════════════════════

  var _filledFields = {};  // Track which fields are already filled this session

  async function checkAndFill() {
    var data = await new Promise(function(r) {
      chrome.storage.local.get(['suno_pending_fill'], r);
    });
    if (!data.suno_pending_fill) return;

    var fill = data.suno_pending_fill;
    _filledFields = {};
    console.log('[SunoHelper] Starting auto-fill with data:', JSON.stringify(fill).slice(0, 300));
    showToast('Auto-filling from suhbway.kr...', fill.title || '');

    // Phase 1: Switch to Custom mode and wait for it to render
    var modeReady = await waitForCustomMode(8000);
    console.log('[SunoHelper] Custom mode ready:', modeReady);

    // Phase 2: If exclude styles needed, reveal the section early
    if (fill.excludeStyles) {
      revealExcludeStyles();
      await sleep(800);
    }

    // Phase 3: Fill with retries - 500ms interval, up to 60 attempts (30s)
    var attempts = 0;
    var tryFill = setInterval(function() {
      attempts++;

      // Re-try custom mode switch if no fields found after a while
      if (attempts % 10 === 0) {
        switchToCustomMode();
      }
      // Re-try revealing exclude styles
      if (fill.excludeStyles && !_filledFields['Exclude'] && attempts % 8 === 0) {
        revealExcludeStyles();
      }

      var result = doFill(fill);

      if (result.allDone || attempts > 60) {
        clearInterval(tryFill);
        chrome.storage.local.remove('suno_pending_fill');

        var filledList = Object.keys(_filledFields);
        if (filledList.length > 0) {
          var msg = result.allDone ? 'Auto-fill complete!' : 'Partial fill';
          var detail = 'Filled: ' + filledList.join(', ');
          if (result.pending) detail += ' | Missing: ' + result.pending;
          showToast(msg, detail);
          console.log('[SunoHelper] ' + msg + ' - ' + detail);
        } else {
          showToast('Auto-fill failed', 'Could not find input fields. Make sure you are on the Create page in Custom mode.');
          console.log('[SunoHelper] Auto-fill failed - no fields found after ' + attempts + ' attempts');
        }
      }
    }, 500);
  }

  function sleep(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  // Wait for Custom mode to be active, returns true if successful
  async function waitForCustomMode(timeout) {
    var deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      switchToCustomMode();
      // Check if we have at least one textarea (lyrics) visible - sign of Custom mode
      var textareas = document.querySelectorAll('textarea');
      for (var i = 0; i < textareas.length; i++) {
        if (isVisibleFormField(textareas[i])) return true;
      }
      // Also check contenteditable as fallback
      var editables = document.querySelectorAll('[contenteditable="true"]');
      for (var j = 0; j < editables.length; j++) {
        if (isVisibleFormField(editables[j])) return true;
      }
      await sleep(500);
    }
    return false;
  }

  function switchToCustomMode() {
    // Strategy 1: Look for Custom/Advanced mode tabs/buttons by text
    var candidates = document.querySelectorAll('button, [role="tab"], [role="button"], [role="radio"], a, div[tabindex]');
    for (var i = 0; i < candidates.length; i++) {
      var text = (candidates[i].textContent || '').trim().toLowerCase();
      // Match exact or contains "custom" / "advanced"
      if (text === 'custom' || text === 'advanced' || text === '커스텀' || text === '사용자 지정'
          || (text.length < 20 && (text.includes('custom') || text.includes('advanced')))) {
        var isActive = candidates[i].getAttribute('aria-selected') === 'true'
          || candidates[i].getAttribute('data-state') === 'active'
          || candidates[i].getAttribute('aria-checked') === 'true'
          || candidates[i].classList.contains('active')
          || candidates[i].classList.contains('selected');
        if (!isActive) {
          console.log('[SunoHelper] Clicking Custom mode button:', text);
          candidates[i].click();
        }
        return true;
      }
    }

    // Strategy 2: Find segmented control / tab group and click the non-active one
    var tabGroups = document.querySelectorAll('[role="tablist"], [role="radiogroup"]');
    for (var g = 0; g < tabGroups.length; g++) {
      var tabs = tabGroups[g].querySelectorAll('[role="tab"], [role="radio"], button');
      if (tabs.length === 2) {
        // Typically: [Simple, Custom] - click the second one
        var second = tabs[1];
        var isActive = second.getAttribute('aria-selected') === 'true'
          || second.getAttribute('data-state') === 'active';
        if (!isActive) {
          console.log('[SunoHelper] Clicking second tab in group:', second.textContent.trim());
          second.click();
        }
        return true;
      }
    }

    return false;
  }

  function doFill(fill) {
    var pending = [];

    // Collect all visible form elements
    var textareas = [];
    var inputs = [];
    var editables = [];
    document.querySelectorAll('textarea').forEach(function(el) {
      if (isVisibleFormField(el)) textareas.push(el);
    });
    document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])').forEach(function(el) {
      if (isVisibleFormField(el)) inputs.push(el);
    });
    document.querySelectorAll('[contenteditable="true"]').forEach(function(el) {
      if (isVisibleFormField(el)) editables.push(el);
    });

    // Sort by vertical position
    var byTop = function(a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; };
    inputs.sort(byTop);
    textareas.sort(byTop);
    editables.sort(byTop);

    // ── LYRICS ──
    if (fill.lyrics && !_filledFields['Lyrics']) {
      var lyricsTarget = findFieldByContext(textareas, ['lyric', 'lyrics', '가사', 'write your own']);
      // Fallback: largest textarea (lyrics is usually the biggest)
      if (!lyricsTarget && textareas.length > 0) {
        lyricsTarget = textareas.reduce(function(best, el) {
          return el.getBoundingClientRect().height > (best ? best.getBoundingClientRect().height : 0) ? el : best;
        }, null);
      }
      // Fallback: contenteditable with lyrics hint
      if (!lyricsTarget) {
        lyricsTarget = findFieldByContext(editables, ['lyric', 'lyrics', '가사', 'write your own']);
        if (!lyricsTarget && editables.length > 0) lyricsTarget = editables[0];
      }

      if (lyricsTarget) {
        setFieldValue(lyricsTarget, fill.lyrics);
        _filledFields['Lyrics'] = true;
        console.log('[SunoHelper] Filled Lyrics');
      } else {
        pending.push('Lyrics');
      }
    }

    // ── Categorize text inputs & textareas ──
    var styleTarget = null;
    var excludeTarget = null;
    var titleTarget = null;

    // Check inputs
    for (var i = 0; i < inputs.length; i++) {
      var ctx = getFieldContext(inputs[i]).toLowerCase();
      if (!excludeTarget && (ctx.includes('exclude') || ctx.includes('negative') || ctx.includes('제외'))) {
        excludeTarget = inputs[i];
      } else if (!styleTarget && (ctx.includes('style') || ctx.includes('genre') || ctx.includes('tag') || ctx.includes('music description'))) {
        styleTarget = inputs[i];
      } else if (!titleTarget && (ctx.includes('title') || ctx.includes('제목') || ctx.includes('song name'))) {
        titleTarget = inputs[i];
      }
    }

    // Also check textareas for style (Suno may use textarea for style)
    if (!styleTarget) {
      styleTarget = findFieldByContext(textareas, ['style', 'genre', 'tag', 'music description', 'describe']);
    }

    // Fallback: first input that isn't exclude or title = style
    if (!styleTarget && inputs.length > 0) {
      for (var fi = 0; fi < inputs.length; fi++) {
        if (inputs[fi] !== excludeTarget && inputs[fi] !== titleTarget) {
          styleTarget = inputs[fi];
          break;
        }
      }
    }

    // ── STYLE (Prompt) ──
    if (fill.prompt && !_filledFields['Style']) {
      if (styleTarget) {
        setFieldValue(styleTarget, fill.prompt);
        _filledFields['Style'] = true;
        console.log('[SunoHelper] Filled Style');
      } else {
        pending.push('Style');
      }
    }

    // ── EXCLUDE STYLES ──
    if (fill.excludeStyles && !_filledFields['Exclude']) {
      // Also search textareas in case exclude is a textarea
      if (!excludeTarget) {
        excludeTarget = findFieldByContext(textareas, ['exclude', 'negative', '제외']);
      }
      if (excludeTarget) {
        setFieldValue(excludeTarget, fill.excludeStyles);
        _filledFields['Exclude'] = true;
        console.log('[SunoHelper] Filled Exclude');
      } else {
        pending.push('Exclude');
      }
    }

    // ── TITLE ──
    if (fill.title && !_filledFields['Title']) {
      if (!titleTarget && inputs.length > 1) {
        for (var tj = 0; tj < inputs.length; tj++) {
          if (inputs[tj] !== styleTarget && inputs[tj] !== excludeTarget) {
            titleTarget = inputs[tj];
            break;
          }
        }
      }
      if (titleTarget) {
        setFieldValue(titleTarget, fill.title);
        _filledFields['Title'] = true;
        console.log('[SunoHelper] Filled Title');
      } else {
        pending.push('Title');
      }
    }

    // ── SLIDERS (Weirdness, Style Influence, Audio Influence) ──
    if (fill.params) {
      var sliders = document.querySelectorAll('input[type="range"]');
      sliders.forEach(function(slider) {
        if (slider.offsetParent === null) return;
        var sCtx = getFieldContext(slider).toLowerCase();

        if (!_filledFields['Weirdness'] && sCtx.includes('weird') && fill.params.weirdness != null) {
          setFieldValue(slider, String(fill.params.weirdness));
          _filledFields['Weirdness'] = true;
          console.log('[SunoHelper] Filled Weirdness:', fill.params.weirdness);
        } else if (!_filledFields['StyleInfl'] && sCtx.includes('style') && !sCtx.includes('exclude') && fill.params.styleInfluence != null) {
          setFieldValue(slider, String(fill.params.styleInfluence));
          _filledFields['StyleInfl'] = true;
          console.log('[SunoHelper] Filled StyleInfluence:', fill.params.styleInfluence);
        } else if (!_filledFields['AudioInfl'] && sCtx.includes('audio') && fill.params.audioInfluence != null) {
          setFieldValue(slider, String(fill.params.audioInfluence));
          _filledFields['AudioInfl'] = true;
          console.log('[SunoHelper] Filled AudioInfluence:', fill.params.audioInfluence);
        }
      });
    }

    return { allDone: pending.length === 0, pending: pending.join(', ') };
  }

  // Find a field whose context matches any of the keywords
  function findFieldByContext(elements, keywords) {
    for (var i = 0; i < elements.length; i++) {
      var ctx = getFieldContext(elements[i]).toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (ctx.includes(keywords[k])) return elements[i];
      }
    }
    return null;
  }

  // Set value on any form element (textarea, input, contenteditable)
  function setFieldValue(el, value) {
    if (el.getAttribute('contenteditable') === 'true') {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    setReactValue(el, value);
  }

  function isVisibleFormField(el) {
    // Accept elements that are in the DOM tree even if not yet fully painted
    if (el.closest('#suno-git-panel')) return false;
    if (el.closest('#suno-fill-toast')) return false;
    if (el.closest('[role="dialog"]')) return false;
    if (el.closest('nav')) return false;
    // Skip header/footer areas
    if (el.closest('header')) return false;
    if (el.closest('footer')) return false;
    // Skip search inputs
    var ph = (el.placeholder || '').toLowerCase();
    if (ph.includes('search') || ph.includes('검색')) return false;
    // Check basic visibility
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && el.offsetParent === null) return false;
    return true;
  }

  // Get all contextual text around a form field (labels, siblings, placeholders, aria)
  function getFieldContext(el) {
    var texts = [];

    // Direct attributes
    if (el.placeholder) texts.push(el.placeholder);
    if (el.name) texts.push(el.name);
    var aria = el.getAttribute('aria-label');
    if (aria) texts.push(aria);
    var ariaDesc = el.getAttribute('aria-describedby');
    if (ariaDesc) {
      var descEl = document.getElementById(ariaDesc);
      if (descEl) texts.push(descEl.textContent.trim());
    }

    // Associated <label>
    var id = el.id;
    if (id) {
      var labelEl = document.querySelector('label[for="' + id + '"]');
      if (labelEl) texts.push(labelEl.textContent.trim());
    }

    // Walk up to 7 parent levels looking for sibling labels/headings
    var parent = el.parentElement;
    for (var i = 0; i < 7 && parent; i++) {
      // Don't go above main content area
      if (parent.tagName === 'BODY' || parent.tagName === 'MAIN') break;

      var children = parent.children;
      for (var j = 0; j < children.length; j++) {
        if (children[j] === el || children[j].contains(el)) continue;
        var tag = children[j].tagName;
        if (tag === 'LABEL' || tag === 'SPAN' || tag === 'P' || tag === 'DIV'
            || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5'
            || tag === 'LEGEND' || tag === 'STRONG' || tag === 'SMALL') {
          var t = (children[j].textContent || '').trim();
          if (t.length > 0 && t.length < 80) texts.push(t);
        }
      }
      parent = parent.parentElement;
    }

    return texts.join(' ');
  }

  function revealExcludeStyles() {
    // Strategy 1: Find toggle/switch for exclude styles
    var clickables = document.querySelectorAll('button, [role="button"], [role="switch"], [role="checkbox"], div[tabindex], label, span[tabindex]');
    for (var i = 0; i < clickables.length; i++) {
      var text = (clickables[i].textContent || '').toLowerCase();
      var aria = (clickables[i].getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('exclude') || aria.includes('exclude') || text.includes('negative') || text.includes('제외')) {
        var isChecked = clickables[i].getAttribute('aria-checked');
        var dataState = clickables[i].getAttribute('data-state');
        if (isChecked === 'false' || dataState === 'unchecked' || (!isChecked && !dataState)) {
          console.log('[SunoHelper] Toggling exclude styles ON');
          clickables[i].click();
        }
        return;
      }
    }
    // Strategy 2: Try "More Options" / expandable sections
    for (var j = 0; j < clickables.length; j++) {
      var mt = (clickables[j].textContent || '').toLowerCase();
      if (mt.includes('more option') || mt.includes('advanced') || mt.includes('추가 옵션') || mt.includes('show more')) {
        clickables[j].click();
        setTimeout(revealExcludeStyles, 800);
        return;
      }
    }
  }

  function setReactValue(el, value) {
    // Determine the right prototype for native setter
    var proto;
    if (el.tagName === 'TEXTAREA') {
      proto = HTMLTextAreaElement.prototype;
    } else if (el.tagName === 'SELECT') {
      proto = HTMLSelectElement.prototype;
    } else {
      proto = HTMLInputElement.prototype;
    }

    // Step 1: Focus the element
    el.focus();
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // Step 2: Set value via native setter (bypasses React's synthetic getter/setter)
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, value);
    } else {
      el.value = value;
    }

    // Step 3: Reset React's internal value tracker so it sees the change
    var tracker = el._valueTracker;
    if (tracker) {
      tracker.setValue('');
    }
    // Also try resetting via React fiber (React 18+)
    var fiberKey = Object.keys(el).find(function(k) {
      return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$');
    });
    if (fiberKey) {
      var fiber = el[fiberKey];
      if (fiber && fiber.memoizedProps) {
        // Force React to see the value as changed
        var prevValue = fiber.memoizedProps.value;
        if (prevValue !== undefined) {
          fiber.memoizedProps.value = '';
        }
      }
    }

    // Step 4: Dispatch full event sequence
    // React listens to different events depending on version
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value
      }));
    } catch (e) {}

    // For range inputs, also dispatch specific events
    if (el.type === 'range') {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // Simulate mouse events for range sliders
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }

    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function showToast(title, sub) {
    var existing = document.getElementById('suno-fill-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.id = 'suno-fill-toast';
    var titleDiv = document.createElement('div');
    titleDiv.style.cssText = 'font-weight:700;margin-bottom:4px;';
    titleDiv.textContent = title;
    var subDiv = document.createElement('div');
    subDiv.style.cssText = 'font-size:11px;color:#aaa;';
    subDiv.textContent = sub || '';
    toast.appendChild(titleDiv);
    toast.appendChild(subDiv);
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;padding:14px 20px;background:#1a1a2e;color:#fff;border:1px solid #6c63ff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;transition:opacity 0.3s;';
    document.body.appendChild(toast);
    setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { toast.remove(); }, 300); }, 3500);
  }

  // ═══════════════════════════════════════
  //  SAVE TO GITHUB
  //  Multi-strategy data fetch per song
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

      var saved = 0;
      var total = selectedSongs.size;
      var errors = [];

      for (var entry of selectedSongs) {
        var clipId = entry[0];
        saved++;
        statusEl.textContent = 'Fetching ' + saved + '/' + total + '...';

        var songData;
        try {
          songData = await fetchSongData(clipId);
        } catch (fetchErr) {
          errors.push(clipId.slice(0, 8) + ': ' + fetchErr.message);
          songData = {
            id: clipId,
            title: entry[1].title || 'Untitled',
            lyrics: '',
            style: '',
            exclude: '',
            prompt: '',
            url: 'https://suno.com/song/' + clipId
          };
        }

        songData.score = score || '-';
        songData.savedAt = new Date().toISOString();

        statusEl.textContent = 'Saving ' + saved + '/' + total + '...';
        var markdown = buildMarkdown(songData);
        await saveToGitHub(settings, songData, markdown);
      }

      // Clear selections
      selectedSongs.clear();
      var cbs = document.querySelectorAll('.suno-git-checkbox.selected');
      for (var i = 0; i < cbs.length; i++) {
        cbs[i].classList.remove('selected');
        var p = cbs[i].closest('[data-suno-git]');
        if (p) p.classList.remove('suno-git-selected');
      }
      updateCount();

      if (errors.length > 0) {
        statusEl.className = 'suno-git-status error';
        statusEl.textContent = 'Saved with warnings: ' + errors.join('; ');
        setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 6000);
      } else {
        statusEl.className = 'suno-git-status success';
        statusEl.textContent = total + ' song(s) saved!';
        setTimeout(function() { statusEl.textContent = ''; statusEl.className = ''; }, 3000);
      }
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
      '- **Score**: ' + (data.score || '-') + ' / 100'
    ];

    if (data.model) lines.push('- **Model**: ' + data.model);
    if (data.duration) lines.push('- **Duration**: ' + Math.round(data.duration) + 's');
    if (data.audioUrl) lines.push('- **Audio**: [MP3](' + data.audioUrl + ')');
    lines.push('');

    // Style / Tags
    lines.push('## Style of Music');
    lines.push('');
    lines.push(data.style || '(no style)');
    lines.push('');

    // GPT Description Prompt
    if (data.prompt) {
      lines.push('## Prompt (GPT Description)');
      lines.push('');
      lines.push(data.prompt);
      lines.push('');
    }

    // Lyrics
    lines.push('## Lyrics');
    lines.push('');
    if (data.lyrics) {
      lines.push('```');
      lines.push(data.lyrics);
      lines.push('```');
    } else {
      lines.push('(no lyrics / instrumental)');
    }
    lines.push('');

    // Exclude Styles
    if (data.exclude) {
      lines.push('## Exclude Styles');
      lines.push('');
      lines.push(data.exclude);
      lines.push('');
    }

    return lines.join('\n');
  }

  async function saveToGitHub(settings, songData, markdown) {
    var date = new Date().toISOString().split('T')[0];
    var safeName = songData.title.replace(/[^a-zA-Z0-9\uAC00-\uD7A3\s-]/g, '').trim().replace(/\s+/g, '-') || 'untitled';
    var path = 'songs/' + date + '_' + safeName.slice(0, 50) + '_' + songData.id.slice(0, 8) + '.md';
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
        body: JSON.stringify({ message: 'Add: ' + songData.title + ' (' + date + ')', content: content })
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
