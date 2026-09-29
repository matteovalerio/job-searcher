import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveProfile } from '../src/config.js';

test('infojobs è attiva solo se richiesta', () => {
  const base = { keywords: ['editor'], targets: [{ type: 'area', place: 'Padova' }] };
  const names = (profile, opts) => resolveProfile(profile, opts).targets[0].sources.map((s) => s.name);
  assert.ok(!names(base).includes('infojobs'));
  assert.ok(names({ ...base, enableSources: ['infojobs'] }).includes('infojobs'));
  assert.deepEqual(names(base, { onlySources: ['infojobs'] }), ['infojobs']);
});

test('browser: spiega perché non parte', async () => {
  const { launchProblem } = await import('../src/browser.js');
  assert.equal(launchProblem("browserType.launchPersistentContext: Executable doesn't exist at /x/chrome"), null);
  assert.equal(launchProblem("Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome"), null);
  assert.match(launchProblem('Host system is missing dependencies to run browsers'), /install-deps chromium/);
  assert.match(
    launchProblem(
      'Target page closed\nBrowser logs:\nLooks like you launched a headed browser without having a XServer running.',
    ),
    /non c'è uno schermo.*JOB_SEARCHER_HEADLESS=1/,
  );
  assert.match(launchProblem('Failed to create a ProcessSingleton for your profile directory'), /già in uso/);
});

test('browser su WSL: opzioni per far vedere la finestra, sostituibili da JOB_SEARCHER_BROWSER_ARGS', async () => {
  const { browserArgs, isWsl } = await import('../src/browser.js');
  assert.equal(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }), true);
  assert.equal(
    isWsl({}, () => 'Linux version 5.15.153.1-microsoft-standard-WSL2'),
    true,
  );
  assert.equal(
    isWsl({}, () => 'Linux version 6.8.0-generic (Ubuntu)'),
    false,
  );
  assert.equal(
    isWsl({}, () => {
      throw new Error('ENOENT');
    }),
    false,
  );
  assert.deepEqual(browserArgs({ wsl: true, custom: undefined }), ['--disable-gpu', '--ozone-platform=x11']);
  assert.deepEqual(browserArgs({ wsl: false, custom: undefined }), []);
  assert.deepEqual(browserArgs({ wsl: true, custom: ' --start-maximized  --disable-gpu ' }), [
    '--start-maximized',
    '--disable-gpu',
  ]);
});
