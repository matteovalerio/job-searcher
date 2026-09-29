import path from 'node:path';
import { applyOverrides, loadProfile, resolveProfile } from './config.js';
import { notify } from './notify.js';
import { slugify } from './profiles/store.js';
import { runSearch } from './search.js';
import { SeenStore } from './store.js';
import { saveLastResults, Tracking } from './tracking.js';

/*
 * Il percorso completo di una ricerca, uguale per la riga di comando e per l'interfaccia web:
 * profilo -> ricerca sulle fonti -> offerte nuove -> candidature -> notifica -> salvataggio dei risultati.
 */

/**
 * @param {object} options
 * @param {string} [options.profile]     nome o percorso del profilo
 * @param {object} [options.overrides]   opzioni che modificano il profilo (parole chiave, luogo, remoto…)
 * @param {string[]} [options.onlySources]
 * @param {boolean} [options.noBrowser]
 * @param {boolean} [options.notify]      manda le offerte nuove sui canali configurati
 * @param {(event: object) => void} [options.onProgress]
 * @returns {Promise<{ profile, profileId, results, hidden, notification, firstRun }>}
 */
export async function searchProfile({
  profile: profileRef,
  overrides = {},
  onlySources,
  noBrowser = false,
  notify: sendNotification = false,
  onProgress = () => {},
} = {}) {
  const base = profileRef ? await loadProfile(profileRef) : {};
  const profile = resolveProfile(applyOverrides(base, overrides), { onlySources, noBrowser });
  const profileId = profileRef ? slugify(path.basename(profileRef, '.json')) : 'ricerca';

  onProgress({ type: 'begin', profile, profileId });
  const results = await runSearch(profile, { onProgress });

  // Offerte scartate o non selezionate spariscono; le altre seguite portano il loro stato.
  const tracking = await new Tracking().load();
  const hidden = tracking.annotate(results);

  const store = await SeenStore.forProfile(profile.name).load();
  for (const r of results) store.mark(r.jobs);

  let notification = null;
  let saveSeen = true;
  if (sendNotification) {
    notification = await notify(results, {
      profileName: profile.name,
      firstRun: store.firstRun,
      reportUrl: process.env.JOB_SEARCHER_REPORT_URL,
    });
    // Se nessun canale ha ricevuto il messaggio, le offerte non vengono segnate come viste: arriveranno la prossima volta.
    if (notification.errors.length && !notification.sent.length) saveSeen = false;
  }
  if (saveSeen) await store.save();
  await saveLastResults(profileId, results, { name: profile.name });

  return { profile, profileId, results, hidden, notification, firstRun: store.firstRun, seenFile: store.file };
}
