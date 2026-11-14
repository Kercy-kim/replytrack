const normalized = value => (value || '').trim().replace(/\s+/g, ' ');
const questionState = q => ({ status: q.status, aiStatus: q.aiStatus ?? q.status, manualStatus: q.manualStatus ?? null });
const promiseState = p => ({ title: p.title, state: p.state, dueAt: p.dueAt ?? null, dueText: p.dueText || '', confirmedAt: p.confirmedAt ?? null });
const deadlineKey = p => p.dueAt ? `date:${p.dueAt}` : `unknown:${normalized(p.dueText)}`;

// Compare validated, effective states. Never ask the model to invent a change log.
export function compareAnalysis(record, questions, promises, at) {
  const fromMessageCount = record.analyzedMessageCount || 0;
  const initial = !fromMessageCount && !record.analysis && !record.questions.length;
  const addedMessages = record.messages.slice(fromMessageCount);
  const comparison = {
    at, kind: initial ? 'initial' : !addedMessages.length ? 'reanalysis' : addedMessages.every(m => m.role === 'agent') ? 'reply' : 'messages',
    fromMessageCount, toMessageCount: record.messages.length,
    messageIds: initial ? [] : addedMessages.map(m => m.id), questions: [], promises: [],
  };
  if (initial) return comparison;

  const oldQuestions = new Map(record.questions.map(q => [q.id, q]));
  for (const q of questions) {
    const old = oldQuestions.get(q.id);
    const before = old ? questionState(old) : null, after = questionState(q);
    if (!before || before.status !== after.status || (after.manualStatus && before.aiStatus !== after.aiStatus)) {
      comparison.questions.push({ id: q.id, title: q.title, before, after,
        evidenceMessageIds: [...new Set(q.evidence.length ? q.evidence.map(e => e.messageId) : [q.source.messageId])] });
    }
  }
  const oldPromises = new Map(record.promises.map(p => [p.id, p]));
  for (const p of promises) {
    const old = oldPromises.get(p.id);
    const before = old ? promiseState(old) : null, after = promiseState(p);
    const fields = before ? [
      normalized(before.title) !== normalized(after.title) ? 'title' : null,
      before.state !== after.state ? 'state' : null,
      deadlineKey(before) !== deadlineKey(after) ? 'deadline' : null,
    ].filter(Boolean) : ['added'];
    if (fields.length) comparison.promises.push({ id: p.id, title: p.title, before, after, fields, evidenceMessageIds: [p.evidence.messageId] });
  }
  return comparison;
}
