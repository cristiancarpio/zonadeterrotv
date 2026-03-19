export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: 'GROQ_API_KEY no configurada en Vercel' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Falta el prompt' });

  const MODELS = [
    'llama-3.3-70b-versatile',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
  ];

  const errors = [];

  for (const model of MODELS) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
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
