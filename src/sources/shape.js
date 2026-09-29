/**
 * Controlla che la risposta di un servizio contenga la lista attesa. Serve a distinguere "nessuna offerta"
 * (lista vuota) da "il servizio ha cambiato formato" (lista assente), che altrimenti sembrano uguali.
 * @param {unknown} data risposta già convertita da JSON
 * @param {string[]} keys nomi possibili della lista ("" = la risposta stessa è la lista)
 */
export function expectList(data, keys) {
  for (const key of keys) {
    const value = key === '' ? data : data?.[key];
    if (Array.isArray(value)) return data;
  }
  const found =
    data && typeof data === 'object'
      ? `campi presenti: ${Object.keys(data).slice(0, 10).join(', ') || 'nessuno'}`
      : `ricevuto ${typeof data}`;
  const message = typeof data?.message === 'string' ? ` Messaggio del servizio: "${data.message.slice(0, 200)}".` : '';
  throw new Error(
    `risposta in un formato inatteso (manca "${keys.filter(Boolean).join('" o "') || 'lista'}"; ${found}).${message}`,
  );
}
