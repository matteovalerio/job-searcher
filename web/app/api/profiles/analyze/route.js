import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/**
 * Analizza un CV in PDF e propone i valori del profilo. Corpo: form con il campo "cv".
 * Il CV non viene salvato: si usa solo per le proposte (e il testo torna alla pagina per il prompt di Claude).
 */
export async function POST(request) {
  const { readCvData, analyzeCv, detectedFamilies, suggest, saveCvText } = await core();
  try {
    const form = await request.formData();
    const file = form.get('cv');
    if (!file || typeof file === 'string') throw new Error('Nessun file ricevuto');
    if (file.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB)');
    const cvText = await readCvData(new Uint8Array(await file.arrayBuffer()), `"${file.name}"`);
    const analysis = analyzeCv(cvText);
    // Si ricorda il CV (sul computer) anche per il «CV su misura».
    await saveCvText(cvText);
    const families = detectedFamilies(analysis);
    return Response.json({
      cvText,
      analysis: {
        families: analysis.families.map(({ id, label, score }) => ({ id, label, score })),
        years: analysis.years,
        education: analysis.education,
        languages: analysis.languages,
        skills: analysis.skills,
        city: analysis.city?.name ?? null,
      },
      families,
      suggestion: suggest(families, analysis),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
