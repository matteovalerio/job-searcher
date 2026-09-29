import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** C'è un CV salvato? */
export async function GET() {
  const { cvInfo } = await core();
  return Response.json(await cvInfo());
}

/** Salva il testo del CV (resta sul computer). formData: cv = PDF */
export async function POST(request) {
  const { readCvData, saveCvText, cvInfo } = await core();
  try {
    const file = (await request.formData()).get('cv');
    if (!file || typeof file === 'string') throw new Error('Nessun file ricevuto');
    if (file.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB)');
    await saveCvText(await readCvData(new Uint8Array(await file.arrayBuffer()), `"${file.name}"`));
    return Response.json(await cvInfo());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
