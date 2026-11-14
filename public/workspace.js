// Date-only deadlines are compared in Korea, independent of the browser timezone.
export function koreaDay(now = new Date()) {
  return new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
export function deadlineState(promise, today = koreaDay()) {
  if (promise.confirmedAt) return 'confirmed';
  const due = promise.dueAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '') || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0, 10) !== due) return 'unknown';
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
}
export function summarizeDeadlines(promises, today = koreaDay()) {
  const summary = { overdue: 0, today: 0, upcoming: 0, unknown: 0, nextDueAt: null };
  for (const p of promises) {
    const status = deadlineState(p, today);
    if (status === 'confirmed') continue;
    summary[status]++;
    if (status !== 'unknown' && (!summary.nextDueAt || p.dueAt < summary.nextDueAt)) summary.nextDueAt = p.dueAt;
  }
  return summary;
}
export function casePriority(c) {
  if (c.archivedAt) return 5;
  if (c.deadlines?.overdue) return 0;
  if (c.deadlines?.today) return 1;
  if (c.pendingAnalysis) return 2;
  if (c.unanswered || c.promises) return 3;
  return 4;
}
export function filterCases(cases, { query = '', filter = 'active', sort = 'priority' } = {}) {
  const term = query.normalize('NFKC').trim().toLocaleLowerCase('ko');
  return cases.filter(c => {
    if (filter === 'archived' ? !c.archivedAt : c.archivedAt) return false;
    if (filter === 'remaining' && !c.unanswered) return false;
    if (filter === 'due' && !c.deadlines?.overdue && !c.deadlines?.today) return false;
    if (filter === 'analysis' && !c.pendingAnalysis) return false;
    return `${c.title} ${c.company}`.normalize('NFKC').toLocaleLowerCase('ko').includes(term);
  }).sort((a, b) => (sort === 'priority' ? casePriority(a) - casePriority(b) : 0)
    || (sort === 'priority' && casePriority(a) <= 1 ? a.deadlines.nextDueAt.localeCompare(b.deadlines.nextDueAt) : 0)
    || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
export const savedDraft = draft => draft?.editedBody ?? draft?.body ?? '';
export function dirtyDraftKinds(drafts, edits) {
  return Object.keys(edits).filter(kind => edits[kind] !== savedDraft(drafts[kind]));
}
export function selectedQuestionIds(previous, next, selected) {
  const remaining = next.questions.filter(q => q.status !== 'answered').map(q => q.id);
  // Select all on first analysis/open; same-case updates preserve deliberate exclusions.
  if (previous?.id !== next.id || !previous.questions.length) return remaining;
  return remaining.filter(id => selected.has(id));
}
