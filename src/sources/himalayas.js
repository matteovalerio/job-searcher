import { getJson } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

const URL = 'https://himalayas.app/jobs/api/search';

export function parse(data) {
  return (data.jobs ?? []).map((j) =>
    makeJob('himalayas', {
      id: j.guid ?? j.applicationLink,
      title: j.title,
      company: j.companyName,
      // Nessuna restrizione geografica = assumibile da qualsiasi paese.
      location: j.locationRestrictions?.length ? j.locationRestrictions.join(', ') : 'Worldwide',
      url: j.applicationLink ?? j.guid,
      postedAt: j.pubDate,
      description: j.excerpt ?? j.description,
      salary: j.minSalary ? `${j.minSalary}-${j.maxSalary} ${j.currency ?? ''}` : '',
      tags: [...(j.categories ?? []), j.employmentType, j.seniority].flat(),
      remote: true,
    }),
  );
}

export default {
  name: 'himalayas',
  label: 'Himalayas',
  supports: ['remote'],
  async search({ keywords, warn }) {
    return eachQuery(
      keywords,
      async (keyword) => parse(await getJson(`${URL}?${new URLSearchParams({ q: keyword })}`)),
      warn,
    );
  },
};
