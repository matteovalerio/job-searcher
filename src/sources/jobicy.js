import { getJson } from '../http.js';
import { makeJob } from '../job.js';
import { eachQuery } from './queries.js';

const URL = 'https://jobicy.com/api/v2/remote-jobs';

export function parse(data) {
  return (data.jobs ?? []).map((j) =>
    makeJob('jobicy', {
      id: j.id,
      title: j.jobTitle,
      company: j.companyName,
      location: j.jobGeo,
      url: j.url,
      postedAt: j.pubDate,
      description: j.jobExcerpt ?? j.jobDescription,
      salary: j.annualSalaryMin ? `${j.annualSalaryMin}-${j.annualSalaryMax} ${j.salaryCurrency ?? ''}` : '',
      tags: [...[j.jobIndustry ?? []].flat(), ...[j.jobType ?? []].flat()],
      remote: true,
    }),
  );
}

export default {
  name: 'jobicy',
  label: 'Jobicy',
  supports: ['remote'],
  async search({ keywords, warn }) {
    return eachQuery(
      keywords,
      async (keyword) => parse(await getJson(`${URL}?${new URLSearchParams({ count: '100', tag: keyword })}`)),
      warn,
    );
  },
};
