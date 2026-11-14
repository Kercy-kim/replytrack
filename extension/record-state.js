// Keep session edits separate from the latest saved web draft.
export function applyRecord(state, record) {
  const changed = record.id === state.recordId && state.recordVersion !== null && record.version !== state.recordVersion;
  const remaining = record.questions.filter(q => q.status !== 'answered').map(q => q.id);
  state.selected = state.selectionInitialized ? state.selected.filter(id => remaining.includes(id)) : remaining;
  if (record.questions.length) state.selectionInitialized = true;
  if (state.draftDirty) { if (changed) state.draftStale = true; }
  else { state.draft = record.drafts.followup?.editedBody ?? record.drafts.followup?.body ?? ''; state.draftStale = false; }
  state.record = record; state.recordId = record.id; state.recordVersion = record.version; state.phase = 'result';
}
