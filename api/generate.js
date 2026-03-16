export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const ANTHROPIC   = process.env.ANTHROPIC_API_KEY;

  // ── REDIS HELPERS ───────────────────────────────────────────────────
  async function redisGet(key) {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const j = await r.json();
    return j.result ?? null;
  }

  async function redisSet(key, value) {
    // Tendencias: TTL 6 horas (21600 sec) — se actualizan 4 veces por día
    // Resultados: TTL 7 días (604800 sec) — persisten toda la semana
    const isTrend = key.startsWith('trends_');
    const ttl = isTrend ? 21600 : 604800;
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, ex: ttl })
    });
  }

  async function redisDel(key) {
    await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
  }

  // ── GET — leer resultado guardado ───────────────────────────────────
  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key requerida' });
    try {
      const value = await redisGet(key);
      return res.status(200).json({ value });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE — borrar resultado ────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key requerida' });
    try {
      await redisDel(key);
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — generar contenido con Claude ─────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!ANTHROPIC) {
    return res.status(500).json({
      error: 'API key no configurada. Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY.'
    });
  }

  const useSearch = req.body.useSearch || false;
  const useHaiku  = req.body.useHaiku  || false;
  const saveKey   = req.body.saveKey   || null; // key para guardar en Redis

  const needsHaiku = useSearch || useHaiku;
  const model      = needsHaiku ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';
  const maxTokens  = useSearch ? 600 : useHaiku ? 900 : 1400;

  try {
    const body = { model, max_tokens: maxTokens, messages: req.body.messages };
    if (useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC,
      'anthropic-version': '2023-06-01'
    };
    if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(body)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || JSON.stringify(data)
      });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Guardar en Redis si viene saveKey
    if (saveKey && REDIS_URL && REDIS_TOKEN) {
      try { await redisSet(saveKey, text); } catch(e) {}
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
