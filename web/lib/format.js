/* Formattazione condivisa dalle pagine (funziona sia sul server sia nel browser). */

const DAY = 24 * 60 * 60 * 1000;

/** "oggi", "ieri", "3 giorni fa", "2 settimane fa", altrimenti la data. */
export function relativeDay(iso, now = Date.now()) {
  if (!iso) return null;
  const date = new Date(iso);
  const days = Math.floor((now - date.getTime()) / DAY);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 7) return `${days} giorni fa`;
  if (days < 14) return '1 settimana fa';
  if (days < 35) return `${Math.floor(days / 7)} settimane fa`;
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const shortDate = (iso) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

/** Fascia del punteggio: una parola chiave nel titolo vale 10 punti. */
export const scoreTier = (score) => (score >= 20 ? 'hi' : score >= 10 ? 'mid' : 'lo');
