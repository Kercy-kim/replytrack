// Keep unfinished input in this tab's memory, never in browser storage.
export const newOnboarding = () => ({ stage: 'import', channel: 'chat', myAddress: '', title: '', company: '', text: '', file: null, messages: [], notes: [], prepared: null });
export const hasOnboardingInput = draft => !!draft && !!(draft.title || draft.company || draft.text || draft.file || draft.messages.some(m => m.text));

export function manualMessages(text) {
  if (!text.trim()) return [{ role: 'customer', text: '', sentAt: null }, { role: 'agent', text: '', sentAt: null }];
  const messages = [];
  for (const line of text.split(/\r?\n/)) {
    if (!messages.length && !line.trim()) continue;
    const match = line.match(/^\s*(나|고객|고객센터|상담원)\s*[:：]\s?(.*)$/);
    if (match) messages.push({ role: ['나', '고객'].includes(match[1]) ? 'customer' : 'agent', text: match[2], sentAt: null });
    else if (messages.length) messages.at(-1).text += `\n${line}`;
    else messages.push({ role: 'unknown', text: line, sentAt: null });
  }
  // Retain every character within the server's message limits; never guess a speaker.
  const chunks = messages.flatMap(m => Array.from({ length: Math.max(1, Math.ceil(m.text.length / 6000)) }, (_, i) => ({ ...m, text: m.text.slice(i * 6000, (i + 1) * 6000) })));
  return chunks.length <= 60 ? chunks : Array.from({ length: Math.ceil(text.length / 6000) }, (_, i) => ({ role: 'unknown', text: text.slice(i * 6000, (i + 1) * 6000), sentAt: null }));
}
