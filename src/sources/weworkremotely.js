import { createRssSource } from './rss.js';

// I titoli del feed sono nel formato "Azienda: Titolo dell'offerta".
export function splitTitle(title) {
  const idx = title.indexOf(': ');
  return idx > 0 ? { company: title.slice(0, idx), title: title.slice(idx + 2) } : { title };
}

export default createRssSource({
  name: 'weworkremotely',
  label: 'We Work Remotely',
  url: 'https://weworkremotely.com/remote-jobs.rss',
  supports: ['remote'],
  remote: true,
  mapItem: (item) => ({ ...splitTitle(item.title), location: item.location || 'Anywhere' }),
});
