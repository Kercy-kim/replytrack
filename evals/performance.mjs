const distribution = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? null, p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null };
};
export function performanceSummary(results) {
  const calls = results.flatMap(r => r.calls || []), operations = results.flatMap(r => r.operations || []);
  const sum = select => calls.reduce((n, c) => n + (select(c) || 0), 0);
  return {
    inputTokens: sum(c => c.usage?.input_tokens), cachedInputTokens: sum(c => c.usage?.input_tokens_details?.cached_tokens),
    outputTokens: sum(c => c.usage?.output_tokens), reasoningTokens: sum(c => c.usage?.output_tokens_details?.reasoning_tokens),
    totalTokens: sum(c => c.usage?.input_tokens) + sum(c => c.usage?.output_tokens), calls: calls.length,
    callsWithoutUsage: calls.filter(c => !c.usage).length,
    requests: calls.reduce((n, c) => n + (c.transport?.attempts.length ?? 1), 0),
    hedgedCalls: calls.filter(c => c.transport?.hedged).length,
    unobservedRequests: sum(c => c.transport?.unobservedRequests ?? c.usage?.unobserved_requests ?? (c.usage ? 0 : 1)),
    analysisMs: distribution(operations.filter(o => o.kind === 'analysis').map(o => o.ms)),
    initialAnalysisMs: distribution(results.flatMap(r => r.operations?.filter(o => o.kind === 'analysis').slice(0, 1).map(o => o.ms) || [])),
    replyAnalysisMs: distribution(results.flatMap(r => r.operations?.filter(o => o.kind === 'analysis').slice(1).map(o => o.ms) || [])),
    draftMs: distribution(operations.filter(o => o.kind === 'draft').map(o => o.ms)),
    failedOperations: operations.filter(o => !o.success).length,
  };
}

export function compareRuns(before, after) {
  if (!before.complete || !after.complete) throw new Error('Both runs must be complete');
  if (before.suite !== after.suite || before.requestedModel !== after.requestedModel || before.analysisOnly !== after.analysisOnly) throw new Error('Runs must use the same suite, model and tasks');
  for (const file of ['evals/support-cases.mjs', 'evals/status-boundary-cases.mjs', 'evals/unseen-cases.mjs', 'evals/grade.mjs']) {
    if (!before.hashes[file] || before.hashes[file] !== after.hashes[file]) throw new Error('Dataset or grading changed: ' + file);
  }
  if (JSON.stringify(before.results.map(r => r.id).sort()) !== JSON.stringify(after.results.map(r => r.id).sort())) throw new Error('Case selection changed');
  const b = performanceSummary(before.results), a = performanceSummary(after.results);
  const incompleteUsage = b.callsWithoutUsage || a.callsWithoutUsage || b.unobservedRequests || a.unobservedRequests;
  const reduction = (x, y) => x > 0 ? Math.round((x - y) / x * 10000) / 100 : null;
  const regressions = [];
  for (const old of before.results) {
    const current = after.results.find(r => r.id === old.id);
    if (!old.error && current.error) regressions.push(`${old.id}: execution failed`);
    for (const [i, stage] of old.stages.entries()) {
      const actual = current.stages[i]?.grade;
      if (stage.grade?.pass && !actual?.pass) regressions.push(`${old.id}: analysis ${i + 1}`);
      if (stage.reasonGrade?.pass && !current.stages[i]?.reasonGrade?.pass) regressions.push(`${old.id}: analysis ${i + 1} reason quality`);
      for (const key of ['found', 'correct', 'evidenceCorrect', 'correctPromises']) if (stage.grade?.metrics?.[key] > (actual?.metrics?.[key] ?? -1)) regressions.push(`${old.id}: analysis ${i + 1} ${key} decreased`);
      if ((actual?.metrics?.falseAnswered ?? 0) > (stage.grade?.metrics?.falseAnswered ?? 0)) regressions.push(`${old.id}: analysis ${i + 1} false answered increased`);
    }
    if (old.draft?.body && !current.draft?.body) regressions.push(`${old.id}: draft failed`);
  }
  return { before: b, after: a, reductionPercent: { totalTokens: incompleteUsage ? null : reduction(b.totalTokens, a.totalTokens), inputTokens: incompleteUsage ? null : reduction(b.inputTokens, a.inputTokens), outputTokens: incompleteUsage ? null : reduction(b.outputTokens, a.outputTokens), analysisMedian: reduction(b.analysisMs.median, a.analysisMs.median), initialAnalysisMedian: reduction(b.initialAnalysisMs.median, a.initialAnalysisMs.median), replyAnalysisMedian: reduction(b.replyAnalysisMs.median, a.replyAnalysisMs.median), draftMedian: reduction(b.draftMs.median, a.draftMs.median) }, regressions, semanticReview: 'Saved reasons, evidence and draft meaning must also be reviewed against the source; automated comparison is insufficient.' };
}
