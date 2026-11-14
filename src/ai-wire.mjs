// Short references exist only for one API request. Stored IDs and literal text stay intact.
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const scalarKeys = new Set(['id', 'messageId']);
const arrayKeys = new Set(['questionIds', 'sourceMessageIds']);
const generatedProse = new Set(['body', 'reason', 'summary', 'followUp', 'feedback', 'revisionFeedback']);
const referencePattern = /\b(?:[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}|_r\d+)\b/gi;

export function compactReferences(data, schema) {
  const encoded = new Map(), decoded = new Map(), occupied = JSON.stringify(data);
  let next = 1;
  function collect(value, key = '') {
    if (typeof value === 'string' && (scalarKeys.has(key) || arrayKeys.has(key)) && uuid.test(value) && !encoded.has(value)) {
      let alias;
      do { alias = `_r${next++}`; } while (occupied.includes(alias));
      encoded.set(value, alias); decoded.set(alias, value);
    } else if (Array.isArray(value)) value.forEach(v => collect(v, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collect(v, k));
  }
  collect(data);
  function transform(value, map, key = '', isSchema = false, restoring = false) {
    if (typeof value === 'string') {
      if (scalarKeys.has(key) || arrayKeys.has(key) || (isSchema && key === 'enum')) return map.get(value) ?? value;
      // Preserve source text/quotes. Only generated feedback is re-encoded for a repair request.
      if (!isSchema && ((restoring && generatedProse.has(key)) || ['feedback', 'revisionFeedback'].includes(key))) return value.replace(referencePattern, ref => map.get(ref) ?? ref);
      return value;
    }
    if (Array.isArray(value)) return value.map(v => transform(v, map, key, isSchema, restoring));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v, map, k, isSchema, restoring)]));
    return value;
  }
  return {
    data: transform(data, encoded), schema: transform(schema, encoded, '', true),
    decode(value) {
      // Restore prose references too; leaked IDs in body remain visible to the existing guard.
      return transform(value, decoded, '', false, true);
    },
  };
}
