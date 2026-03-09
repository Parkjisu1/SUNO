const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.local.get(['github_token', 'github_owner', 'github_repo'], (data) => {
    if (data.github_token) $('token').value = data.github_token;
    if (data.github_owner) $('owner').value = data.github_owner;
    if (data.github_repo) $('repo').value = data.github_repo;
  });

  $('save').addEventListener('click', () => {
    const token = $('token').value.trim();
    const owner = $('owner').value.trim();
    const repo = $('repo').value.trim();

    if (!token || !owner || !repo) {
      showStatus('All fields are required', 'error');
      return;
    }

    chrome.storage.local.set({
      github_token: token,
      github_owner: owner,
      github_repo: repo
    }, () => {
      showStatus('Saved successfully!', 'success');
    });
  });
});

function showStatus(msg, type) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + type;
  setTimeout(() => { el.textContent = ''; }, 3000);
}
