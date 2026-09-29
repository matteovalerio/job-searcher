import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stateDir } from './paths.js';

/*
 * Browser vero (Chrome tramite Playwright) per i siti che bloccano le richieste automatiche, come Indeed e
 * InfoJobs. Il profilo del browser è salvato in .job-searcher/browser: dopo aver superato una volta la
 * verifica "non sono un robot", i cookie restano e le esecuzioni successive di solito passano direttamente.
 *
 * Variabili d'ambiente (i vecchi nomi INDEED_* valgono ancora):
 *   JOB_SEARCHER_HEADLESS=1          non mostra la finestra (ma la verifica anti-robot non si può risolvere)
 *   JOB_SEARCHER_BROWSER=chrome      canale Playwright: chrome, msedge…
 *   JOB_SEARCHER_BROWSER_PATH=…      percorso di un browser Chromium qualsiasi (Brave, Chromium…)
 *   JOB_SEARCHER_BROWSER_ARGS=…      opzioni in più per Chrome, separate da spazi (sostituiscono quelle per WSL)
 */

const env = (name) => process.env[`JOB_SEARCHER_${name}`] || process.env[`INDEED_${name}`];

// Titoli e elementi tipici delle pagine di verifica (Cloudflare, DataDome…).
const CHALLENGE_TITLE = /just a moment|un momento|verifica|security check|additional verification|cloudflare|captcha/i;
const CHALLENGE_SELECTOR = '#challenge-form, iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #cf-wrapper';

/** Gira dentro WSL (Linux su Windows)? Lì le finestre passano da WSLg, che con Chrome ha dei problemi. */
export function isWsl(env = process.env, readVersion = () => readFileSync('/proc/version', 'utf8')) {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readVersion());
  } catch {
    return false;
  }
}

/**
 * Opzioni di avvio di Chrome. Su WSL la finestra spesso non si disegna (compare solo l'icona nella barra):
 * si disattiva l'accelerazione grafica e si usa X11 invece di Wayland, che di solito risolve.
 */
export function browserArgs({ wsl = isWsl(), custom = env('BROWSER_ARGS') } = {}) {
  if (custom) return custom.split(/\s+/).filter(Boolean);
  return wsl ? ['--disable-gpu', '--ozone-platform=x11'] : [];
}

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
    try {
      return await chromium.launchPersistentContext(userDataDir, { ...options, executablePath: env('BROWSER_PATH') });
    } catch (err) {
      const reason = launchProblem(err.message) ?? 'il file indicato non esiste';
      throw new Error(`il browser indicato in JOB_SEARCHER_BROWSER_PATH (${env('BROWSER_PATH')}) non parte: ${reason}`);
    }
  }
  const attempts = [
    ...(env('BROWSER') ? [{ channel: env('BROWSER') }] : [{ channel: 'chrome' }, { channel: 'msedge' }]),
    ...installedBrowsers().map((executablePath) => ({ executablePath })),
    {}, // Chromium di Playwright
  ];
  // Errori dei browser presenti ma che non partono: sono quelli che spiegano il problema.
  const failures = [];
  let expectedPath = null;
  for (const attempt of attempts) {
    try {
      return await chromium.launchPersistentContext(userDataDir, { ...options, ...attempt });
    } catch (err) {
      const reason = launchProblem(err.message);
      if (reason) failures.push(`${attempt.executablePath ?? attempt.channel ?? 'Chromium di Playwright'}: ${reason}`);
      // Dove Playwright cerca il suo Chromium: serve a capire se "npm run browser:install" ha funzionato.
      if (!attempt.channel && !attempt.executablePath) expectedPath = err.message.match(/doesn't exist at (\S+)/)?.[1];
    }
  }
  if (failures.length) throw new Error(`il browser non parte. ${failures.join(' | ')}`);
  throw new Error(
    'nessun browser trovato. Installa Chrome o Chromium, oppure scarica il browser di Playwright con ' +
      '"npm run browser:install" (dalla cartella del progetto), oppure indica il percorso con ' +
      'JOB_SEARCHER_BROWSER_PATH.' +
      (expectedPath
        ? ` Il browser di Playwright dovrebbe essere in ${expectedPath}, ma lì non c'è: se hai già eseguito ` +
          '"npm run browser:install", controlla che sia finito senza errori.'
        : ''),
  );
}

/**
 * Spiega perché un browser non è partito, oppure null se semplicemente non è installato.
 * Esportata per i test.
 */
export function launchProblem(message) {
  const text = String(message);
  if (
    /is not found at|Executable doesn't exist|not installed|Please run the following command to download/i.test(text)
  ) {
    return null;
  }
  if (/missing dependencies|error while loading shared libraries|install-deps/i.test(text)) {
    return (
      'mancano alcune librerie di sistema. Su Ubuntu/Debian installale con ' +
      '"sudo npx playwright-core install-deps chromium"'
    );
  }
  if (/X ?server|\$DISPLAY|Missing X|ozone|wayland|cannot open display/i.test(text)) {
    return (
      "non c'è uno schermo per aprire la finestra (per esempio su WSL o su un server). Usa " +
      'JOB_SEARCHER_HEADLESS=1 (ma la verifica anti-robot non si potrà risolvere) oppure lancialo da una sessione grafica'
    );
  }
  if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(text)) {
    return 'il profilo del browser è già in uso: chiudi altre ricerche in corso, o cancella .job-searcher/browser';
  }
  return (
    text
      .split('\n')
      .find((l) => l.trim() && !/^=+|browserType\./.test(l.trim()))
      ?.trim() ?? text.split('\n')[0]
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
  const userDataDir = stateDir('browser');
  const context = await launch(chromium, userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'it-IT',
    args: browserArgs(),
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
      await page.bringToFront().catch(() => {});
      try {
        await page.waitForFunction(ready, null, { timeout: 120000 });
      } catch {
        throw new Error(
          `${site}: verifica anti-robot non risolta entro 2 minuti. Se la finestra non si vede, prova ` +
            '"job-searcher browser" per aprirla e risolvere la verifica con calma (vedi README, WSL).',
        );
      }
    },
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    content: () => page.content(),
    close: () => context.close(),
  };
}

/**
 * Apre il browser del programma (stesso profilo delle ricerche) e aspetta che l'utente lo chiuda: serve a
 * controllare che la finestra si veda e a superare una volta la verifica anti-robot, i cui cookie restano.
 */
export async function openInteractive(url, { onReady = () => {} } = {}) {
  const chromium = await loadPlaywright();
  const context = await launch(chromium, stateDir('browser'), {
    headless: false,
    viewport: null,
    locale: 'it-IT',
    args: browserArgs(),
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
  onReady();
  await new Promise((resolve) => context.on('close', resolve));
}

/**
 * Salva una pagina in cui non è stata riconosciuta nessuna offerta, per capire cosa è cambiato nel sito.
 * @returns {Promise<string>} percorso del file
 */
export async function saveDebugPage(source, html) {
  const dir = stateDir('debug');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${source}-${new Date().toISOString().replace(/[:.]/g, '-')}.html`);
  await writeFile(file, html);
  return file;
}
