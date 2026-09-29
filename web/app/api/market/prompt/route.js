import { core } from '../../../../lib/core.js';
import { marketForActiveProfile } from '../../../../lib/market.js';

export const dynamic = 'force-dynamic';

/** Testo per claude.ai: piano personale per colmare le lacune del profilo attivo. */
export async function POST() {
  const { buildMarketPrompt } = await core();
  const market = await marketForActiveProfile();
  if (!market?.analysis.total) return Response.json({ error: 'Nessuna offerta da analizzare' }, { status: 400 });
  return Response.json({
    prompt: buildMarketPrompt({ analysis: market.analysis, cvText: market.cvText, profileName: market.name }),
  });
}
