import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Testo per claude.ai per preparare la visita a un evento. Corpo: { id } */
export async function POST(request) {
  const { id } = await request.json().catch(() => ({}));
  const { upcomingEvents, buildEventPrompt, loadCvText, Publishers } = await core();
  const event = upcomingEvents().find((e) => e.id === id);
  if (!event) return Response.json({ error: 'Evento non trovato' }, { status: 404 });
  const [cvText, publishers] = await Promise.all([loadCvText(), new Publishers().load()]);
  return Response.json({ prompt: buildEventPrompt(event, { cvText: cvText ?? '', publishers: publishers.items }) });
}
