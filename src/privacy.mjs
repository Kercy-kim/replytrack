// Korean phone numbers and street/lot addresses. Rule-based detection is intentionally
// followed by a human preview; unusual addresses and OCR errors can be missed.
const phone = /(?<![\dA-Za-z])(?:\+82[\s.\-–—]?(?:\(0\)[\s.\-]?)?(?:10|1[16789]|2|[3-6]\d|70)|0(?:10|1[16789]|2|[3-6]\d|70|80))[\s.\-–—]?\d{3,4}[\s.\-–—]?\d{4}(?!\d)/g;
const servicePhone = /(?<![\dA-Za-z])(?:15|16|18)\d{2}[-. ]\d{4}(?!\d)/g;
const region = '(?:(?:[가-힣]{2,}(?:특별자치시|특별자치도|특별시|광역시|도|시|군|구|읍|면)|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\\s+)';
const road = '[가-힣A-Za-z][가-힣A-Za-z0-9·.]*?(?:대로|로|길)(?:\\s*\\d+(?:번길|길))?\\s*\\d+(?:-\\d+)?';
const lot = '(?:[가-힣][가-힣0-9·]*(?:동|리)|[가-힣·]+\\d+가)\\s*(?:산\\s*)?\\d+(?:-\\d+)?(?:번지)?';
const detail = '(?:[ ,]+(?:[가-힣A-Za-z]+(?:아파트|빌라|오피스텔|빌딩|타워)\\s*)?(?:[A-Za-z가-힣0-9-]+동\\s*)?\\d+(?:층|호)(?:\\s*\\d+호)?|\\s*\\([가-힣0-9 ,·-]+\\))*';
const address = new RegExp(`(?<![가-힣A-Za-z0-9])(?:${region}){0,4}(?:${lot}|${road})(?![\\d-]|[,\\.]\\d|[ \\t]*(?:원|만원|천원|%|일|시간|분|초|개월|건|개|회))${detail}`, 'g');

const walk = (value, convert) => typeof value === 'string' ? convert(value) : Array.isArray(value) ? value.map(v => walk(v, convert))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, convert)])) : value;

export function privacyEnvelope(input) {
  const occupied = JSON.stringify(input) || '';
  const replacements = new Map(), originals = new Map(); let next = 0;
  const counts = { phone: 0, address: 0 };
  const alias = (value, kind) => {
    const key = `${kind}:${value}`;
    if (replacements.has(key)) return replacements.get(key);
    // Letters avoid confusing numeric/date factual validation; never collide with user text.
    let token;
    do { const suffix = (++next).toString(26).replace(/[0-9a-p]/g, c => String.fromCharCode(65 + parseInt(c, 26))); token = `[${kind === 'phone' ? '전화번호' : '주소'}_${suffix}]`; } while (occupied.includes(token));
    replacements.set(key, token); originals.set(token, value); counts[kind]++; return token;
  };
  const encode = text => text.replace(phone, v => alias(v, 'phone')).replace(servicePhone, v => alias(v, 'phone')).replace(address, v => alias(v, 'address'));
  const data = walk(input, encode);
  return { data, counts, decode: value => walk(value, text => text.replace(/\[(?:전화번호|주소)_[A-Z]+\]/g, token => originals.get(token) ?? token)) };
}
export const maskPrivate = input => privacyEnvelope(input).data;
