import { writeFile } from 'node:fs/promises';
import { associations, buildEventPrompt, EVENTS, reminderIcs, upcomingEvents } from '../events.js';
import { c } from '../output/terminal.js';
import { loadProfile } from '../profiles/store.js';
import { Publishers } from '../publishers/store.js';
import { loadCvText } from '../tailor.js';

export const EVENTS_HELP = `
Fiere, festival e associazioni del settore:
  job-searcher eventi [-p profilo]              i prossimi eventi (in zona e pertinenti prima) e le associazioni
  job-searcher eventi prepara <id> [-o file]    testo per claude.ai per preparare la visita
  job-searcher eventi promemoria <id> [-o file.ics]   promemoria da aggiungere al calendario
`;

async function profileInfo(ref) {
  if (!ref) return { profileText: '', home: null };
  const p = await loadProfile(ref);
  return {
    profileText: [p.name, p.description, ...(p.keywords ?? []), ...(p.candidate?.areas ?? [])].join(' '),
    home: p.targets?.find((t) => t.type === 'area')?.places?.[0] ?? null,
  };
}

export async function eventsCommand(opts) {
  const [action, id] = opts.args;
  const info = await profileInfo(opts.profile);
  if (action === 'prepara' || action === 'promemoria') {
    const event = upcomingEvents(info).find((e) => e.id === id);
    if (!event) throw new Error(`Evento "${id}" sconosciuto. Eventi: ${EVENTS.map((e) => e.id).join(', ')}`);
    const text =
      action === 'prepara'
        ? buildEventPrompt(event, {
            cvText: (await loadCvText()) ?? '',
            publishers: (await new Publishers().load()).items,
          })
        : reminderIcs(event);
    if (opts.out) {
      await writeFile(opts.out, text);
      return console.error(`Salvato in ${opts.out}.`);
    }
    return console.log(text);
  }
  let month = null;
  for (const e of upcomingEvents(info)) {
    const label = e.monthsAway === 0 ? 'Questo mese (controlla se è già passato)' : `${e.when} ${e.nextYear}`;
    if (e.monthsAway !== month) {
      month = e.monthsAway;
      console.log(
        `\n${c.bold(c.cyan(e.monthsAway === 0 ? label : `Tra ${e.monthsAway} ${e.monthsAway === 1 ? 'mese' : 'mesi'}`))}`,
      );
    }
    console.log(
      `  ${c.bold(e.name)} ${c.dim(`[${e.id}]`)} · ${e.city}${e.distanceKm != null ? ` (${e.distanceKm} km)` : ''} · di solito a ${e.when}`,
    );
    console.log(c.dim(`    ${e.about}${e.site ? ` · ${e.site}` : ''}`));
  }
  console.log(`\n${c.bold('Associazioni')}`);
  for (const a of associations(info.profileText))
    console.log(`  ${c.bold(a.name)}${a.site ? c.dim(` · ${a.site}`) : ''}\n    ${c.dim(a.about)}`);
  console.log(c.dim('\nLe date cambiano ogni anno: "eventi promemoria <id>" crea un promemoria per controllarle.'));
}
