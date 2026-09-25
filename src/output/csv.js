const COLUMNS = ['target', 'isNew', 'score', 'title', 'company', 'location', 'postedAt', 'source', 'url', 'salary'];

const cell = (value) => {
  const s = String(value ?? '');
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function renderCsv(results) {
  const rows = [COLUMNS.join(',')];
  for (const { target, jobs } of results) {
    for (const job of jobs) {
      rows.push(COLUMNS.map((col) => cell(col === 'target' ? target.label : job[col])).join(','));
    }
  }
  return `${rows.join('\n')}\n`;
}
