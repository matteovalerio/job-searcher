import { readFile, writeFile } from 'node:fs/promises';
import { c } from '../output/terminal.js';
import { checkPublisherSite, discoverPublishers } from '../publishers/discover.js';
import { buildPublishersPrompt, parsePublisherList } from '../publishers/import.js';
import { PUBLISHER_KINDS, specialtyLabel } from '../publishers/specialties.js';
import { needsFollowUp, PUBLISHER_STATUSES, Publishers } from '../publishers/store.js';

export const PUBLISHERS_HELP = `
Case editrici e studi editoriali (candidature spontanee):
  job-searcher publishers                     elenco, prima quelle da sollecitare (anche: "editori")
  job-searcher publishers find -l "Padova,Venezia" -r 40 [--add]
                                              cerca su OpenStreetMap, Wikidata e (con BRAVE_SEARCH_API_KEY) sul web;
                                              con --add le aggiunge all'elenco
  job-searcher publishers prompt -l "Padova,Venezia" -r 40 [-o file]
                                              testo per farsi elencare da Claude le case editrici della zona
  job-searcher publishers import [file]       aggiunge un elenco (risposta di Claude o una per riga: "Nome | sito | città")
                                              e ne controlla i siti
  job-searcher publishers add "Nome" [--site url] [--city Padova] [--kind studio-editoriale] [--email e] [--note "…"]
  job-searcher publishers check [id]          visita i siti: specializzazione, email, pagina "lavora con noi"
  job-searcher publishers <id> <stato> [--date 2026-09-29] [--note "…"]
                                              stati: ${Object.keys(PUBLISHER_STATUSES).join(', ')}
  job-searcher publishers clean               toglie le voci di Wikidata senza sito mai toccate (editori storici)
  job-searcher publishers <id>                scheda completa; "publishers <id> rimuovi" la toglie
`;

const describeStatus = (p) => {
  const parts = [PUBLISHER_STATUSES[p.status]];
  if (p.sentAt) parts.push(`inviata il ${p.sentAt}`);
  if (p.followUpAt)
    parts.push(needsFollowUp(p) ? c.yellow(`da sollecitare (dal ${p.followUpAt})`) : `sollecito il ${p.followUpAt}`);
  return parts.join(' · ');
};

function printItem(p, { full = false } = {}) {
  const where = [p.city, p.distanceKm != null ? `${p.distanceKm} km` : null].filter(Boolean).join(' ');
  const specs = p.specialties.map(specialtyLabel).join(', ');
  console.log(
    `${needsFollowUp(p) ? c.yellow('!') : ' '} ${c.dim(`[${p.id}]`)} ${c.bold(p.name)} ${c.dim(`(${PUBLISHER_KINDS[p.kind] ?? p.kind})`)}${where ? ` · ${where}` : ''}${specs ? ` · ${specs}` : ''}`,
  );
  console.log(`    ${describeStatus(p)}`);
  const links = [p.careersUrl && `lavora con noi: ${p.careersUrl}`, p.email, !p.careersUrl && p.website].filter(
    Boolean,
  );
  if (links.length) console.log(c.dim(`    ${links.join(' · ')}`));
  if (full) {
    for (const [label, value] of [
      ['Sito', p.website],
      ['Indirizzo', p.address],
      ['Telefono', p.phone],
      ['Descrizione', p.description],
      ['Contatto', p.contact],
      ['Canale', p.channel],
      ['Note', p.note],
      ['Trovata con', p.source],
      ['Sito controllato', p.checkedAt && `${p.checkedAt.slice(0, 10)}${p.checkProblem ? ` (${p.checkProblem})` : ''}`],
    ])
      if (value) console.log(`    ${label}: ${value}`);
    console.log(
      `    Cronologia: ${p.history.map((h) => `${PUBLISHER_STATUSES[h.status]} ${h.at.slice(0, 10)}`).join(' → ')}`,
    );
  } else if (p.note) {
    console.log(c.dim(`    nota: ${p.note}`));
  }
}

async function find(opts, store) {
  if (!opts.place) throw new Error('Indica la città attorno a cui cercare: publishers find -l Padova -r 40');
  const radiusKm = opts.radiusKm ?? 30;
  console.error(c.dim(`Cerco case editrici e studi editoriali entro ${radiusKm} km da ${opts.place}…`));
  const { results, problems, webSearch } = await discoverPublishers({ place: opts.place, radiusKm });
  for (const p of problems) console.error(c.yellow(`! ${p}`));
  if (!webSearch) {
    console.error(
      c.dim(
        'Mappe e Wikidata non conoscono molti piccoli editori. Per trovarne di più: la ricerca web (chiave gratuita\n' +
          'BRAVE_SEARCH_API_KEY, vedi README) oppure "publishers prompt" per farsi aiutare da Claude.',
      ),
    );
  }
  const fresh = results.filter((r) => !store.has(r));
  console.log(`${results.length} trovate, ${fresh.length} non ancora nell'elenco.\n`);
  for (const r of results) {
    const known = store.has(r);
    const details = [
      [r.city, r.distanceKm != null && `${r.distanceKm} km`].filter(Boolean).join(' '),
      r.specialties?.map(specialtyLabel).join(', '),
    ].filter(Boolean);
    console.log(
      `${known ? c.dim('=') : c.green('+')} ${r.name} ${c.dim(`(${PUBLISHER_KINDS[r.kind]})`)}${details.map((d) => ` · ${d}`).join('')}`,
    );
    if (r.website || r.email) console.log(c.dim(`    ${[r.website, r.email].filter(Boolean).join(' · ')}`));
  }
  if (!fresh.length) return;
  if (!opts.add) {
    console.log(
      `\nPer aggiungerle all'elenco: ${c.bold(`job-searcher publishers find -l "${opts.place}" -r ${radiusKm} --add`)}`,
    );
    return;
  }
  for (const r of fresh) store.add(r);
  await store.save();
  console.log(c.green(`\nAggiunte ${fresh.length} (stato "da valutare").`));
  console.log(
    `Per visitarne i siti (specializzazione, email, "lavora con noi"): ${c.bold('job-searcher publishers check')}`,
  );
}

async function prompt(opts, store) {
  if (!opts.place) throw new Error('Indica la zona: publishers prompt -l "Padova,Venezia" -r 40');
  const text = buildPublishersPrompt({
    places: opts.place.split(',').map((p) => p.trim()),
    radiusKm: opts.radiusKm ?? 30,
    known: store.items.map((p) => p.name),
  });
  const next = [
    '1. Incolla il testo in una nuova chat su claude.ai.',
    '2. Copia la risposta (con il blocco ```json) in un file, es. editori.txt, ed esegui:',
    '     job-searcher publishers import editori.txt',
    '   oppure esegui "job-searcher publishers import" e incollala nel terminale.',
    '   Ogni sito viene visitato: le case editrici inventate o chiuse si riconoscono subito.',
  ].join('\n');
  if (opts.out) {
    await writeFile(opts.out, text);
    console.log(c.green(`Testo salvato in ${opts.out}`));
    console.log(next);
  } else {
    console.log(text);
    console.error(c.dim(`\n${'-'.repeat(60)}\n${next}`));
  }
}

async function readInput(file) {
  if (file) return readFile(file, 'utf8');
  if (process.stdin.isTTY) console.error("Incolla l'elenco o la risposta di Claude, poi premi Invio e Ctrl+D:");
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

async function importList(file, store) {
  const list = parsePublisherList(await readInput(file));
  if (!list.length) throw new Error('Nel testo non ho trovato nessuna casa editrice.');
  const added = list.map((p) => store.add(p)).filter(Boolean);
  await store.save();
  console.log(`${list.length} nel testo, ${added.length} nuove, ${list.length - added.length} già nell'elenco.`);
  for (const p of added) {
    const found = await checkPublisherSite(p);
    store.enrich(p.id, found);
    await store.save();
    const verdict = !p.website
      ? c.yellow('senza sito: da verificare a mano')
      : found.problem
        ? c.yellow(`sito non raggiungibile (${found.problem}): forse non esiste più`)
        : c.green(
            ['sito ok', found.specialties?.length && found.specialties.map(specialtyLabel).join(', '), found.email]
              .filter(Boolean)
              .join(' · '),
          );
    console.log(`  ${p.name}: ${verdict}`);
  }
}

async function check(ref, store) {
  const targets = ref ? [store.find(ref)] : store.items.filter((p) => !p.checkedAt && p.website);
  if (ref && !targets[0]) throw new Error(`Casa editrice "${ref}" non trovata.`);
  if (!targets.length) return console.log('Nessun sito da controllare (sono già stati controllati tutti).');
  for (const p of targets) {
    const found = await checkPublisherSite(p);
    store.enrich(p.id, found);
    await store.save();
    const what = found.problem
      ? c.yellow(`non raggiungibile (${found.problem})`)
      : [
          found.specialties?.length && found.specialties.map(specialtyLabel).join(', '),
          found.email,
          found.careersUrl ? 'lavora con noi ✓' : 'nessuna pagina "lavora con noi"',
        ]
          .filter(Boolean)
          .join(' · ');
    console.log(`${p.name}: ${what}`);
  }
}

export async function publishersCommand(opts) {
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error('--date va scritta come 2026-09-29');
  const store = await new Publishers().load();
  const [first, second] = opts.args;
  if (!first || first === 'list') {
    const items = store.list({ status: opts.status });
    if (!items.length) {
      console.log('Nessuna casa editrice. Cercale con "publishers find -l <città>" o aggiungile con "publishers add".');
      return;
    }
    for (const p of items) printItem(p);
    const due = items.filter((p) => needsFollowUp(p)).length;
    if (due) console.log(c.yellow(`\n${due} candidature da sollecitare (segnate con !).`));
    return;
  }
  if (first === 'find' || first === 'cerca') return find(opts, store);
  if (first === 'check' || first === 'controlla') return check(second, store);
  if (first === 'prompt') return prompt(opts, store);
  if (first === 'clean' || first === 'pulisci') {
    const stale = store.staleFromWikidata();
    for (const p of stale) store.remove(p.id);
    await store.save();
    console.log(stale.length ? `Tolte ${stale.length}: ${stale.map((p) => p.name).join(', ')}` : 'Niente da togliere.');
    return;
  }
  if (first === 'import' || first === 'importa') return importList(second, store);
  if (first === 'add' || first === 'aggiungi') {
    if (opts.kind && !PUBLISHER_KINDS[opts.kind]) {
      throw new Error(`Tipo sconosciuto "${opts.kind}". Tipi: ${Object.keys(PUBLISHER_KINDS).join(', ')}`);
    }
    const p = store.add({
      name: second ?? opts.name,
      website: opts.site,
      city: opts.city,
      kind: opts.kind,
      email: opts.email,
      note: opts.note,
    });
    if (!p) throw new Error("È già nell'elenco (stesso sito o stesso nome).");
    if (p.website) store.enrich(p.id, await checkPublisherSite(p));
    await store.save();
    console.log(c.green(`Aggiunta: ${p.name} [${p.id}]`));
    printItem(p);
    return;
  }
  const p = store.find(first);
  if (!p) throw new Error(`Casa editrice "${first}" non trovata. L'id è quello tra [ ] nell'elenco.`);
  if (!second && opts.note === undefined && !opts.date) return printItem(p, { full: true });
  if (second === 'rimuovi' || second === 'remove') {
    store.remove(p.id);
    await store.save();
    return console.log(`Tolta dall'elenco: ${p.name}`);
  }
  store.update(p.id, {
    ...(second ? { status: second } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
    ...(opts.date ? { sentAt: opts.date } : {}),
  });
  await store.save();
  printItem(p);
}
