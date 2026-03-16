export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const GEMINI_KEY  = process.env.GEMINI_API_KEY;

  // ── REDIS ───────────────────────────────────────────────────────────
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

  if (!GEMINI_KEY) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY no configurada. Vercel → Settings → Environment Variables. La conseguís gratis en aistudio.google.com'
    });
  }

  const useSearch = req.body.useSearch || false;
  const saveKey   = req.body.saveKey   || null;

  try {
    const bodyPayload = {
      contents: req.body.messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        maxOutputTokens: useSearch ? 800 : 2048,
        temperature: 0.9
      }
    };

    // Google Search solo para tendencias
    if (useSearch) {
      bodyPayload.tools = [{ google_search: {} }];
    }

    const fetchGemini = async (retries = 3, delay = 8000) => {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        }
      );
      if (response.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return fetchGemini(retries - 1, delay + 5000);
      }
      return response;
    };

    const response = await fetchGemini();
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || JSON.stringify(data)
      });
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '')
      .join('') || '';

    if (saveKey && REDIS_URL && REDIS_TOKEN && text) {
      await redisSet(saveKey, text);
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
