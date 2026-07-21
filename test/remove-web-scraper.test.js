'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

test('production KeyLab daemon is SQL-only with no web rollback mode', () => {
  const daemon = read('auto_scrape_headless.py');

  assert.match(daemon, /run_keylab_sync\.py/);
  assert.doesNotMatch(daemon, /PROGRESS_SOURCE|run_scrape\.py|web rollback|LaboAsia web/);
});

test('KeyLab SQL sync is independent from the removed web scraper', () => {
  const runner = read('run_keylab_sync.py');

  assert.match(runner, /from keylab_sync_helpers import/);
  assert.doesNotMatch(runner, /laboasia_gui_scraper_tkinter|from run_scrape import/);
  assert.equal(exists('run_scrape.py'), false);
  assert.equal(exists('laboasia_gui_scraper_tkinter.py'), false);
  assert.equal(exists('test_api_response.py'), false);
});

test('Node server exposes SQL sync status without loading a web scraper service', () => {
  const app = read('src/app.js');
  const routes = read('src/routes/keylab.routes.js');

  assert.match(app, /routes\/keylab\.routes/);
  assert.doesNotMatch(app, /services\/scraper\.service|routes\/scraper\.routes/);
  assert.match(routes, /keylab_sql/);
  assert.doesNotMatch(routes, /run_scrape\.py|spawnScraper|scrapeQueue/);
  assert.equal(exists('src/services/scraper.service.js'), false);
  assert.equal(exists('src/routes/scraper.routes.js'), false);
});

test('Python runtime requirements no longer install web scraping packages', () => {
  const requirements = read('requirements.txt');

  assert.doesNotMatch(requirements, /^requests\s*$/m);
  assert.doesNotMatch(requirements, /^playwright\s*$/m);
});
