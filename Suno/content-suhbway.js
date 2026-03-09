(() => {
  'use strict';

  if (document.getElementById('suno-auto-btn')) return;

  // ─── Extract data from prompt_detail page ───
  function extractPromptData() {
    // 1) Prompt text from #promptContent
    const promptEl = document.getElementById('promptContent');
    const prompt = promptEl?.textContent?.trim() || '';

    // 2) Lyrics from #lyricsContent
    const lyricsEl = document.getElementById('lyricsContent');
    const lyrics = lyricsEl?.textContent?.trim() || '';

    // 3) Exclude styles
    let excludeStyles = '';
    document.querySelectorAll('h3, h4, .section-title, strong').forEach(el => {
      const text = el.textContent?.trim();
      if (text && (text.includes('Exclude') || text.includes('제외') || text.includes('exclude'))) {
        const parent = el.closest('div') || el.parentElement;
        if (parent) {
          const sibling = el.nextElementSibling || parent.querySelector('p, span, div:not(:first-child)');
          if (sibling) excludeStyles = sibling.textContent?.trim() || '';
        }
      }
    });

    // 4) Parameters (Weirdness, Style Influence, Audio Influence)
    const params = {};
    document.querySelectorAll('li, tr, .param-item, div').forEach(el => {
      const text = el.textContent?.trim();
      if (!text || text.length > 200) return;

      const weirdMatch = text.match(/Weirdness[:\s]*(\d+)/i);
      const styleMatch = text.match(/Style\s*Influence[:\s]*(\d+)/i);
      const audioMatch = text.match(/Audio\s*Influence[:\s]*(\d+)/i);

      if (weirdMatch) params.weirdness = parseInt(weirdMatch[1]);
      if (styleMatch) params.styleInfluence = parseInt(styleMatch[1]);
      if (audioMatch) params.audioInfluence = parseInt(audioMatch[1]);
    });

    // 5) Title
    const title = document.querySelector('h1, h2, .prompt-title')?.textContent?.trim() || '';

    // 6) Page URL
    const pageUrl = window.location.href;

    return { prompt, lyrics, excludeStyles, params, title, pageUrl };
  }

  // ─── Create "Send to Suno" button ───
  const btn = document.createElement('button');
  btn.id = 'suno-auto-btn';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 2L11 13"/>
      <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
    </svg>
    <span>Send to Suno</span>
  `;
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.classList.add('loading');
    btn.querySelector('span').textContent = 'Extracting...';

    try {
      const data = extractPromptData();

      if (!data.prompt && !data.lyrics) {
        throw new Error('No prompt or lyrics found on this page');
      }

      // Save to chrome.storage for the Suno content script to pick up
      await chrome.storage.local.set({ suno_pending_fill: data });

      btn.querySelector('span').textContent = 'Opening Suno...';

      // Tell background to open/focus Suno create tab
      chrome.runtime.sendMessage({ action: 'openSunoCreate' });

      setTimeout(() => {
        btn.classList.remove('loading');
        btn.classList.add('done');
        btn.querySelector('span').textContent = 'Sent!';
        setTimeout(() => {
          btn.classList.remove('done');
          btn.querySelector('span').textContent = 'Send to Suno';
        }, 2000);
      }, 1000);

    } catch (err) {
      btn.classList.remove('loading');
      btn.classList.add('err');
      btn.querySelector('span').textContent = err.message.slice(0, 30);
      setTimeout(() => {
        btn.classList.remove('err');
        btn.querySelector('span').textContent = 'Send to Suno';
      }, 3000);
    }
  });

  // ─── Also show a preview of what will be sent ───
  const preview = document.createElement('div');
  preview.id = 'suno-auto-preview';
  preview.style.display = 'none';
  document.body.appendChild(preview);

  btn.addEventListener('mouseenter', () => {
    const data = extractPromptData();
    preview.innerHTML = `
      <div class="suno-preview-title">Will send to Suno:</div>
      <div class="suno-preview-item"><b>Prompt:</b> ${data.prompt.slice(0, 80)}${data.prompt.length > 80 ? '...' : ''}</div>
      <div class="suno-preview-item"><b>Lyrics:</b> ${data.lyrics ? data.lyrics.slice(0, 60) + '...' : '(none)'}</div>
      <div class="suno-preview-item"><b>Params:</b> W:${data.params.weirdness ?? '-'}% S:${data.params.styleInfluence ?? '-'}% A:${data.params.audioInfluence ?? '-'}%</div>
    `;
    preview.style.display = 'block';
  });

  btn.addEventListener('mouseleave', () => {
    preview.style.display = 'none';
  });
})();
