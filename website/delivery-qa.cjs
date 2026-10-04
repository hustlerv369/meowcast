const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const pinned = html.match(/releases\/download\/v9\.30\.0-preview\.(\d+)\/([^"\s]+)/);
const current = pinned?.[1];
assert(current, 'HTML must pin a versioned installer');
const version = process.env.MEOWCAST_TEST_PREVIEW || current;
assert(/^\d+$/.test(version), 'Preview version must be numeric');
const filename = process.env.MEOWCAST_TEST_ASSET || pinned[2];
assert(/^[A-Za-z0-9.-]+\.exe$/.test(filename), 'Expected a plain installer filename');
const candidate = version !== current || filename !== pinned[2];
const transform = text => text.replaceAll(pinned[2], filename).replaceAll(`preview.${current}`, `preview.${version}`);
const tag = `v9.30.0-preview.${version}`;
const api = `https://api.github.com/repos/hustlerv369/meowcast/releases/tags/${tag}`;
const asset = `https://github.com/hustlerv369/meowcast/releases/download/${tag}/${filename}`;
const release = { draft: false, tag_name: tag, html_url: `https://github.com/hustlerv369/meowcast/releases/tag/${tag}`, assets: [{ browser_download_url: asset, state: 'uploaded', size: 100 }] };
const allowed = new Set(['index.html', 'style.css', 'app.js', 'assets/cat-black.png', 'assets/cat-white.png']);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    for (const [name, status, body, scriptEnabled] of [
      ['API rate limited retains pinned asset', 429, {}, true],
      ['API offline retains pinned asset', 0, {}, true],
      ['JavaScript disabled retains pinned asset', 200, release, false],
      ['release metadata unavailable retains pinned asset', 404, {}, true],
      ['asset absent from metadata retains pinned asset', 200, { ...release, assets: [] }, true],
      ['draft metadata cannot replace pinned asset', 200, { ...release, draft: true }, true],
      ['wrong asset cannot replace pinned asset', 200, { ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://example.com/file.exe' }] }, true],
      ['unverified future release cannot replace pinned asset', 200, { ...release, tag_name: 'v999', html_url: 'https://example.com/release' }, true],
      ['matching published metadata preserves pinned asset', 200, release, true],
    ]) {
      const context = await browser.newContext({ javaScriptEnabled: scriptEnabled });
      const page = await context.newPage();
      let localRequests = 0;
      await context.route('**/*', route => {
        const url = route.request().url();
        if (url === api) return status === 0 ? route.abort('failed') : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (!url.startsWith('https://site.test/')) return route.abort();
        const pathname = new URL(url).pathname;
        if (pathname.startsWith('/download')) localRequests++;
        const file = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!allowed.has(file)) return route.fulfill({ status: 404 });
        if (file === 'index.html' || file === 'app.js') return route.fulfill({ contentType: file.endsWith('.html') ? 'text/html' : 'application/javascript', body: transform(fs.readFileSync(path.join(__dirname, file), 'utf8')) });
        return route.fulfill({ path: path.join(__dirname, file) });
      });
      await page.goto('https://site.test/', { waitUntil: 'networkidle' });
      assert.equal(await page.locator('#windows-download').getAttribute('href'), asset, name);
      assert.equal(await page.locator('.nav-download').getAttribute('href'), asset, name);
      assert.notEqual(await page.locator('#windows-download').getAttribute('aria-disabled'), 'true', name);
      assert.doesNotMatch(await page.locator('body').innerText(), /preview|9\.30\.0/i, 'Visible copy must not expose development release labels');
      assert.doesNotMatch(await page.locator('.nav-download').getAttribute('aria-label'), /preview|9\.30\.0/i);
      assert.match(await page.locator('#preview').innerText(), /macOS version coming soon/);
      assert.equal(localRequests, 0, 'Static hosting must not probe local installer routes');
      assert.equal(await page.locator('#release-link').getAttribute('href'), release.html_url);
      checks.push({ name, result: 'PASS' });
      await context.close();
    }
    console.log(JSON.stringify({ preview: version, candidateOnly: candidate, passed: checks.length, checks, note: 'Isolated browser fixtures only. Public installer upload, size, hash and HTTP availability require separate verification.' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
