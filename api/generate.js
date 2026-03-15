export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'API key no configurada. Andá a Vercel → Settings → Environment Variables → agregá ANTHROPIC_API_KEY. La conseguís en console.anthropic.com'
    });
  }

  const useSearch = req.body.useSearch || false;

  try {
    const body = {
      // Haiku para tendencias (más rápido, menos tokens, suficiente para JSON)
      // Sonnet para generación de contenido (mejor calidad)
      model: useSearch ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514',
      max_tokens: useSearch ? 800 : 1500,
      messages: req.body.messages
    };

    if (useSearch) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    if (useSearch) {
      headers['anthropic-beta'] = 'web-search-2025-03-05';
    }

    const fetchWithRetry = async (retries = 3, delay = 8000) => {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (response.status === 429 && retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(retries - 1, delay + 4000);
      }
      return response;
    };

    const response = await fetchWithRetry();

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return res.status(200).json({
      content: [{ type: 'text', text }]
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
