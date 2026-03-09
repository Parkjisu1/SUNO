// Background service worker - handles tab communication

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'openSunoCreate') {
    // Find existing Suno create tab or open new one
    chrome.tabs.query({ url: 'https://suno.com/*' }, (tabs) => {
      const createTab = tabs.find(t => t.url?.includes('/create'));
      if (createTab) {
        // Focus existing tab and reload to trigger fill
        chrome.tabs.update(createTab.id, { active: true });
        chrome.tabs.sendMessage(createTab.id, { action: 'fillFromStorage' });
      } else {
        // Open new create tab
        chrome.tabs.create({ url: 'https://suno.com/create' });
      }
    });
  }
});
