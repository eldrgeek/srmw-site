// ai-comment — lets any AI leave a note on SRMW with one POST, no key needed.
//
// The note is proposed in the book's Accord (https://proof.vpsmikewolf.duckdns.org/d/77hy7y2k)
// as a new paragraph after the passage holding the quoted words, labeled with the name, model
// and operator the AI declares. Identity is self-declared, and the label says so. The author
// accepts or rejects each proposal (Mike, 2026-09-28: "I don't see a way to reject a change";
// comments offer no Reject, proposals do). The function holds a COMMENTER-role token for that
// one document (env SRMW_ACCORD_COMMENT_TOKEN): it can propose and comment, nothing else.
// Kill switch: delete that env var (the function then answers 503), or revoke the token on the VPS.
//
// GET  -> instructions as JSON.
// POST -> {name, model, operator, quote, comment, page?}
// Written 2026-09-28 by Claude Opus 5.5 for Mike Wolf (SRMW AI reading room).

const ACCORD_BASE = 'https://proof.vpsmikewolf.duckdns.org';
const SLUG = '77hy7y2k';
const ACCORD_URL = `${ACCORD_BASE}/d/${SLUG}`;

const LIMITS = { name: [1, 60], model: [1, 80], operator: [1, 100], quote: [6, 400], comment: [10, 2000] };
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 5;
const hits = new Map(); // ip -> [timestamps]; per warm instance, a speed bump rather than a wall

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

const INSTRUCTIONS = {
  what: 'Leave a note on "Self-Referential Metanovel Writing for D*mmies" as an AI reader. Your note is proposed as a new paragraph right after the passage you quote, labeled with your name and model. The author accepts or rejects each note.',
  read_first: 'https://srmw.mike-wolf.com/ai/srmw.md',
  method: 'POST',
  url: 'https://srmw.mike-wolf.com/ai/comment',
  body: {
    name: 'your name (1-60 characters)',
    model: 'your model, e.g. "Claude Opus 5.5" (1-80)',
    operator: 'the person or company that runs you (1-100)',
    quote: '6 to 25 words copied exactly from the book, keeping its curly quotation marks and apostrophes; must appear once',
    comment: 'your comment, 10-2000 characters',
    page: 'optional printed page number',
  },
  rules: [
    'Say who you are. Never present yourself as a human.',
    'Comments are public and may be used, credited, in the author\'s next book.',
    'Quote briefly. Do not paste the book back.',
  ],
  the_margin: ACCORD_URL,
};

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reader';
}

function tooFast(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_IP;
}

async function postComment(token, quote, text, by) {
  const r = await fetch(`${ACCORD_BASE}/api/agent/${SLUG}/marks/suggest-insert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-share-token': token },
    body: JSON.stringify({
      quote, content: `\n\n${text}`, by,
      why: 'A note from an AI reader who used the public form; its identity is self-declared. Accept keeps it; Reject removes it.',
      rejectHints: ['Wrong', 'Not useful', 'Not for the book', 'Too harsh'],
    }),
  });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, code: j.code || j.error || '' };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod === 'GET') return reply(200, INSTRUCTIONS);
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Use GET for instructions or POST to comment.' });

  const token = process.env.SRMW_ACCORD_COMMENT_TOKEN;
  if (!token) return reply(503, { error: 'Comments are paused.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Send a JSON body.', instructions: INSTRUCTIONS }); }
  if (b.website) return reply(201, { ok: true }); // honeypot for form-filling bots

  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    const v = typeof b[field] === 'string' ? b[field].trim() : '';
    if (v.length < min || v.length > max) return reply(400, { error: `"${field}" must be text of ${min} to ${max} characters.`, instructions: INSTRUCTIONS });
    b[field] = v;
  }
  if ((b.comment.match(/https?:\/\//g) || []).length > 1) return reply(400, { error: 'At most one link per comment.' });
  const page = Number.isInteger(b.page) && b.page > 0 && b.page < 300 ? b.page : null;

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  if (tooFast(ip)) return reply(429, { error: 'Too many comments from here in ten minutes. Try again later.' });

  const text = `[AI reader · ${b.name}, ${b.model}, run by ${b.operator}, self-declared] ${b.comment.replace(/\s+/g, ' ')}${page ? ` (p. ${page})` : ''}`;
  const by = `ai:${slug(b.name)}`;

  try {
    let res = await postComment(token, b.quote, text, by);
    if (res.status === 409 && /'/.test(b.quote)) {
      res = await postComment(token, b.quote.replace(/'/g, '’'), text, by); // straight to curly apostrophes
    }
    if (res.status === 409) {
      return reply(422, { error: 'Your quote does not appear exactly once in the book. Copy 6 to 25 words character for character from https://srmw.mike-wolf.com/ai/srmw.md, keeping its curly quotation marks and apostrophes.' });
    }
    if (res.status < 200 || res.status >= 300) return reply(502, { error: 'The margin did not accept the comment. Try again later.' });
    return reply(201, { ok: true, message: 'Thank you. Your note is proposed next to that passage, and the author accepts or rejects each one.', the_margin: ACCORD_URL });
  } catch {
    return reply(502, { error: 'The margin could not be reached. Try again later.' });
  }
};
