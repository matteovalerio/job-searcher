import { core } from '../../../lib/core.js';

export const dynamic = 'force-dynamic';

// Una ricerca alla volta: le fonti con il browser condividono lo stesso profilo di Chrome.
let running = null;

/** Evento di avanzamento ridotto a ciò che serve alla pagina. */
function toEvent(e) {
  switch (e.type) {
    case 'begin':
      return { type: 'begin', profile: e.profile.name };
    case 'done':
      return {
        type: 'done',
        target: e.target.label,
        source: e.source.label,
        fetched: e.fetched,
        kept: e.kept,
        reasons: e.reasons,
      };
    case 'skip':
      return { type: 'skip', target: e.target.label, source: e.source.label, message: e.reason };
    case 'warn':
      return { type: 'warn', target: e.target.label, source: e.source.label, message: e.message };
    case 'error':
      return { type: 'error', target: e.target.label, source: e.source.label, message: e.error };
    case 'start':
      return { type: 'start', target: e.target.label, source: e.source.label };
    default:
      return null;
  }
}

/**
 * Avvia una ricerca e ne trasmette l'avanzamento riga per riga (NDJSON), così la pagina lo mostra
 * mentre le fonti rispondono. Corpo: { profile, noBrowser }.
 */
export async function POST(request) {
  const { profile, noBrowser = false } = await request.json().catch(() => ({}));
  if (!profile) return Response.json({ error: 'Manca il profilo' }, { status: 400 });
  if (running) return Response.json({ error: `C'è già una ricerca in corso (${running})` }, { status: 409 });

  running = profile;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => obj && controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const { searchProfile } = await core();
        const result = await searchProfile({ profile, noBrowser, onProgress: (e) => send(toEvent(e)) });
        send({
          type: 'finished',
          hidden: result.hidden,
          total: result.results.reduce((n, r) => n + r.jobs.length, 0),
          fresh: result.results.reduce((n, r) => n + r.jobs.filter((j) => j.isNew).length, 0),
        });
      } catch (err) {
        send({ type: 'failed', message: err.message });
      } finally {
        running = null;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
