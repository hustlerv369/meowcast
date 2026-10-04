(() => {
  'use strict';
  const commands = [
    { name: 'Notes', icon: '▤', description: 'A thought worth keeping', detail: 'Notes saves locally as you write. Search your notebook from the desktop launcher. This website illustration does not save notes.', keywords: 'write notebook thought local' },
    { name: 'Whiteboard', icon: '↗', description: 'Give an idea some room', detail: 'Use a pen or sticky notes, undo a stroke, and export a PNG. Whiteboard works offline in the app.', keywords: 'draw sketch pen sticky offline' },
    { name: 'Text studio', icon: 'Aa', description: 'Your words, your AI', detail: 'Build a prompt offline, or explicitly send text to a tested AI connection. Your own provider account and its limits apply.', keywords: 'ai prompt master translate text' },
    { name: 'Meowmate', icon: 'cat', description: 'A little company', detail: 'Meowmate opens a separate companion dock, included with the Windows preview. It uses its own conversations and connections.', keywords: 'cat companion assistant dock' }
  ];
  const search = document.querySelector('#demo-search');
  const results = document.querySelector('#demo-results');
  const detail = document.querySelector('#detail-text');
  const launcher = document.querySelector('.launcher');
  let visible = commands;
  let selected = 0;
  function choose(index) {
    selected = index;
    results.querySelectorAll('.command').forEach((button, i) => button.classList.toggle('selected', i === index));
    if (visible[index]) detail.textContent = visible[index].detail;
  }
  function render() {
    results.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p'); empty.className = 'no-results'; empty.textContent = 'Try Notes, Whiteboard, Text studio, or Meowmate.'; results.append(empty); return;
    }
    visible.forEach((command, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'command';
      const icon = document.createElement('span'); icon.className = 'command-icon'; icon.setAttribute('aria-hidden', 'true');
      if (command.icon === 'cat') { const image = document.createElement('img'); image.src = `assets/cat-${launcher.dataset.theme === 'dark' ? 'white' : 'black'}.png`; image.width = 24; image.height = 24; image.alt = ''; icon.append(image); } else icon.textContent = command.icon;
      const name = document.createElement('span'); name.className = 'command-name'; name.textContent = command.name;
      const description = document.createElement('span'); description.className = 'command-desc'; description.textContent = command.description;
      const enter = document.createElement('span'); enter.className = 'enter'; enter.textContent = '↵'; enter.setAttribute('aria-hidden', 'true');
      button.append(icon, name, description, enter); button.addEventListener('click', () => choose(i)); button.addEventListener('focus', () => choose(i)); results.append(button);
    });
    selected = Math.min(selected, visible.length - 1);
    results.children[selected]?.classList.add('selected');
  }
  search.addEventListener('input', () => { const query = search.value.trim().toLowerCase(); visible = commands.filter(command => `${command.name} ${command.keywords}`.toLowerCase().includes(query)); selected = 0; render(); });
  search.addEventListener('keydown', event => {
    if (!visible.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); choose((selected + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length); }
    if (event.key === 'Enter') { event.preventDefault(); choose(selected); }
    if (event.key === 'Escape') { search.value = ''; visible = commands; selected = 0; render(); }
  });
  document.querySelector('.theme-button').addEventListener('click', event => {
    const light = launcher.dataset.theme !== 'light'; launcher.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('.theme-label').textContent = light ? 'Light' : 'Dark';
    event.currentTarget.setAttribute('aria-label', `Switch illustration to ${light ? 'dark' : 'light'} theme`);
    document.querySelector('.launcher-brand img').src = `assets/cat-${light ? 'black' : 'white'}.png`; render();
  });
  render();
  function enableDownload(url, message) {
    const download = document.querySelector('#windows-download');
    download.href = url; download.removeAttribute('aria-disabled'); download.removeAttribute('tabindex');
    download.textContent = 'Download Windows preview.14 ↓';
    document.querySelector('#download-status').textContent = message;
  }
  async function resolveDownload() {
    const releaseUrl = 'https://github.com/hustlerv369/meowcast/releases/tag/v9.30.0-preview.14';
    const assetUrl = 'https://github.com/hustlerv369/meowcast/releases/download/v9.30.0-preview.14/Meowcast.Setup.9.30.0-preview.14.exe';
    if (['127.0.0.1', 'localhost'].includes(location.hostname)) {
      try {
        const response = await fetch('/download/status');
        const status = response.ok ? await response.json() : null;
        if (status?.ready === true) {
          enableDownload('/download/windows', 'Local Windows installer ready. Includes Meowcast and Meowmate.');
          return;
        }
      } catch { /* Continue to the published-release check. */ }
    }
    try {
      const response = await fetch('https://api.github.com/repos/hustlerv369/meowcast/releases/tags/v9.30.0-preview.14', { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) return;
      const release = await response.json();
      if (release.draft === true || release.tag_name !== 'v9.30.0-preview.14' || release.html_url !== releaseUrl) return;
      document.querySelector('#release-link').href = releaseUrl;
      if (!Array.isArray(release.assets) || !release.assets.some(asset => asset.browser_download_url === assetUrl && asset.state === 'uploaded' && asset.size > 0)) return;
      enableDownload(assetUrl, 'Windows preview.14 is available on GitHub. Includes Meowcast and Meowmate.');
    } catch { /* Keep the unavailable state when GitHub cannot confirm the asset. */ }
  }
  void resolveDownload();
})();
