import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Browser vero (Chrome tramite Playwright) per i siti che bloccano le richieste automatiche, come Indeed e
 * InfoJobs. Il profilo del browser è salvato in .job-searcher/browser: dopo aver superato una volta la
 * verifica "non sono un robot", i cookie restano e le esecuzioni successive di solito passano direttamente.
 *
 * Variabili d'ambiente (i vecchi nomi INDEED_* valgono ancora):
 *   JOB_SEARCHER_HEADLESS=1          non mostra la finestra (ma la verifica anti-robot non si può risolvere)
 *   JOB_SEARCHER_BROWSER=chrome      canale Playwright: chrome, msedge…
 *   JOB_SEARCHER_BROWSER_PATH=…      percorso di un browser Chromium qualsiasi (Brave, Chromium…)
 */

const env = (name) => process.env[`JOB_SEARCHER_${name}`] || process.env[`INDEED_${name}`];

// Titoli e elementi tipici delle pagine di verifica (Cloudflare, DataDome…).
const CHALLENGE_TITLE = /just a moment|un momento|verifica|security check|additional verification|cloudflare|captcha/i;
const CHALLENGE_SELECTOR = '#challenge-form, iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #cf-wrapper';

async function loadPlaywright() {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    throw new Error('manca playwright-core: esegui "npm install"');
  }
}

// Browser basati su Chromium installati di solito, oltre a Chrome ed Edge (che Playwright trova da solo).
const KNOWN_BROWSERS = {
  linux: [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/brave-browser',
    '/usr/bin/brave',
    '/usr/bin/microsoft-edge',
    '/usr/bin/vivaldi',
    '/usr/bin/opera',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
  ],
  win32: [
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env.PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Vivaldi\\Application\\vivaldi.exe`,
  ],
};

/** Percorsi dei browser trovati su questo computer. */
export function installedBrowsers(platform = process.platform, exists = existsSync) {
  return (KNOWN_BROWSERS[platform] ?? []).filter((p) => !p.includes('undefined') && exists(p));
}

/**
 * Avvia il browser: quello indicato, altrimenti Chrome, Edge, un altro browser Chromium installato
 * (Chromium, Brave, Vivaldi…) e infine il Chromium scaricato con "npx playwright-core install chromium".
 */
async function launch(chromium, userDataDir, options) {
  if (env('BROWSER_PATH')) {
    return chromium.launchPersistentContext(userDataDir, { ...options, executablePath: env('BROWSER_PATH') });
  }
  const attempts = [
    ...(env('BROWSER') ? [{ channel: env('BROWSER') }] : [{ channel: 'chrome' }, { channel: 'msedge' }]),
    ...installedBrowsers().map((executablePath) => ({ executablePath })),
    {}, // Chromium di Playwright
  ];
  // Errori dei browser trovati sul computer ma che non partono: aiutano a capire il problema.
  const failures = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launchPersistentContext(userDataDir, { ...options, ...attempt });
    } catch (err) {
      if (attempt.executablePath) failures.push(`${attempt.executablePath}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    (failures.length ? `nessun browser è partito (${failures.join('; ')}). ` : 'nessun browser trovato. ') +
      'Installa Chrome o Chromium, oppure scarica il browser di Playwright con "npm run browser:install", ' +
      'oppure indica il percorso con JOB_SEARCHER_BROWSER_PATH',
  );
}

/**
 * Apre il browser con profilo persistente.
 * `load(url, { ready, empty, site })` carica una pagina; `ready` ed `empty` sono funzioni eseguite nella
 * pagina che dicono se ci sono risultati o se la ricerca è vuota. Se compare una verifica anti-robot, con la
 * finestra visibile si aspetta (fino a 2 minuti) che la risolva l'utente.
 */
export async function openBrowser() {
  const chromium = await loadPlaywright();
  const headless = ['1', 'true'].includes(env('HEADLESS') ?? '');
  const userDataDir = path.resolve('.job-searcher', 'browser');
  const context = await launch(chromium, userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'it-IT',
  });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    headless,
    page,
    async load(url, { ready, empty = () => false, site = 'Il sito' }) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Alcuni siti caricano i risultati dopo la pagina: lasciamo qualche secondo.
      await page.waitForFunction(ready, null, { timeout: 5000 }).catch(() => {});
      if ((await page.evaluate(ready)) || (await page.evaluate(empty))) return;
      const challenge =
        CHALLENGE_TITLE.test(await page.title()) ||
        (await page.evaluate((sel) => Boolean(document.querySelector(sel)), CHALLENGE_SELECTOR));
      if (!challenge) return;
      if (headless) {
        throw new Error(`${site} chiede la verifica anti-robot: esegui una volta senza JOB_SEARCHER_HEADLESS`);
      }
      process.stderr.write(`  ${site} chiede una verifica anti-robot: risolvila nella finestra del browser…\n`);
      await page.waitForFunction(ready, null, { timeout: 120000 });
    },
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    content: () => page.content(),
    close: () => context.close(),
  };
}

/**
 * Salva una pagina in cui non è stata riconosciuta nessuna offerta, per capire cosa è cambiato nel sito.
 * @returns {Promise<string>} percorso del file
 */
export async function saveDebugPage(source, html) {
  const dir = path.join('.job-searcher', 'debug');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${source}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  await writeFile(file, html);
  return file;
}
