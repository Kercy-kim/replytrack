// Deterministic grading complements the saved-output semantic review; it is not an LLM judge.
export function grade(record, expected, previous = null) {
  const issues = [], matched = new Set(), promiseMatches = new Set();
  let correct = 0, falseAnswered = 0, found = 0, evidenceCorrect = 0;
  const questionResults = expected.questions.map(gold => {
    const candidates = record.questions.filter(x => !matched.has(x.id) && x.source.messageId === record.messages[gold.message].id);
    const topic = new RegExp(gold.topic);
    const titleMatches = candidates.filter(x => topic.test(x.title));
    const matches = titleMatches.length ? titleMatches : candidates.filter(x => topic.test(x.source.quote));
    const actual = matches.length === 1 ? matches[0] : null;
    if (!actual) { issues.push(`question:${gold.message}/${gold.topic}: ${matches.length ? 'ambiguous match' : 'missing'}`); return { gold, actual: null }; }
    matched.add(actual.id); found++;
    if (actual.status === gold.status) correct++;
    else issues.push(`status:${gold.topic}: expected ${gold.status}, got ${actual.status}`);
    if (gold.status !== 'answered' && actual.status === 'answered') falseAnswered++;
    const indexes = actual.evidence.map(e => record.messages.findIndex(m => m.id === e.messageId));
    // All required reply messages must be cited; the separate review checks semantic quote relevance.
    const evidenceOK = gold.evidence.every(i => indexes.includes(i)) && (gold.status !== 'unanswered' || indexes.length === 0);
    if (evidenceOK) evidenceCorrect++;
    else issues.push(`evidence:${gold.topic}: expected messages ${gold.evidence}, got ${indexes}`);
    if (actual.status === 'answered' && actual.followUp) issues.push(`followup:${gold.topic}: answered question has follow-up`);
    if (previous && !previous.questions.some(x => x.id === actual.id)) issues.push(`identity:${gold.topic}: existing question id changed`);
    return { gold, actual: { id: actual.id, title: actual.title, status: actual.status, evidence: indexes }, evidenceOK };
  });
  for (const extra of record.questions.filter(x => !matched.has(x.id))) issues.push(`extra question: ${extra.title}`);
  const promiseResults = expected.promises.map(gold => {
    const messageIds = (gold.messageOptions || [gold.message]).map(i => record.messages[i].id);
    const matches = record.promises.filter(x => !promiseMatches.has(x.id) && messageIds.includes(x.evidence.messageId) && new RegExp(gold.topic).test(x.title + ' ' + x.evidence.quote));
    const actual = matches.length === 1 ? matches[0] : null;
    if (!actual) { issues.push(`promise:${gold.topic}: ${matches.length ? 'ambiguous match' : 'missing'}`); return { gold, actual: null, ok: false }; }
    promiseMatches.add(actual.id);
    const deadlineOK = gold.deadlineOptions ? gold.deadlineOptions.includes(actual.dueText) : gold.deadline ? actual.dueText.includes(gold.deadline) : !actual.dueText;
    const ok = actual.state === gold.state && actual.dueAt === gold.dueAt && deadlineOK && !actual.confirmedAt;
    if (!ok) issues.push(`promise:${gold.topic}: expected ${gold.state}/${gold.dueAt}/${gold.deadline}, got ${actual.state}/${actual.dueAt}/${actual.dueText}`);
    if (previous && !gold.isNew && !previous.promises.some(x => x.id === actual.id)) issues.push(`identity:promise ${gold.topic}: existing promise id changed`);
    if (previous && gold.isNew && previous.promises.some(x => x.id === actual.id)) issues.push(`identity:promise ${gold.topic}: new action reused an existing promise id`);
    return { gold, actual: { id: actual.id, title: actual.title, state: actual.state, dueAt: actual.dueAt, dueText: actual.dueText, confirmedAt: actual.confirmedAt }, ok };
  });
  for (const extra of record.promises.filter(x => !promiseMatches.has(x.id))) issues.push(`extra promise: ${extra.title}`);
  const refs = [...record.questions.flatMap(x => [x.source, ...x.evidence]), ...record.promises.map(x => x.evidence)];
  const grounded = refs.filter(e => record.messages.some(m => m.id === e.messageId && m.text.includes(e.quote))).length;
  if (grounded !== refs.length) issues.push('ungrounded reference');
  if (record.warnings.length) issues.push(...record.warnings.map(x => `warning:${x}`));
  return { pass: !issues.length, issues, questions: questionResults, promises: promiseResults,
    metrics: { expectedQuestions: expected.questions.length, found, correct, falseAnswered, expectedUnresolved: expected.questions.filter(q => q.status !== 'answered').length, evidenceCorrect, expectedPromises: expected.promises.length, correctPromises: promiseResults.filter(p => p.ok).length, references: refs.length, grounded } };
}

export function summarize(results) {
  const grades = results.flatMap(r => r.stages.filter(s => s.grade).map(s => s.grade));
  const totals = {};
  for (const g of grades) for (const [key, value] of Object.entries(g.metrics)) totals[key] = (totals[key] || 0) + value;
  const calls = results.flatMap(r => r.calls), times = calls.map(c => c.ms).sort((a,b) => a-b);
  return { cases: results.length, completedCases: results.filter(r => !r.error).length, passedCases: results.filter(r => !r.error && r.stages.every(s => s.grade.pass)).length,
    stages: grades.length, passedStages: grades.filter(g => g.pass).length, totals,
    calls: calls.length, apiErrors: calls.filter(c => c.error).length, draftErrors: results.filter(r => r.draft?.error).length,
    inputTokens: calls.reduce((n,c) => n + (c.usage?.input_tokens || 0), 0), outputTokens: calls.reduce((n,c) => n + (c.usage?.output_tokens || 0), 0),
    latencyMs: { median: times[Math.floor(times.length / 2)] ?? null, p95: times[Math.max(0, Math.ceil(times.length * .95) - 1)] ?? null, max: times.at(-1) ?? null } };
}
