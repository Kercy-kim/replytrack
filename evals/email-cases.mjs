// Synthetic examples, not real provider policies or personal data.
export const emailCases = [
  {
    id: 'account-recovery', customer: 'What documents do you need to recover my account? How long will the review take?',
    agent: 'Please provide the transaction ID from your purchase receipt. Do not send your password or verification codes. After we verify the transaction ID, we will review your recovery request.',
    reply: 'We received your transaction ID. The review will take 3 business days. Your account has not been restored yet. We will email you after the review.',
    initial: ['answered', 'partial'], updated: ['answered', 'answered'], keywords: [/거래/, /비밀번호|암호/, /코드/, /확인|검증/],
  },
  {
    id: 'billing-email', customer: 'Am I eligible for a refund? Do I need to send a screenshot?',
    agent: 'A refund is available only if the duplicate charge is confirmed. A screenshot is optional. Do not include your full card number. We cannot yet confirm whether your charge was duplicated.',
    reply: 'We confirmed that the charge was duplicated. You are eligible for a refund. We will process the refund after you confirm the transaction ID. A screenshot is still optional.',
    initial: ['answered', 'partial'], updated: ['answered', 'answered'], keywords: [/중복/, /경우|조건|확인/, /선택|필수.*아니|필요.*없/, /카드/],
  },
];
export function emailThread(fixture, reply = false) {
  const first = `From: me@example.test\nTo: support@example.test\nDate: 2026-11-14T09:00:00+09:00\nSubject: ${fixture.id}\n\n${fixture.customer}`;
  const second = `From: support@example.test\nTo: me@example.test\nDate: 2026-11-14T10:00:00+09:00\nSubject: Re: ${fixture.id}\n\n${fixture.agent}\n\nOn 2026-11-14, me@example.test wrote:\n> ${fixture.customer}`;
  return reply ? `From: support@example.test\nTo: me@example.test\nDate: 2026-11-15T10:00:00+09:00\nSubject: Re: ${fixture.id}\n\n${fixture.reply}\n\n${second.split('\n').map(l => '> ' + l).join('\n')}` : `${second}\n\n${first}`;
}
