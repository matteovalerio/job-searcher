import { core } from '../../../lib/core.js';

/** Preparazione al colloquio di un'offerta che ha già il kit: domande, azienda, ringraziamento, prompt. */
export async function interviewData(ref) {
  const c = await core();
  const { tracking, kits } = await c.loadTrackingAndKits();
  const kit = kits.find(ref);
  if (!kit) return { error: 'Prepara prima il kit di candidatura', status: 400 };
  const item = tracking.get(kit.job.id);
  const cvText = (await c.loadCvText()) ?? '';
  // La fascia di RAL degli annunci del profilo da cui viene l'offerta (pagina Mercato), se c'è.
  let salary = null;
  const profileId = await c.profileOfJob(kit.job.id);
  if (profileId) {
    const history = await c.loadHistory(profileId);
    salary = c.analyzeMarket(Object.values(history.jobs)).salary;
  }
  const interview = item?.interview ?? null;
  return {
    kit,
    item: item ?? null,
    prep: c.buildInterviewPrep(kit, { salary, contacts: c.cvContacts(cvText), interview }),
    prompt: c.buildInterviewPrompt(kit, cvText, { interview }),
  };
}
