#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { applyOverrides, loadProfile, resolveProfile } from './config.js';
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
  job-searcher search [opzioni]     esegue la ricerca (comando predefinito)
  job-searcher sources              elenca le fonti disponibili

Opzioni di ricerca:
  -p, --profile <file>     profilo JSON con parole chiave, target e fonti (vedi profiles/)
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
  job-searcher search -p profiles/redattore-padova.json
  job-searcher search -k "redattore,editor" -l Padova -r 40 --remote
  job-searcher search -p profiles/redattore-padova.json --only-new -o offerte.csv

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

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  if (opts.command === 'sources') return listSources();
  if (opts.command === 'search') return search(opts);
  throw new Error(`Comando sconosciuto "${opts.command}". Usa --help.`);
}

main().catch((err) => {
  console.error(c.red(`Errore: ${err.message}`));
  process.exitCode = 1;
});
