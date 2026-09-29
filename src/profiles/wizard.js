import { existsSync } from 'node:fs';
import { findComune } from '../geo.js';
import { normalize } from '../text.js';
import {
  REMOTE_SCOPES,
  buildProfile,
  describeCandidate,
  detectedFamilies,
  suggest,
  suggestFilters,
} from './builder.js';
import { analyzeCv, readCvText } from './cv.js';
import { ROLE_FAMILIES } from './roles.js';
import { profilePath, slugify } from './store.js';

/**
 * Modifica di una lista: invio = conferma; "+a, -b" aggiunge/toglie; "-" svuota; altrimenti sostituisce.
 */
export function editList(current, input) {
  const answer = input.trim();
  if (!answer) return current;
  if (answer === '-') return [];
  const tokens = answer
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.every((t) => /^[+-]/.test(t))) return tokens;
  let list = [...current];
  for (const token of tokens) {
    const word = token.slice(1).trim();
    if (token.startsWith('+')) {
      if (!list.some((w) => normalize(w) === normalize(word))) list.push(word);
    } else {
      list = list.filter((w) => normalize(w) !== normalize(word));
    }
  }
  return list;
}

/** Scelta di numeri da un elenco: "1, 3" -> [indici]; invio = predefiniti. */
export function parseChoices(input, count, defaults) {
  if (!input.trim()) return defaults;
  const picked = input
    .split(/[,\s]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= count)
    .map((n) => n - 1);
  return [...new Set(picked)];
}

const wrap = (list) => (list.length ? list.join(', ') : '(nessuna)');

/**
 * Procedura guidata per creare un profilo. `io` fornisce ask(domanda) -> risposta e print(testo),
 * così la stessa procedura funziona nel terminale e nei test.
 *
 * @param {{ ask: (q: string) => Promise<string>, print: (s: string) => void }} io
 * @param {{ cv?: string, name?: string, now?: Date }} [options]
 * @returns {Promise<{ id: string, profile: object } | null>} null se l'utente annulla
 */
export async function runWizard(io, { cv, name, now = new Date() } = {}) {
  const { print } = io;
  const ask = async (question, def = '') => {
    const hint = def === '' ? '' : ` [${def}]`;
    return (await io.ask(`${question}${hint}: `)).trim();
  };
  const askNumber = async (question, def) => {
    for (;;) {
      const answer = await ask(question, def);
      if (!answer) return def;
      const n = Number(answer.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) return n;
      print('  Scrivi un numero.');
    }
  };
  const askYesNo = async (question, def) => {
    const answer = normalize(await ask(`${question} (s/n)`, def ? 's' : 'n'));
    return answer ? /^(s|si|y|yes)/.test(answer) : def;
  };
  const askList = async (question, current) => {
    print(`\n${question}\n  ${wrap(current)}`);
    return editList(
      current,
      await ask('  Invio per confermare, "+parola" aggiunge, "-parola" toglie, oppure scrivi una nuova lista'),
    );
  };

  print('Creazione di un profilo di ricerca\n');

  // 1. CV
  let analysis = null;
  const cvPath = cv ?? (await ask('CV in PDF (percorso del file, invio per saltare)'));
  if (cvPath) {
    const text = await readCvText(cvPath);
    analysis = analyzeCv(text, { now });
    print('\nDal CV ho ricavato:');
    print(`  aree professionali: ${analysis.families.map((f) => f.label).join(', ') || 'nessuna riconosciuta'}`);
    print(`  esperienza: circa ${analysis.years} anni`);
    if (analysis.education.length) {
      print(`  studi: ${analysis.education.map((e) => (e.field ? `${e.level} in ${e.field}` : e.level)).join(', ')}`);
    }
    print(
      `  lingue: ${analysis.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ') || '-'}`,
    );
    if (analysis.skills.length) print(`  competenze: ${analysis.skills.join(', ')}`);
    if (analysis.city) print(`  città: ${analysis.city.name}`);
    print('Ora puoi confermare o correggere ogni punto.');
  }

  // 2. Aree professionali
  print('\nAree professionali:');
  ROLE_FAMILIES.forEach((f, i) => print(`  ${String(i + 1).padStart(2)}. ${f.label}`));
  const detected = detectedFamilies(analysis).map((id) => ROLE_FAMILIES.findIndex((r) => r.id === id));
  let families = [];
  while (!families.length) {
    const answer = await ask('Quali cerchi? (numeri separati da virgola)', detected.map((i) => i + 1).join(', '));
    families = parseChoices(answer, ROLE_FAMILIES.length, detected);
    if (!families.length) print("  Scegli almeno un'area.");
  }
  const familyIds = families.map((i) => ROLE_FAMILIES[i].id);

  // 3. Esperienza e liste di parole
  const years = await askNumber('\nAnni di esperienza nel ruolo', analysis?.years ?? 0);
  const s = suggest(familyIds, { years, skills: analysis?.skills, languages: analysis?.languages });
  const keywords = await askList(
    "Parole chiave dei ruoli cercati (devono comparire nel titolo dell'offerta):",
    s.keywords,
  );
  const related = await askList("Ruoli affini (tengono l'offerta ma con meno punti):", s.related);
  const exclude = await askList("Parole che, nel titolo, fanno scartare un'offerta:", s.exclude);
  const boost = await askList('Settori, aziende e competenze che alzano il punteggio:', s.boost);
  const languages = await askList(
    'Lingue conosciute (le offerte che ne chiedono altre vengono scartate):',
    s.languages,
  );

  // 4. Dove
  let places = [];
  for (;;) {
    const answer = await ask(
      '\nCittà in cui cercare, separate da virgola ("-" per nessuna, solo remoto)',
      analysis?.city?.name ?? '',
    );
    if (answer === '-' || (!answer && !analysis?.city)) break;
    const names = (answer || analysis.city.name)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const unknown = names.filter((n) => !findComune(n));
    if (!unknown.length) {
      places = names.map((n) => findComune(n).name);
      break;
    }
    print(`  Comune non trovato: ${unknown.join(', ')}. Controlla il nome.`);
  }
  const radiusKm = places.length ? await askNumber('Raggio in km', 30) : 30;

  const scopes = Object.entries(REMOTE_SCOPES);
  print('\nOfferte full remote:\n   1. no');
  scopes.forEach(([, v], i) => print(`   ${i + 2}. sì, ${v.label}`));
  const remoteChoice = parseChoices(await ask('Scelta', places.length ? 3 : 4), scopes.length + 1, [
    places.length ? 2 : 3,
  ])[0];
  const remote = remoteChoice === 0 || remoteChoice === undefined ? 'no' : scopes[remoteChoice - 1][0];

  const maxAgeDays = await askNumber('\nOfferte pubblicate negli ultimi quanti giorni', 30);
  const browserSources = await askYesNo(
    "Cercare anche su Indeed e InfoJobs? Si apre Chrome; i loro termini d'uso non consentono la lettura automatica",
    false,
  );

  // 5. Nome e salvataggio
  const areas = familyIds.map((id) => ROLE_FAMILIES.find((f) => f.id === id).label);
  const defaultName = name ?? [areas[0], places[0] ?? 'remoto'].join(' - ');
  const profileName = (await ask('\nNome del profilo', defaultName)) || defaultName;
  let id = slugify(profileName);

  const candidate = {
    years,
    areas,
    ...(analysis?.education?.length ? { education: analysis.education } : {}),
    ...(analysis?.skills?.length ? { skills: analysis.skills } : {}),
  };
  const profile = buildProfile({
    name: profileName,
    description: describeCandidate(candidate),
    keywords,
    related,
    exclude,
    boost,
    languages,
    searchArea: s.searchArea,
    searchRemote: s.searchRemote,
    places,
    radiusKm,
    remote,
    maxAgeDays,
    browserSources,
    candidate,
    filters: suggestFilters(years),
  });

  print(`\nRiepilogo di "${profileName}"`);
  print(`  ${profile.description}`);
  for (const t of profile.targets) {
    print(`  ${t.label}: cerca ${wrap(t.searchKeywords)}`);
  }
  print(`  parole chiave: ${wrap(profile.keywords)}`);
  print(`  esclusioni: ${wrap(profile.excludeKeywords)}`);

  if (!(await askYesNo('Salvare il profilo?', true))) return null;
  while (existsSync(profilePath(id))) {
    if (await askYesNo(`Esiste già il profilo "${id}". Sovrascriverlo?`, false)) break;
    id = slugify((await ask('Nuovo nome del profilo')) || `${id}-2`);
  }
  return { id, profile };
}
