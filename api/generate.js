export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const GROQ_KEY    = process.env.GROQ_API_KEY;
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

  const useSearch = req.body.useSearch || false;
  const saveKey   = req.body.saveKey   || null;

  let text = '';

  // ── GEMINI para tendencias (useSearch=true) ────────────────────────
  if (useSearch) {
    if (!GEMINI_KEY) {
      // Sin Gemini, usar Groq sin web search como fallback
      if (!GROQ_KEY) return res.status(500).json({ error: 'Configurá GROQ_API_KEY o GEMINI_API_KEY en Vercel.' });
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 800, messages: req.body.messages })
        });
        const d = await r.json();
        text = d.choices?.[0]?.message?.content || '';
      } catch(e) {}
    } else {
      try {
        const bodyPayload = {
          contents: req.body.messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          })),
          generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
          tools: [{ google_search: {} }]
        };
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload) }
        );
        const d = await r.json();
        if (r.ok) {
          text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
        } else {
          // Gemini falló, fallback a Groq
          if (GROQ_KEY) {
            const r2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
              body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 800, messages: req.body.messages })
            });
            const d2 = await r2.json();
            text = d2.choices?.[0]?.message?.content || '';
          }
        }
      } catch(e) {
        // Fallback a Groq
        if (GROQ_KEY) {
          try {
            const r2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
              body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 800, messages: req.body.messages })
            });
            const d2 = await r2.json();
            text = d2.choices?.[0]?.message?.content || '';
          } catch(e2) {}
        }
      }
    }
  }

  // ── GROQ para generación de contenido (useSearch=false) ─────────────
  if (!useSearch) {
    if (!GROQ_KEY) {
      return res.status(500).json({
        error: 'GROQ_API_KEY no configurada. Vercel → Settings → Environment Variables. Conseguís la key gratis en console.groq.com'
      });
    }
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 2048,
          temperature: 0.9,
          messages: req.body.messages
        })
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.error?.message || JSON.stringify(d) });
      text = d.choices?.[0]?.message?.content || '';
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (saveKey && REDIS_URL && REDIS_TOKEN && text) {
    await redisSet(saveKey, text);
  }

  return res.status(200).json({ content: [{ type: 'text', text }] });
}
