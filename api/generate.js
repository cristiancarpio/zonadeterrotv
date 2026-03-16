export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const GROQ_KEY    = process.env.GROQ_API_KEY;

  // ── REDIS HELPERS ───────────────────────────────────────────────────
  async function redisGet(key) {
    try {
      const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const j = await r.json();
      return j.result ?? null;
    } catch(e) { return null; }
  }

  async function redisSet(key, value) {
    const ttl = key.startsWith('trends_') ? 21600 : 604800;
    try {
      await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, ex: ttl })
      });
    } catch(e) {}
  }

  async function redisDel(key) {
    try {
      await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
    } catch(e) {}
  }

  // ── GET ─────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key requerida' });
    const value = await redisGet(key);
    return res.status(200).json({ value });
  }

  // ── DELETE ──────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key requerida' });
    await redisDel(key);
    return res.status(200).json({ ok: true });
  }

  // ── POST ─────────────────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!GROQ_KEY) {
    return res.status(500).json({
      error: 'API key no configurada. Vercel → Settings → Environment Variables → GROQ_API_KEY. La conseguís gratis en console.groq.com'
    });
  }

  const saveKey = req.body.saveKey || null;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2048,
        temperature: 0.9,
        messages: req.body.messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || JSON.stringify(data)
      });
    }

    const text = data.choices?.[0]?.message?.content || '';

    if (saveKey && REDIS_URL && REDIS_TOKEN) {
      await redisSet(saveKey, text);
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
