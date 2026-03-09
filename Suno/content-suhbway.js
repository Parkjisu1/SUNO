(() => {
  'use strict';

  var currentPage = detectPage();
  if (!currentPage) return;

  if (currentPage === 'detail') {
    initDetailPage();
  } else if (currentPage === 'list') {
    initListPage();
  }

  function detectPage() {
    var path = window.location.pathname;
    if (path.includes('prompt_detail')) return 'detail';
    if (path.includes('prompt_list')) return 'list';
    // index.php may have prompt links too
    if (path.includes('index') || path === '/' || path === '') return 'list';
    return null;
  }

  // ═══════════════════════════════════════
  //  PROMPT DETAIL PAGE
  //  - Full data extraction
  //  - Floating "Send to Suno" button
  // ═══════════════════════════════════════

  function initDetailPage() {
    if (document.getElementById('suno-auto-btn')) return;

    // Auto-send if came from list page click
    var params = new URLSearchParams(window.location.search);
    var autoSend = params.get('auto_send') === 'true';

    var btn = document.createElement('button');
    btn.id = 'suno-auto-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 2L11 13"/>' +
      '<path d="M22 2L15 22L11 13L2 9L22 2Z"/>' +
      '</svg>' +
      '<span>Send to Suno</span>';
    document.body.appendChild(btn);

    btn.addEventListener('click', function() { sendToSuno(btn); });

    // Preview on hover
    var preview = document.createElement('div');
    preview.id = 'suno-auto-preview';
    preview.style.display = 'none';
    document.body.appendChild(preview);

    btn.addEventListener('mouseenter', function() {
      var data = extractDetailData();
      preview.innerHTML =
        '<div class="suno-preview-title">Will send to Suno:</div>' +
        '<div class="suno-preview-item"><b>Style:</b> ' + (data.prompt || '(none)').slice(0, 80) + '</div>' +
        '<div class="suno-preview-item"><b>Lyrics:</b> ' + (data.lyrics ? data.lyrics.slice(0, 60) + '...' : '(none)') + '</div>' +
        '<div class="suno-preview-item"><b>Exclude:</b> ' + (data.excludeStyles || '(none)').slice(0, 60) + '</div>' +
        '<div class="suno-preview-item"><b>Params:</b> W:' + (data.params.weirdness || '-') + '% S:' + (data.params.styleInfluence || '-') + '% A:' + (data.params.audioInfluence || '-') + '%</div>';
      preview.style.display = 'block';
    });

    btn.addEventListener('mouseleave', function() {
      preview.style.display = 'none';
    });

    // Auto-send
    if (autoSend) {
      setTimeout(function() { sendToSuno(btn); }, 1000);
    }
  }

  function sendToSuno(btn) {
    btn.classList.add('loading');
    btn.querySelector('span').textContent = 'Extracting...';

    try {
      var data = extractDetailData();

      if (!data.prompt && !data.lyrics) {
        throw new Error('No prompt or lyrics found');
      }

      chrome.storage.local.set({ suno_pending_fill: data }, function() {
        btn.querySelector('span').textContent = 'Opening Suno...';
        chrome.runtime.sendMessage({ action: 'openSunoCreate' });

        setTimeout(function() {
          btn.classList.remove('loading');
          btn.classList.add('done');
          btn.querySelector('span').textContent = 'Sent!';
          setTimeout(function() {
            btn.classList.remove('done');
            btn.querySelector('span').textContent = 'Send to Suno';
          }, 2000);
        }, 1000);
      });
    } catch (err) {
      btn.classList.remove('loading');
      btn.classList.add('err');
      btn.querySelector('span').textContent = err.message.slice(0, 30);
      setTimeout(function() {
        btn.classList.remove('err');
        btn.querySelector('span').textContent = 'Send to Suno';
      }, 3000);
    }
  }

  function extractDetailData() {
    // 1) Suno Prompt (Style of Music) from #promptContent
    var promptEl = document.getElementById('promptContent');
    var prompt = promptEl ? (promptEl.textContent || '').trim() : '';

    // 2) Lyrics from #lyricsContent
    var lyricsEl = document.getElementById('lyricsContent');
    var lyrics = lyricsEl ? (lyricsEl.textContent || '').trim() : '';

    // 3) Exclude Styles - find section with "Exclude" heading
    var excludeStyles = '';
    var headings = document.querySelectorAll('h2, h3, h4, strong, .section-title');
    for (var i = 0; i < headings.length; i++) {
      var hText = (headings[i].textContent || '').trim().toLowerCase();
      if (hText.includes('exclude') || hText.includes('제외')) {
        // Get the content after this heading
        var next = headings[i].nextElementSibling;
        if (next) {
          excludeStyles = (next.textContent || '').trim();
        }
        // Also check parent's next sibling
        if (!excludeStyles) {
          var parentDiv = headings[i].closest('div');
          if (parentDiv) {
            var nextDiv = parentDiv.nextElementSibling;
            if (nextDiv) excludeStyles = (nextDiv.textContent || '').trim();
          }
        }
        break;
      }
    }

    // 4) Parameters
    var params = {};
    var allElements = document.querySelectorAll('li, tr, div, span, p');
    for (var j = 0; j < allElements.length; j++) {
      var text = (allElements[j].textContent || '').trim();
      if (!text || text.length > 200) continue;

      var wm = text.match(/[Ww]eirdness[:\s]*(\d+)/);
      var sm = text.match(/[Ss]tyle\s*[Ii]nfluence[:\s]*(\d+)/);
      var am = text.match(/[Aa]udio\s*[Ii]nfluence[:\s]*(\d+)/);

      if (wm) params.weirdness = parseInt(wm[1]);
      if (sm) params.styleInfluence = parseInt(sm[1]);
      if (am) params.audioInfluence = parseInt(am[1]);
    }

    // 5) Title
    var title = '';
    var h1 = document.querySelector('h1, h2');
    if (h1) title = (h1.textContent || '').trim();

    return {
      prompt: prompt,
      lyrics: lyrics,
      excludeStyles: excludeStyles,
      params: params,
      title: title,
      pageUrl: window.location.href
    };
  }

  // ═══════════════════════════════════════
  //  PROMPT LIST PAGE
  //  - "Send" button on each prompt card
  // ═══════════════════════════════════════

  function initListPage() {
    injectListButtons();

    // Observe for dynamically loaded cards (pagination, filters)
    var observer = new MutationObserver(function() {
      injectListButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function injectListButtons() {
    // Find all prompt cards that link to prompt_detail
    var links = document.querySelectorAll('a[href*="prompt_detail.php"]');

    for (var i = 0; i < links.length; i++) {
      var card = links[i].closest('.prompt-card') || links[i];
      if (card.hasAttribute('data-suno-injected')) continue;
      card.setAttribute('data-suno-injected', 'true');

      var href = links[i].getAttribute('href');

      var sendBtn = document.createElement('button');
      sendBtn.className = 'suno-list-send-btn';
      sendBtn.setAttribute('data-href', href);
      sendBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 2L11 13"/>' +
        '<path d="M22 2L15 22L11 13L2 9L22 2Z"/>' +
        '</svg>' +
        ' Send to Suno';

      sendBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var targetHref = e.currentTarget.getAttribute('data-href');
        // Navigate to detail page with auto_send flag
        var separator = targetHref.includes('?') ? '&' : '?';
        window.location.href = targetHref + separator + 'auto_send=true';
      });

      // Insert button into the card
      card.style.position = 'relative';
      card.appendChild(sendBtn);
    }
  }
})();
