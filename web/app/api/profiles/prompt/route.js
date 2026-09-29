import { core } from '../../../../lib/core.js';

export const dynamic = 'force-dynamic';

/** Prompt per far scrivere il profilo a Claude su claude.ai. Corpo: { cvText? } */
export async function POST(request) {
  const { cvText = '' } = await request.json().catch(() => ({}));
  const { buildPrompt } = await core();
  return Response.json({ prompt: buildPrompt({ cvText }) });
}
