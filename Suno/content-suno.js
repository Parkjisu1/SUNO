(() => {
  'use strict';

  if (document.getElementById('suno-git-panel')) return;

  // ─── State ───
  const selectedSongs = new Map(); // songId -> songData

  // ─── Selectors (based on Suno's actual DOM) ───
  const SEL = {
    // For auto-fill from suhbway.kr
    fillTargets: {
      prompt: [
        'textarea[class*="prompt"]',
        'textarea[class*="lyric"]',
        'textarea[placeholder*="lyrics"]',
        'textarea[placeholder*="Lyrics"]',
        'textarea[placeholder*="Write your own"]',
        'textarea[placeholder*="Enter your"]',
        'textarea',
      ],
      style: [
        'input[placeholder*="style"]',
        'input[placeholder*="Style"]',
        'input[placeholder*="genre"]',
        'input[placeholder*="Genre"]',
        'input[placeholder*="Enter style"]',
        'input[class*="style"]',
        '[class*="style"] input',
      ],
      excludeStyle: [
        'input[placeholder*="exclude"]',
        'input[placeholder*="Exclude"]',
        'input[placeholder*="negative"]',
        '[class*="exclude"] input',
        '[class*="negative"] input',
      ],
    },
    songContainers: [
      '.clip-row',
      'div[class*="clip"]',
      'div[style*="grid-template-columns"]',
    ],
    songLink: 'a[href*="/song/"]',
    promptInput: [
      'textarea[class*="prompt"]',
      'textarea[class*="lyric"]',
      'textarea[placeholder*="lyrics"]',
      'textarea[placeholder*="Lyrics"]',
      'textarea[placeholder*="prompt"]',
      'textarea',
    ],
    styleInput: [
      'input[class*="style"]',
      'input[placeholder*="style"]',
      'input[placeholder*="Style"]',
      'input[placeholder*="genre"]',
      'input[placeholder*="Genre"]',
      '[class*="style"] input',
      '[class*="genre"] input',
    ],
  };

  // ─── Floating Panel ───
  const panel = document.createElement('div');
  panel.id = 'suno-git-panel';
  panel.innerHTML = `
    <div class="suno-git-header">
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
          0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
          -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
          .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
          -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
          1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
          1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
          1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span>Suno to Git</span>
    </div>
    <div id="suno-git-count">Selected: 0</div>
    <div id="suno-git-score-wrap">
      <label for="suno-git-score">Score</label>
      <input type="number" id="suno-git-score" min="0" max="100" value="" placeholder="0-100" />
    </div>
    <button id="suno-git-save" disabled>Save to Git</button>
    <div id="suno-git-status"></div>
    <button id="suno-git-toggle" title="Minimize">_</button>
  `;
  document.body.appendChild(panel);

  // Toggle minimize
  const toggleBtn = document.getElementById('suno-git-toggle');
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('minimized');
    toggleBtn.textContent = panel.classList.contains('minimized') ? '+' : '_';
  });

  // Save button
  document.getElementById('suno-git-save').addEventListener('click', handleSave);

  // ─── Auto-fill from suhbway.kr ───
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'fillFromStorage') {
      checkAndFill();
    }
  });

  // Check on page load too
  setTimeout(checkAndFill, 2000);

  async function checkAndFill() {
    const data = await new Promise(r =>
      chrome.storage.local.get(['suno_pending_fill'], r)
    );
    if (!data.suno_pending_fill) return;

    const fill = data.suno_pending_fill;
    showFillNotification(fill);

    // Wait for Suno's React to fully render inputs
    let attempts = 0;
    const tryFill = setInterval(() => {
      attempts++;
      const filled = doFill(fill);
      if (filled || attempts > 20) {
        clearInterval(tryFill);
        // Clear pending data after successful fill
        if (filled) {
          chrome.storage.local.remove('suno_pending_fill');
        }
      }
    }, 500);
  }

  function doFill(fill) {
    let filledAny = false;

    // 1) Fill lyrics/prompt
    if (fill.lyrics || fill.prompt) {
      const textToFill = fill.lyrics || fill.prompt;
      for (const sel of SEL.fillTargets.prompt) {
        try {
          const el = document.querySelector(sel);
          if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
            setInputValue(el, textToFill);
            filledAny = true;
            break;
          }
        } catch (e) {}
      }
    }

    // 2) Fill style (use prompt as style description)
    if (fill.prompt) {
      for (const sel of SEL.fillTargets.style) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            setInputValue(el, fill.prompt);
            filledAny = true;
            break;
          }
        } catch (e) {}
      }
    }

    // 3) Fill exclude styles
    if (fill.excludeStyles) {
      for (const sel of SEL.fillTargets.excludeStyle) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            setInputValue(el, fill.excludeStyles);
            filledAny = true;
            break;
          }
        } catch (e) {}
      }
    }

    // 4) Set parameters (sliders) if available
    if (fill.params) {
      setSliderParams(fill.params);
    }

    return filledAny;
  }

  function setInputValue(el, value) {
    // React controlled inputs need native setter + events
    const nativeSetter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSliderParams(params) {
    // Find range/slider inputs and try to match them to params
    const sliders = document.querySelectorAll('input[type="range"]');
    const paramOrder = ['weirdness', 'styleInfluence', 'audioInfluence'];

    sliders.forEach((slider, idx) => {
      const label = slider.closest('div')?.querySelector('label, span')?.textContent?.toLowerCase() || '';
      let value = null;

      if (label.includes('weird') && params.weirdness != null) {
        value = params.weirdness;
      } else if (label.includes('style') && params.styleInfluence != null) {
        value = params.styleInfluence;
      } else if (label.includes('audio') && params.audioInfluence != null) {
        value = params.audioInfluence;
      } else if (idx < paramOrder.length && params[paramOrder[idx]] != null) {
        // Fallback: match by position
        value = params[paramOrder[idx]];
      }

      if (value != null) {
        setInputValue(slider, String(value));
      }
    });
  }

  function showFillNotification(fill) {
    const toast = document.createElement('div');
    toast.id = 'suno-fill-toast';
    toast.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;">Auto-filled from suhbway.kr</div>
      <div style="font-size:11px;color:#aaa;">${fill.title || 'Prompt loaded'}</div>
    `;
    toast.style.cssText = `
      position:fixed;top:20px;right:20px;z-index:999999;
      padding:14px 20px;background:#1a1a2e;color:#fff;
      border:1px solid #6c63ff;border-radius:10px;
      box-shadow:0 8px 30px rgba(0,0,0,0.5);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px;transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ─── Observe DOM for new song cards ───
  const observer = new MutationObserver(() => injectCheckboxes());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectCheckboxes, 1500);
  setInterval(injectCheckboxes, 3000);

  // ─── Inject checkboxes into song cards ───
  function injectCheckboxes() {
    // Find all song links on the page
    const songLinks = document.querySelectorAll(SEL.songLink);

    songLinks.forEach(link => {
      // Find the parent song container
      const container = findSongContainer(link);
      if (!container || container.hasAttribute('data-suno-git')) return;
      container.setAttribute('data-suno-git', 'true');

      const songId = extractSongId(link.href);
      if (!songId) return;

      // Create checkbox overlay
      const checkbox = document.createElement('div');
      checkbox.className = 'suno-git-checkbox';
      checkbox.dataset.songId = songId;
      checkbox.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      `;

      checkbox.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSong(checkbox, container, link);
      });

      container.style.position = 'relative';
      container.appendChild(checkbox);
    });
  }

  function findSongContainer(link) {
    // Walk up to find a reasonable container
    for (const sel of SEL.songContainers) {
      const match = link.closest(sel);
      if (match) return match;
    }
    // Fallback: find a grid-row style parent or just go up a few levels
    let el = link.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!el) break;
      const style = el.getAttribute('style') || '';
      const cls = el.className || '';
      if (style.includes('grid') || cls.includes('clip') || cls.includes('row') || cls.includes('card')) {
        return el;
      }
      el = el.parentElement;
    }
    // Last resort: direct parent
    return link.parentElement;
  }

  function extractSongId(href) {
    const match = href.match(/\/song\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  }

  function toggleSong(checkbox, container, link) {
    const songId = checkbox.dataset.songId;
    const isSelected = checkbox.classList.toggle('selected');
    container.classList.toggle('suno-git-selected', isSelected);

    if (isSelected) {
      const title = link.textContent?.trim() || 'Untitled';
      const songUrl = link.href.startsWith('http') ? link.href : `https://suno.com${link.getAttribute('href')}`;

      // Extract prompt from page (create page has input fields)
      const prompt = extractPrompt(container);
      const style = extractStyle(container);

      selectedSongs.set(songId, {
        id: songId,
        title,
        url: songUrl,
        prompt,
        style,
        savedAt: new Date().toISOString()
      });
    } else {
      selectedSongs.delete(songId);
    }

    updateCount();
  }

  function extractPrompt(container) {
    // 1) Try to find prompt/lyrics within or near the song container
    const nearbyText = findTextNearby(container, [
      '[class*="lyric"]', '[class*="Lyric"]', '[class*="prompt"]',
      '[class*="lyrics"]', '[class*="description"]'
    ]);
    if (nearbyText) return nearbyText;

    // 2) Try to find the main prompt textarea on the create page
    for (const sel of SEL.promptInput) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.value?.trim() || el.textContent?.trim();
          if (text && text.length > 2) return text;
        }
      } catch (e) {}
    }

    // 3) Look for any large text block near the container
    const allText = container.querySelectorAll('span, p, div');
    for (const el of allText) {
      const text = el.textContent?.trim();
      if (text && text.length > 20 && !text.includes('http') && el.children.length === 0) {
        return text;
      }
    }

    return '(prompt not found - check song page)';
  }

  function extractStyle(container) {
    // 1) Try style inputs on the create page
    for (const sel of SEL.styleInput) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.value?.trim() || el.textContent?.trim();
          if (text && text.length > 1) return text;
        }
      } catch (e) {}
    }

    // 2) Look for tag-like elements near the container
    const tags = container.querySelectorAll('[class*="tag"], [class*="badge"], [class*="chip"]');
    const tagTexts = [];
    tags.forEach(t => {
      const text = t.textContent?.trim();
      if (text && text.length < 50) tagTexts.push(text);
    });
    if (tagTexts.length > 0) return tagTexts.join(', ');

    return '(style not found)';
  }

  function findTextNearby(container, selectors) {
    // Search inside the container first
    for (const sel of selectors) {
      try {
        const el = container.querySelector(sel);
        if (el) {
          const text = el.textContent?.trim() || el.value?.trim();
          if (text && text.length > 2) return text;
        }
      } catch (e) {}
    }
    // Search in the parent context
    const parent = container.parentElement;
    if (parent) {
      for (const sel of selectors) {
        try {
          const el = parent.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim() || el.value?.trim();
            if (text && text.length > 2) return text;
          }
        } catch (e) {}
      }
    }
    return '';
  }

  function updateCount() {
    const count = selectedSongs.size;
    document.getElementById('suno-git-count').textContent = `Selected: ${count}`;
    document.getElementById('suno-git-save').disabled = count === 0;
  }

  // ─── Save to GitHub ───
  async function handleSave() {
    const saveBtn = document.getElementById('suno-git-save');
    const statusEl = document.getElementById('suno-git-status');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    statusEl.textContent = '';

    try {
      const settings = await getSettings();
      if (!settings.github_token) {
        throw new Error('Set up GitHub in extension popup first');
      }

      const score = document.getElementById('suno-git-score').value.trim();

      let saved = 0;
      const total = selectedSongs.size;

      for (const [songId, songData] of selectedSongs) {
        songData.score = score || '-';
        statusEl.textContent = `Saving ${++saved}/${total}...`;
        const markdown = buildMarkdown(songData);
        await saveToGitHub(settings, songData, markdown);
      }

      // Clear selections
      selectedSongs.clear();
      document.querySelectorAll('.suno-git-checkbox.selected').forEach(cb => {
        cb.classList.remove('selected');
        cb.closest('[data-suno-git]')?.classList.remove('suno-git-selected');
      });
      updateCount();

      statusEl.className = 'suno-git-status success';
      statusEl.textContent = `${total} song(s) saved!`;
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'suno-git-status'; }, 3000);
    } catch (err) {
      statusEl.className = 'suno-git-status error';
      statusEl.textContent = err.message;
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'suno-git-status'; }, 4000);
    } finally {
      saveBtn.textContent = 'Save to Git';
      saveBtn.disabled = selectedSongs.size === 0;
    }
  }

  function buildMarkdown(data) {
    const lines = [
      `# ${data.title}`,
      '',
      `- **Date**: ${data.savedAt}`,
      `- **URL**: [${data.url}](${data.url})`,
      `- **Song ID**: \`${data.id}\``,
      `- **Score**: ${data.score || '-'} / 100`,
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
    ];
    return lines.join('\n');
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['github_token', 'github_owner', 'github_repo'], resolve);
    });
  }

  async function saveToGitHub(settings, songData, markdown) {
    const { github_token, github_owner, github_repo } = settings;
    const date = new Date().toISOString().split('T')[0];
    const safeName = songData.title.replace(/[^a-zA-Z0-9가-힣\s-]/g, '').trim().replace(/\s+/g, '-') || 'untitled';
    const path = `songs/${date}_${safeName}_${songData.id.slice(0, 8)}.md`;

    const content = btoa(unescape(encodeURIComponent(markdown)));

    const res = await fetch(
      `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${github_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({
          message: `Add: ${songData.title} (${date})`,
          content: content
        })
      }
    );

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `GitHub error: ${res.status}`);
    }

    // Update README index
    await updateIndex(settings, songData, date);
  }

  async function updateIndex(settings, songData, date) {
    const { github_token, github_owner, github_repo } = settings;
    const indexPath = 'README.md';

    let existingSha = null;
    let existingContent = '# Suno Music History\n\n| Date | Title | Score | URL |\n|------|-------|-------|-----|\n';

    try {
      const res = await fetch(
        `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${indexPath}`,
        {
          headers: {
            'Authorization': `Bearer ${github_token}`,
            'Accept': 'application/vnd.github+json'
          }
        }
      );
      if (res.ok) {
        const data = await res.json();
        existingSha = data.sha;
        existingContent = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
      }
    } catch (e) {}

    const newRow = `| ${date} | ${songData.title} | ${songData.score || '-'} | [Listen](${songData.url}) |`;
    const updatedContent = existingContent.trimEnd() + '\n' + newRow + '\n';
    const content = btoa(unescape(encodeURIComponent(updatedContent)));

    const body = { message: `Update index: ${songData.title}`, content };
    if (existingSha) body.sha = existingSha;

    await fetch(
      `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${indexPath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${github_token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify(body)
      }
    );
  }
})();
