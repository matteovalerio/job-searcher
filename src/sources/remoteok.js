import { getJson } from '../http.js';
import { makeJob } from '../job.js';
import { expectList } from './shape.js';

const URL = 'https://remoteok.com/api';

export function parse(data) {
  // Il primo elemento dell'array è un avviso legale, non un'offerta.
  return (Array.isArray(data) ? data : [])
    .filter((j) => j && j.id && j.position)
    .map((j) =>
      makeJob('remoteok', {
        id: j.id,
        title: j.position,
        company: j.company,
        location: j.location,
        url: j.url ?? `https://remoteok.com/remote-jobs/${j.id}`,
        postedAt: j.date ?? j.epoch,
        description: j.description,
        salary: j.salary_min ? `${j.salary_min}-${j.salary_max} USD` : '',
        tags: j.tags,
        remote: true,
      }),
    );
}

export default {
  name: 'remoteok',
  label: 'Remote OK',
  supports: ['remote'],
  usesKeywords: false, // scarica tutte le offerte e le filtra in locale
  async search() {
    return parse(expectList(await getJson(URL), ['']));
  },
};
