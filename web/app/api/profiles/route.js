import { existsSync } from 'node:fs';
import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/**
 * Crea un profilo.
 *   { mode: "form", answers, overwrite? }   dalle risposte del modulo guidato (stesse della procedura "profile new")
 *   { mode: "import", text, name?, overwrite? }  dalla risposta di Claude (con il blocco ```json)
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const {
    buildProfile,
    describeCandidate,
    suggestFilters,
    extractJson,
    checkImported,
    saveProfile,
    profilePath,
    slugify,
  } = await core();
  try {
    let profile;
    if (body.mode === 'import') {
      profile = checkImported(extractJson(body.text ?? ''));
    } else {
      const a = body.answers ?? {};
      if (!a.name?.trim()) throw new Error('Dai un nome al profilo');
      const candidate = { years: Number(a.years) || 0, areas: a.areaLabels ?? [], ...(a.candidate ?? {}) };
      profile = checkImported(
        buildProfile({
          ...a,
          name: a.name.trim(),
          description: describeCandidate(candidate),
          radiusKm: Number(a.radiusKm) || 30,
          maxAgeDays: Number(a.maxAgeDays) || 30,
          candidate,
          filters: suggestFilters(candidate.years),
        }),
      );
    }
    const id = slugify(body.name || profile.name);
    if (existsSync(profilePath(id)) && !body.overwrite) {
      return Response.json({ error: `Esiste già un profilo "${id}"`, exists: true, id }, { status: 409 });
    }
    await saveProfile(id, profile, { overwrite: true });
    return Response.json({ id, profile });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
