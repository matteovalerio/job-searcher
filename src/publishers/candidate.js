import { loadCvText } from '../tailor.js';

/**
 * Chi è il candidato, per scegliere i settori affini: descrizione e parole chiave del profilo, più il CV
 * salvato (se c'è).
 * @param {object|null} profile
 * @returns {Promise<{ text: string, cv: string|null }>}
 */
export async function candidateText(profile) {
  const cv = await loadCvText();
  return {
    text: [profile?.description, profile?.keywords?.join(', '), cv].filter(Boolean).join('\n'),
    cv,
  };
}
