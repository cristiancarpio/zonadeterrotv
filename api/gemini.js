export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurada en Vercel' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Falta el prompt' });

  const MODELS = [
    'google/gemini-2.0-flash-exp:free',
    'google/gemini-flash-1.5-8b:free',
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
  ];

  const errors = [];

  for (const model of MODELS) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://zona-terror-tv.vercel.app',
          'X-Title': 'Zona de Terror TV'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.9,
          max_tokens: 2048
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        errors.push(`${model}: ${msg}`);
        continue;
      }

      const text = data.choices?.[0]?.message?.content || '';
      if (!text) {
        errors.push(`${model}: respuesta vacía`);
        continue;
      }

      return res.status(200).json({ text, model });

    } catch (e) {
      errors.push(`${model}: ${e.message}`);
      continue;
    }
  }

  return res.status(500).json({ 
    error: 'Todos los modelos fallaron',
    details: errors
  });
}
