(() => {
  'use strict';
  const commands = [
    { name: 'Notes', icon: '▤', description: 'A thought worth keeping', detail: 'Notes saves locally as you write. Search your notebook from the desktop launcher. This website illustration does not save notes.', keywords: 'write notebook thought local' },
    { name: 'Whiteboard', icon: '↗', description: 'Give an idea some room', detail: 'Use a pen or sticky notes, undo a stroke, and export a PNG. Whiteboard works offline in the app.', keywords: 'draw sketch pen sticky offline' },
    { name: 'Text studio', icon: 'Aa', description: 'Your words, your AI', detail: 'Build a prompt offline, or explicitly send text to a tested AI connection. Your own provider account and its limits apply.', keywords: 'ai prompt master translate text' },
    { name: 'Meowmate', icon: 'cat', description: 'A little company', detail: 'Meowmate opens a separate companion dock. It uses its own conversations and connections. Its newest build still needs native acceptance testing.', keywords: 'cat companion assistant dock' }
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
  fetch('/download/status').then(response => response.ok ? response.json() : null).then(status => {
    if (status?.ready !== true) return;
    const download = document.querySelector('#windows-download');
    download.href = '/download/windows'; download.removeAttribute('aria-disabled'); download.removeAttribute('tabindex');
    download.textContent = 'Download Windows preview ↓';
    document.querySelector('#download-status').textContent = 'Local Windows installer ready. Includes Meowcast and Meowmate.';
  }).catch(() => { /* A static export keeps the explicit unavailable state. */ });
})();
