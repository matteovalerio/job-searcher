import { getJson } from '../http.js';
import { makeJob } from '../job.js';

// Remotive chiede poche richieste al giorno: scarichiamo tutto una volta e filtriamo in locale.
const URL = 'https://remotive.com/api/remote-jobs';

export function parse(data) {
  return (data.jobs ?? []).map((j) =>
    makeJob('remotive', {
      id: j.id,
      title: j.title,
      company: j.company_name,
      location: j.candidate_required_location,
      url: j.url,
      postedAt: j.publication_date,
      description: j.description,
      salary: j.salary,
      tags: [j.category, j.job_type, ...(j.tags ?? [])],
      remote: true,
    }),
  );
}

export default {
  name: 'remotive',
  label: 'Remotive',
  supports: ['remote'],
  async search() {
    return parse(await getJson(URL));
  },
};
