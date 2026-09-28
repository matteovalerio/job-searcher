import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Archivio dei profili di ricerca: file JSON nella cartella profiles/ (o in JOB_SEARCHER_PROFILES).
 * Un profilo si indica per nome ("redattore-padova") oppure con il percorso di un file.
 */

export const profilesDir = () => process.env.JOB_SEARCHER_PROFILES || 'profiles';

/** "Redattrice Padova!" -> "redattrice-padova" */
export function slugify(name) {
  return (
    String(name ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'profilo'
  );
}

/** Percorso del file di un profilo, dato il nome o un percorso. */
export function profilePath(nameOrPath) {
  if (existsSync(nameOrPath) && nameOrPath.endsWith('.json')) return nameOrPath;
  return path.join(profilesDir(), `${slugify(path.basename(nameOrPath, '.json'))}.json`);
}

/** Elenco dei profili salvati: { id, file, name, description, targets }. */
export async function listProfiles() {
  let files;
  try {
    files = (await readdir(profilesDir())).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const file of files) {
    const full = path.join(profilesDir(), file);
    try {
      const p = JSON.parse(await readFile(full, 'utf8'));
      out.push({
        id: path.basename(file, '.json'),
        file: full,
        name: p.name,
        description: p.description,
        targets: p.targets ?? [],
      });
    } catch {
      out.push({ id: path.basename(file, '.json'), file: full, name: '(file non valido)', targets: [] });
    }
  }
  return out;
}

export async function loadProfile(nameOrPath) {
  const file = profilePath(nameOrPath);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Impossibile leggere il profilo "${file}": ${err.message}`);
    const available = (await listProfiles()).map((p) => p.id);
    throw new Error(
      `Profilo "${nameOrPath}" non trovato.` +
        (available.length
          ? ` Profili disponibili: ${available.join(', ')}`
          : ' Creane uno con "job-searcher profile new".'),
    );
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Il profilo "${file}" non è JSON valido: ${err.message}`);
  }
}

/**
 * Salva un profilo come profiles/<id>.json.
 * @returns {Promise<string>} percorso del file
 */
export async function saveProfile(id, profile, { overwrite = false } = {}) {
  const file = path.join(profilesDir(), `${slugify(id)}.json`);
  if (!overwrite && existsSync(file)) throw new Error(`Esiste già un profilo "${slugify(id)}"`);
  await mkdir(profilesDir(), { recursive: true });
  await writeFile(file, `${JSON.stringify(profile, null, 2)}\n`);
  return file;
}

/** Breve descrizione dei target di un profilo, es. "Padova, Vicenza (+35 km) · full remote". */
export function describeTargets(targets = []) {
  return targets
    .map((t) =>
      t.type === 'remote'
        ? 'full remote'
        : `${(t.places ?? [t.place]).filter(Boolean).join(', ')} (+${t.radiusKm ?? 30} km)`,
    )
    .join(' · ');
}
