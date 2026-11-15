// One delayed duplicate, under the original deadline. This races transport results;
// the service still validates evidence, reviews meaning and commits exactly once.
export function raceSlowRequest({ request, signal, delayMs, acquireHedge }) {
  const started = performance.now(), attempts = [], controllers = [];
  let timer, release, settled = false, hedged = false, skipped = false;
  const elapsed = () => Math.round(performance.now() - started);
  return new Promise((resolve, reject) => {
    const finish = (value, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      for (const [i, controller] of controllers.entries()) {
        if (attempts[i].state === 'pending') {
          attempts[i].state = 'cancelled'; attempts[i].elapsedMs = elapsed() - attempts[i].startedMs;
          controller.abort();
        }
      }
      release?.();
      const transport = { elapsedMs: elapsed(), hedged, hedgeSkipped: skipped,
        // An aborted HTTP request does NOT prove that generation/billing stopped.
        unobservedRequests: attempts.filter(a => !a.usage).length,
        attempts: structuredClone(attempts) };
      if (error) { error.transport = transport; reject(error); }
      else resolve({ ...value, transport });
    };
    const abort = () => finish(null, signal.reason);
    const launch = () => {
      const controller = new AbortController(); controllers.push(controller);
      const trace = { attempt: attempts.length + 1, startedMs: elapsed(), state: 'pending' }; attempts.push(trace);
      Promise.resolve().then(() => request(controller.signal, trace)).then(value => {
        if (settled) return;
        trace.state = 'completed'; trace.elapsedMs = elapsed() - trace.startedMs;
        finish(value);
      }, error => {
        if (settled) return;
        trace.state = 'failed'; trace.elapsedMs = elapsed() - trace.startedMs; trace.error = error.code || 'REQUEST_ERROR';
        // Never mask authentication, rate-limit or refusal failures with a duplicate.
        if (!hedged || ['AI_AUTH', 'AI_LIMIT', 'AI_REFUSAL'].includes(error.code) || attempts.every(a => a.state !== 'pending')) finish(null, error);
      });
    };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    launch();
    if (delayMs > 0) timer = setTimeout(() => {
      if (settled) return;
      release = acquireHedge();
      if (!release) { skipped = true; return; }
      hedged = true; launch();
    }, delayMs);
  });
}

export function observedUsage(attempts) {
  const usages = attempts.map(a => a.usage).filter(Boolean);
  if (!usages.length) return null;
  const sum = read => usages.reduce((n, u) => n + (read(u) || 0), 0);
  return { input_tokens: sum(u => u.input_tokens), output_tokens: sum(u => u.output_tokens),
    total_tokens: sum(u => u.total_tokens ?? (u.input_tokens || 0) + (u.output_tokens || 0)),
    input_tokens_details: { cached_tokens: sum(u => u.input_tokens_details?.cached_tokens) },
    output_tokens_details: { reasoning_tokens: sum(u => u.output_tokens_details?.reasoning_tokens) },
    unobserved_requests: attempts.filter(a => !a.usage).length };
}
