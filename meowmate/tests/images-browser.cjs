const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.APPDATA, 'npm/node_modules/playwright'));

let server, browser;
(async () => {
  const { createServer } = await import('vite');
  server = await createServer({ root: path.join(__dirname, '..'), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  let blockedExternalRequests = 0;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    blockedExternalRequests++;
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/tests/images-browser.browser.html`);
  await page.waitForFunction(() => typeof window.runImagesBrowserChecks === 'function');
  const checks = await page.evaluate(() => window.runImagesBrowserChecks());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ passed: checks.length, checks, blockedExternalRequests, liveGoogleRequests: 0, scope: 'Production Images UI with injected actions in isolated headless Chromium.' }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  await server?.close();
});
