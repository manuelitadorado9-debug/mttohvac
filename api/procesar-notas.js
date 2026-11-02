/**
 * POST /api/ia/procesar-notas
 * Convierte el relato coloquial del técnico en:
 *   - observaciones técnicas (párrafos formales)
 *   - conclusiones (estado general / si requiere correctivo)
 *   - lecturas (voltaje, amperaje, presión) si fueron dictadas
 *
 * 100 % GRATIS: usa la capa gratuita de Google Gemini (clave de https://aistudio.google.com/apikey,
 * sin tarjeta) y las funciones gratuitas de Vercel.
 *
 * Variables de entorno en Vercel (Settings > Environment Variables):
 *   GEMINI_API_KEY   (obligatoria)  clave de Google AI Studio
 *   GEMINI_MODEL     (opcional)     por defecto "gemini-2.0-flash"
 */
const MODELS_FALLBACK = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];

const SYSTEM = `Eres un ingeniero de mantenimiento HVAC (aire acondicionado y ventilación) que redacta informes técnicos en español de Colombia.
Recibirás el relato coloquial de un técnico de campo. Devuelve SOLO JSON con estos campos:
- notas_analiticas: observaciones técnicas en 1 a 3 párrafos separados por una línea en blanco. Tono formal, impersonal y claro ("se encontró", "se evidenció", "se recomienda"). Conserva TODOS los hechos del relato; no inventes fallas, repuestos, causas ni valores.
- conclusion: 2 a 4 oraciones con el estado general del equipo (operativo, operativo con observaciones o fuera de servicio) y si requiere correctivo y cuál, según lo dicho por el técnico.
- voltaje: número en voltios solo si el técnico lo dijo; si no, cadena vacía.
- amperaje: número en amperios solo si lo dijo; si no, cadena vacía.
- presion: texto corto como "Succión 68 PSI, descarga 250 PSI" solo si lo dijo; si no, cadena vacía.
- requiere_correctivo: true únicamente si el relato indica una falla, daño o necesidad de cambio/reparación; de lo contrario false.
- descripcion_correctivo: si requiere_correctivo es true, una frase formal con el trabajo requerido; si no, cadena vacía.
Nunca agregues cifras que no estén en el relato.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    notas_analiticas: { type: 'STRING' },
    conclusion: { type: 'STRING' },
    voltaje: { type: 'STRING' },
    amperaje: { type: 'STRING' },
    presion: { type: 'STRING' },
    requiere_correctivo: { type: 'BOOLEAN' },
    descripcion_correctivo: { type: 'STRING' }
  },
  required: ['notas_analiticas', 'conclusion', 'voltaje', 'amperaje', 'presion', 'requiere_correctivo', 'descripcion_correctivo']
};

const norm = t => String(t || '').replace(/(\d),(\d)/g, '$1.$2');
const numbersOf = t => (norm(t).match(/\d+(?:\.\d+)?/g) || []);

function parseJson(text) {
  const clean = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(clean);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(501).json({ error: 'Falta GEMINI_API_KEY en las variables de entorno de Vercel.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const notas = String((body && body.notas_brutas) || '').trim().slice(0, 4000);
  const tipo = String((body && body.tipo_servicio) || 'REVISION').toUpperCase();
  if (notas.length < 5) return res.status(400).json({ error: 'Escribe o dicta las notas del técnico.' });

  const models = [process.env.GEMINI_MODEL, ...MODELS_FALLBACK].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
  let lastError = 'No se pudo contactar el servicio de IA.';

  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Tipo de servicio: ${tipo}\n\nRelato del técnico:\n${notas}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: 'application/json', responseSchema: SCHEMA }
        })
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 429) return res.status(429).json({ error: 'Se alcanzó el límite gratuito de la IA. Intenta de nuevo en un minuto.' });
      if (r.status === 400 && /API key/i.test(JSON.stringify(data))) return res.status(401).json({ error: 'Clave de IA inválida: revisa GEMINI_API_KEY en Vercel.' });
      if (r.status === 401 || r.status === 403) return res.status(401).json({ error: 'La clave de IA no tiene permiso o es inválida.' });
      if (!r.ok) { lastError = (data.error && data.error.message) || `Error ${r.status} del modelo ${model}`; continue; }  // prueba el siguiente modelo

      const text = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
        ? data.candidates[0].content.parts.map(p => p.text || '').join('') : '';
      const out = parseJson(text);

      // Seguridad: lecturas extraídas solo si realmente aparecen en el relato
      const inputNums = new Set(numbersOf(notas));
      const keepNum = v => { const n = norm(v).trim(); return /^\d{1,4}(\.\d+)?$/.test(n) && inputNums.has(n) ? n : ''; };
      const presion = String(out.presion || '').trim();
      const presionOk = presion && numbersOf(presion).every(n => inputNums.has(n)) ? presion.slice(0, 80) : '';

      // Aviso si el texto generado contiene cifras que el técnico no dijo
      const generated = `${out.notas_analiticas || ''} ${out.conclusion || ''}`;
      const advertencia = [...new Set(numbersOf(generated).filter(n => !inputNums.has(n)))];

      return res.status(200).json({
        notas_analiticas: String(out.notas_analiticas || '').trim(),
        conclusion: String(out.conclusion || '').trim(),
        voltaje: keepNum(out.voltaje),
        amperaje: keepNum(out.amperaje),
        presion: presionOk,
        requiere_correctivo: out.requiere_correctivo === true,
        descripcion_correctivo: String(out.descripcion_correctivo || '').trim(),
        advertencia_numeros: advertencia,
        fuente: 'ia'
      });
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
    }
  }
  return res.status(502).json({ error: lastError });
};
