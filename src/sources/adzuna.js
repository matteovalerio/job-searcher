import { getJson } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

// API gratuita con chiave: https://developer.adzuna.com/ (copre anche l'Italia).
export function parse(data) {
  return (data.results ?? []).map((j) =>
    makeJob('adzuna', {
      id: j.id,
      title: j.title,
      company: j.company?.display_name,
      location: j.location?.display_name,
      url: j.redirect_url,
      postedAt: j.created,
      description: j.description,
      salary: j.salary_min ? `${Math.round(j.salary_min)}-${Math.round(j.salary_max)}` : '',
      tags: [j.category?.label, j.contract_type, j.contract_time],
    }),
  );
}

export default {
  name: 'adzuna',
  label: 'Adzuna',
  supports: ['area'],
  env: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  async search({ keywords, target, maxAgeDays, maxPages = 2, warn }) {
    const country = (target.country ?? 'it').toLowerCase();
    return eachQuery(
      keywords,
      async (keyword) => {
        const jobs = [];
        for (let page = 1; page <= maxPages; page++) {
          const params = new URLSearchParams({
            app_id: process.env.ADZUNA_APP_ID,
            app_key: process.env.ADZUNA_APP_KEY,
            what_phrase: keyword,
            where: target.place,
            distance: String(target.radiusKm ?? 30),
            results_per_page: '50',
          });
          if (maxAgeDays) params.set('max_days_old', String(maxAgeDays));
          const found = parse(await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`));
          jobs.push(...found);
          if (found.length < 50) break;
        }
        return jobs;
      },
      warn,
    );
  },
};
