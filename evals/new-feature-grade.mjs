// Deterministic checks supplement, never replace, reading each output against its sources.
export function gradeActions(record, expected, previous = null) {
  const errors = [], items = record.nextActions?.items || [], used = new Set();
  if (items.length !== expected.length) errors.push(`count: ${items.length} != ${expected.length}`);
  for (const e of expected) {
    const i = items.findIndex((a,index) => !used.has(index) && a.source.messageId === record.messages[e.source].id && new RegExp(e.title).test(a.title));
    if (i < 0) { errors.push(`missing: ${e.title} @${e.source}`); continue; }
    used.add(i); const item = items[i];
    if (item.state !== e.state) errors.push(`${e.title}: state ${item.state} != ${e.state}`);
    if (item.dueAt !== e.dueAt) errors.push(`${e.title}: due ${item.dueAt} != ${e.dueAt}`);
    if (e.due && !item.dueText.includes(e.due)) errors.push(`${e.title}: missing deadline`);
    if (e.condition && !new RegExp(e.condition).test(item.condition)) errors.push(`${e.title}: missing condition`);
    if (e.update !== undefined && !(Array.isArray(e.update) ? e.update : [e.update]).some(index=>item.update?.messageId === record.messages[index].id)) errors.push(`${e.title}: wrong update source`);
    if (!!item.completedAt !== !!e.completed) errors.push(`${e.title}: user completion changed`);
    if (e.completed && previous && !previous.nextActions.items.some(p => p.id === item.id && p.completedAt === item.completedAt)) errors.push(`${e.title}: completion identity changed`);
  }
  return {pass:!errors.length,errors};
}
export function gradeGuide(result, testCase, questions = []) {
  const e = testCase.expected, errors = [];
  if (result.status !== e.status) errors.push(`status: ${result.status} != ${e.status}`);
  if (e.intent && result.intent !== e.intent) errors.push(`intent: ${result.intent} != ${e.intent}`);
  if (e.status === 'ready' && result.status === 'ready') {
    const text = [...result.steps,...result.conditions].map(x=>x.text).concat(result.unknowns).join('\n');
    const unknowns = result.unknowns.join('\n');
    for(const pattern of e.must || []) if(!new RegExp(pattern).test(text)) errors.push(`missing: ${pattern}`);
    for(const pattern of e.forbid || []) {
      const statements=[...result.steps.map(x=>({text:x.text})),...result.conditions.map(x=>({text:x.text,policy:true})),...result.unknowns.map(text=>({text}))];
      const forbidden=statements.some(s=>new RegExp(pattern).test(s.text) && !(e.conditionalPolicy && new RegExp(e.conditionalPolicy).test(s.text) && !/고객님|귀하|이므로|때문|따라서|현재/.test(s.text)));
      if(forbidden) errors.push(`forbidden: ${pattern}`);
    }
    for(const pattern of e.unknownMust || []) if(!new RegExp(pattern).test(unknowns)) errors.push(`missing uncertainty: ${pattern}`);
    for(const pattern of e.unknownForbid || []) if(new RegExp(pattern).test(unknowns)) errors.push(`redundant question: ${pattern}`);
    if(result.mode !== (testCase.fallback ? 'reviewed' : 'live')) errors.push(`source mode: ${result.mode}`);
    if(testCase.fallback && result.sources.some(s=>s.checkedAt!=='2026-11-15')) errors.push('fallback date changed');
  }
  if (testCase.questions && JSON.stringify(questions)!==JSON.stringify(testCase.questions)) errors.push(`questions: ${questions.join(',')}`);
  return {pass:!errors.length,errors};
}
