#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { applyOverrides, resolveProfile } from './config.js';
import { describeTargets, listProfiles, loadProfile, profilePath, profilesDir, saveProfile } from './profiles/store.js';
import { runWizard } from './profiles/wizard.js';
import { renderCsv } from './output/csv.js';
import { renderHtml } from './output/html.js';
import { renderJson } from './output/json.js';
import { c, formatReasons, renderRejected, renderTerminal } from './output/terminal.js';
import { runSearch } from './search.js';
import { builtinSources, missingEnv } from './sources/index.js';
import { SeenStore } from './store.js';

const HELP = `
job-searcher — cerca offerte di lavoro su più portali

Uso:
  job-searcher search [opzioni]         esegue la ricerca (comando predefinito)
  job-searcher profiles                 elenca i profili salvati
  job-searcher profile new [opzioni]    crea un profilo, da CV in PDF e/o rispondendo a domande
  job-searcher profile show <nome>      mostra un profilo
  job-searcher sources                  elenca le fonti disponibili

Opzioni di "profile new":
      --cv <file.pdf>      ricava le informazioni dal CV (poi si possono correggere)
      --name <nome>        nome del profilo
  -y, --yes                accetta tutte le proposte senza fare domande (richiede --cv)

Opzioni di ricerca:
  -p, --profile <nome>     profilo salvato (es. "redattore-padova") o percorso di un file JSON
  -k, --keywords <lista>   parole chiave separate da virgola (sostituiscono quelle del profilo)
  -x, --exclude <lista>    parole da escludere nel titolo (si aggiungono al profilo)
  -l, --place <luoghi>     cerca in una zona geografica, es. "Padova" o "Padova,Vicenza"
  -r, --radius <km>        raggio attorno al luogo (default 30)
      --country <codice>   paese per le API che lo richiedono (default "it")
      --remote             cerca anche offerte full remote
  -s, --sources <lista>    usa solo queste fonti, es. "linkedin,remotive"
      --max-age <giorni>   ignora offerte più vecchie (default 30)
  -f, --format <formato>   table (default), json, csv, html
  -o, --out <file>         scrive il risultato su file (il formato si deduce dall'estensione)
      --only-new           mostra solo le offerte non viste nelle esecuzioni precedenti
      --explain            elenca anche le offerte scartate e il motivo
      --limit <n>          massimo di offerte per target mostrate a terminale (default 50)
      --no-report          non generare il report HTML in reports/
  -h, --help

Esempi:
  job-searcher profile new --cv ~/Documenti/cv.pdf
  job-searcher search -p redattore-padova
  job-searcher search -k "redattore,editor" -l Padova -r 40 --remote
  job-searcher search -p redattore-padova --only-new -o offerte.csv

Le chiavi API opzionali (Adzuna, Jooble) si leggono da variabili d'ambiente o dal file .env.
`;

const list = (value) =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: 'string', short: 'p' },
      keywords: { type: 'string', short: 'k' },
      exclude: { type: 'string', short: 'x' },
      place: { type: 'string', short: 'l' },
      radius: { type: 'string', short: 'r' },
      country: { type: 'string' },
      remote: { type: 'boolean' },
      sources: { type: 'string', short: 's' },
      'max-age': { type: 'string' },
      format: { type: 'string', short: 'f' },
      out: { type: 'string', short: 'o' },
      'only-new': { type: 'boolean' },
      explain: { type: 'boolean' },
      limit: { type: 'string' },
      'no-report': { type: 'boolean' },
      cv: { type: 'string' },
      name: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const num = (v, name) => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} deve essere un numero positivo`);
    return n;
  };
  return {
    command: positionals[0] ?? 'search',
    args: positionals.slice(1),
    cv: values.cv,
    name: values.name,
    yes: values.yes,
    help: values.help,
    profile: values.profile,
    keywords: list(values.keywords),
    exclude: list(values.exclude),
    place: values.place,
    radiusKm: num(values.radius, 'radius'),
    country: values.country,
    remote: values.remote,
    sources: list(values.sources),
    maxAgeDays: num(values['max-age'], 'max-age'),
    format: values.format,
    out: values.out,
    onlyNew: values['only-new'],
    explain: values.explain,
    limit: num(values.limit, 'limit') ?? 50,
    report: !values['no-report'],
  };
}

function formatFor(opts) {
  if (opts.format) return opts.format;
  const ext = opts.out ? path.extname(opts.out).slice(1).toLowerCase() : '';
  return ['json', 'csv', 'html'].includes(ext) ? ext : 'table';
}

function render(format, results, title) {
  switch (format) {
    case 'json':
      return renderJson(results);
    case 'csv':
      return renderCsv(results);
    case 'html':
      return renderHtml(results, { title });
    case 'table':
      return renderTerminal(results);
    default:
      throw new Error(`Formato sconosciuto "${format}" (usa table, json, csv o html)`);
  }
}

function listSources() {
  console.log(c.bold('Fonti integrate:'));
  for (const s of builtinSources) {
    const missing = missingEnv(s);
    const status = missing.length
      ? c.yellow(`manca ${missing.join(', ')}`)
      : s.optIn
        ? c.yellow('da attivare con "enableSources"')
        : c.green('pronta');
    console.log(`  ${s.name.padEnd(16)} ${s.label.padEnd(18)} ${s.supports.join('+').padEnd(12)} ${status}`);
  }
  console.log(c.dim('\nAltre fonti (feed RSS o pagine HTML) si aggiungono con "customSources" nel profilo.'));
}

async function search(opts) {
  const base = opts.profile ? await loadProfile(opts.profile) : {};
  const profile = resolveProfile(applyOverrides(base, opts), { onlySources: opts.sources });

  const log = (msg) => process.stderr.write(`${msg}\n`);
  log(c.bold(`Ricerca "${profile.name}"`));
  const results = await runSearch(profile, {
    onProgress: (e) => {
      const where = `${e.target.label} · ${e.source.label}`;
      if (e.type === 'done') {
        if (!e.fetched) {
          log(c.yellow(`  ? ${where}: nessun risultato (se succede sempre, controlla chiave o servizio)`));
          return;
        }
        const why = formatReasons(e.reasons);
        log(c.dim(`  ✓ ${where}: ${e.kept} pertinenti su ${e.fetched}${why ? ` (scartate: ${why})` : ''}`));
      }
      if (e.type === 'skip') log(c.yellow(`  - ${where}: saltata (${e.reason})`));
      if (e.type === 'warn') log(c.yellow(`  ! ${where}: ${e.message}`));
      if (e.type === 'error') log(c.red(`  ✗ ${where}: ${e.error}`));
    },
  });

  const store = await SeenStore.forProfile(profile.name).load();
  for (const r of results) store.mark(r.jobs);
  await store.save();
  if (opts.onlyNew) for (const r of results) r.jobs = r.jobs.filter((j) => j.isNew);

  const format = formatFor(opts);
  const title = `Offerte: ${profile.name}`;
  if (opts.out) {
    await writeFile(opts.out, render(format === 'table' ? 'csv' : format, results, title));
    log(c.green(`Risultati salvati in ${opts.out}`));
  }
  if (format === 'table' || !opts.out) {
    console.log(format === 'table' ? renderTerminal(results, { limit: opts.limit }) : render(format, results, title));
  }
  if (opts.explain) log(renderRejected(results));
  if (opts.report && !(opts.out && format === 'html')) {
    await mkdir('reports', { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.join('reports', `${path.basename(store.file, '.json').replace(/^seen-/, '')}-${stamp}.html`);
    await writeFile(file, renderHtml(results, { title }));
    log(c.green(`Report HTML: ${file}`));
  }
}

async function listSavedProfiles() {
  const profiles = await listProfiles();
  if (!profiles.length) {
    console.log(`Nessun profilo in ${profilesDir()}/. Creane uno con "job-searcher profile new".`);
    return;
  }
  console.log(c.bold(`Profili in ${profilesDir()}/ (usa: job-searcher search -p <nome>)`));
  for (const p of profiles) {
    console.log(`  ${c.cyan(p.id.padEnd(28))} ${p.name ?? ''}`);
    const details = [p.description, describeTargets(p.targets)].filter(Boolean).join(' — ');
    if (details) console.log(c.dim(`  ${''.padEnd(28)} ${details}`));
  }
}

async function showProfile(name) {
  if (!name) throw new Error('Indica il profilo: job-searcher profile show <nome>');
  console.log(`${c.dim(profilePath(name))}\n${JSON.stringify(await loadProfile(name), null, 2)}`);
}

async function newProfile(opts) {
  if (opts.yes && !opts.cv) throw new Error('--yes richiede --cv: senza CV le risposte vanno date a mano');
  // Le righe si leggono in coda: così funziona anche passando le risposte da file (… < risposte.txt).
  const rl = opts.yes ? null : createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  const lines = rl?.[Symbol.asyncIterator]();
  const io = {
    async ask(question) {
      process.stdout.write(question);
      if (!lines) return (process.stdout.write('\n'), '');
      const { value, done } = await lines.next();
      if (done) throw new Error('risposte terminate prima della fine della procedura');
      if (!process.stdin.isTTY) process.stdout.write(`${value}\n`);
      return value;
    },
    print: (text) => console.log(text),
  };
  try {
    const result = await runWizard(io, { cv: opts.cv, name: opts.name });
    if (!result) return console.log('Profilo non salvato.');
    const file = await saveProfile(result.id, result.profile, { overwrite: true });
    console.log(c.green(`\nProfilo salvato in ${file}`));
    console.log(
      `Per cercare: ${c.bold(`job-searcher search -p ${result.id}`)}  (con npm: npm run search -- -p ${result.id})`,
    );
  } finally {
    rl?.close();
  }
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  if (opts.command === 'sources') return listSources();
  if (opts.command === 'search') return search(opts);
  if (opts.command === 'profiles') return listSavedProfiles();
  if (opts.command === 'profile') {
    const [sub, name] = opts.args;
    if (sub === 'new' || sub === 'nuovo') return newProfile(opts);
    if (sub === 'show') return showProfile(name);
    if (!sub || sub === 'list') return listSavedProfiles();
    throw new Error(`Sottocomando sconosciuto "profile ${sub}". Usa: profile new | show <nome> | list`);
  }
  throw new Error(`Comando sconosciuto "${opts.command}". Usa --help.`);
}

main().catch((err) => {
  console.error(c.red(`Errore: ${err.message}`));
  process.exitCode = 1;
});
