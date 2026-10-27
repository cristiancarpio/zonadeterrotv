export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!groqKey && !geminiKey) {
      return res.status(500).json({ error: 'Faltan GROQ_API_KEY y GEMINI_API_KEY en Vercel' });
    }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { prompt, system } = body || {};
    if (!prompt) return res.status(400).json({ error: 'Falta el prompt' });

    const errores = [];
    const t0 = Date.now();
    const quedaTiempo = () => Date.now() - t0 < 40000;

    if (groqKey) {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: prompt });

      for (const model of ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant']) {
        if (!quedaTiempo()) break;
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
            body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 5000 }),
            signal: AbortSignal.timeout(20000)
          });
          const data = await r.json();
          if (!r.ok) { errores.push('groq/' + model + ': ' + (data.error?.message || r.status)); continue; }
          const text = data.choices?.[0]?.message?.content;
          if (text) return res.status(200).json({ text });
          errores.push('groq/' + model + ': respuesta vacía');
        } catch (e) {
          errores.push('groq/' + model + ': ' + e.message);
        }
      }
    }

    if (geminiKey) {
      for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
        if (!quedaTiempo()) break;
        try {
          const reqBody = {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 8000 }
          };
          if (system) reqBody.systemInstruction = { parts: [{ text: system }] };

          const r = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
              body: JSON.stringify(reqBody),
              signal: AbortSignal.timeout(25000)
            }
          );
          const data = await r.json();
          if (!r.ok) { errores.push('gemini/' + model + ': ' + (data.error?.message || r.status)); continue; }
          const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('');
          if (text) return res.status(200).json({ text });
          errores.push('gemini/' + model + ': respuesta vacía');
        } catch (e) {
          errores.push('gemini/' + model + ': ' + e.message);
        }
      }
    }

    return res.status(500).json({ error: errores.join(' | ').substring(0, 500) || 'Sin respuesta de ningún modelo' });
  } catch (e) {
    return res.status(500).json({ error: 'Crash: ' + e.message });
  }
}
