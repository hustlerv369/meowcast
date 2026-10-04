// Local-only static preview plus one readiness-gated installer; no profiles or arbitrary files.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const appRoot = fs.existsSync(path.resolve(root, '../app/package.json')) ? path.resolve(root, '../app') : path.resolve(root, '..');
const installerName = 'Meowcast Setup 9.30.0-preview.17.exe';
const installer = path.join(appRoot, 'release', installerName);
const installerReady = () => {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'download-state.json'), 'utf8')).ready === true && fs.statSync(installer).isFile() && fs.statSync(installer).size > 0; } catch { return false; }
};
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const allowed = new Set(['/index.html', '/style.css', '/app.js', '/assets/cat-black.png', '/assets/cat-white.png']);
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/') pathname = '/index.html';
  if (['GET', 'HEAD'].includes(request.method) && pathname === '/download/status') {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    response.end(request.method === 'HEAD' ? '' : JSON.stringify({ ready: installerReady() })); return;
  }
  if (['GET', 'HEAD'].includes(request.method) && pathname === '/download/windows') {
    if (!installerReady()) { response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' }); response.end('The Windows installer is still being prepared. Return to the website for its current status.'); return; }
    response.writeHead(200, { 'Content-Type': 'application/vnd.microsoft.portable-executable', 'Content-Disposition': `attachment; filename="Meowcast-Setup-Windows.exe"`, 'Content-Length': fs.statSync(installer).size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(installer).on('error', () => response.destroy()).pipe(response);
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(pathname)) { response.writeHead(404); response.end('Not found'); return; }
  const file = path.join(root, pathname);
  response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(file).on('error', () => { response.statusCode = 404; response.end('Not found'); }).pipe(response);
});
server.listen(4317, '127.0.0.1', () => console.log('Meowcast website preview: http://127.0.0.1:4317'));
