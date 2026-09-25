export function renderJson(results) {
  return JSON.stringify(
    results.map(({ target, jobs, stats }) => ({
      target: { id: target.id, label: target.label, type: target.type, place: target.place },
      stats,
      jobs,
    })),
    null,
    2,
  );
}
