import assert from 'node:assert/strict';
import { test } from 'node:test';
import { associations, buildEventPrompt, EVENTS, reminderIcs, upcomingEvents } from '../src/events.js';

const profileText = 'Redattrice, editoria scientifica, traduzione e localizzazione, medical writer';

test('prossimi eventi: prima i più vicini nel tempo, nello stesso mese prima quelli in zona', () => {
  const list = upcomingEvents({ profileText, home: 'Piazzola sul Brenta', now: new Date('2026-09-29T10:00:00Z') });
  assert.equal(list.length, EVENTS.length);
  assert.ok(list.every((e, i) => i === 0 || e.monthsAway >= list[i - 1].monthsAway));
  const september = list.filter((e) => e.monthsAway === 0);
  assert.deepEqual(
    september.map((e) => e.id),
    ['treviso-comic', 'pordenonelegge', 'festivaletteratura'],
  );
  const bologna = list.find((e) => e.id === 'bologna-childrens');
  assert.deepEqual([bologna.nextMonth, bologna.nextYear, bologna.when], [3, 2027, 'marzo o aprile']);
  assert.equal(list.find((e) => e.id === 'francoforte').distanceKm, null, 'all’estero: niente distanza');
  // Solo i prossimi 3 mesi.
  assert.ok(upcomingEvents({ now: new Date('2026-09-29T10:00:00Z'), months: 3 }).every((e) => e.monthsAway < 3));
});

test('associazioni: prima le più vicine al profilo', () => {
  const list = associations('traduttrice e interprete, localizzazione');
  assert.equal(list[0].fit.traduzione, 5);
  assert.equal(associations('medical writer, scientific writing, medical communications')[0].id, 'emwa');
});

test('promemoria nel calendario: il mese prima, "controlla le date", mai nel passato', () => {
  const now = new Date('2026-09-29T10:00:00Z');
  const list = upcomingEvents({ now });
  const bologna = list.find((e) => e.id === 'bologna-childrens');
  const ics = reminderIcs(bologna, now);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270201\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20270202\r\n/);
  assert.match(ics, /SUMMARY:Controlla le date: Bologna Children's Book Fair/);
  assert.match(
    ics,
    /di solito si tiene a marzo o aprile\. Date e programma: https:\/\/www\.bolognachildrensbookfair\.com\//,
  );
  // Evento di questo mese: il promemoria è per domani (anche a fine mese).
  const now2 = new Date('2026-09-30T10:00:00Z');
  const pordenone = upcomingEvents({ now: now2 }).find((e) => e.id === 'pordenonelegge');
  assert.match(reminderIcs(pordenone, now2), /DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002/);
});

test('preparare la visita: CV, aziende della lista, regole contro le invenzioni', () => {
  const event = upcomingEvents().find((e) => e.id === 'piu-libri');
  const prompt = buildEventPrompt(event, {
    cvText: 'Giulia Esempio\nRedattrice',
    publishers: [
      { name: 'Edizioni Rosse', city: 'Padova', status: 'da_contattare' },
      { name: 'Scartata Srl', status: 'scartata' },
    ],
  });
  assert.match(prompt, /Vado a Più libri più liberi \(Roma, di solito a dicembre\)/);
  assert.match(prompt, /<cv>\nGiulia Esempio\nRedattrice\n<\/cv>/);
  assert.match(prompt, /- Edizioni Rosse \(Padova\)/);
  assert.doesNotMatch(prompt, /Scartata/);
  assert.match(prompt, /Non inventare date, espositori o programma/);
});
