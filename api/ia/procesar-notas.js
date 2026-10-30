const SYSTEM_PROMPT = `Eres un ingeniero de mantenimiento HVAC que redacta informes técnicos en español.
Convierte las notas informales del técnico en párrafos analíticos, técnicos y formales.
Reglas:
- Corrige ortografía, gramática y puntuación.
- Conserva EXACTAMENTE todos los datos numéricos, unidades, códigos y seriales tal como aparecen.
- No inventes mediciones, causas, repuestos ni acciones que no estén en las notas.
- Usa redacción impersonal y terminología técnica adecuada al tipo de servicio.
- Devuelve únicamente el texto final en párrafos, sin títulos, listas ni comentarios.`;

const MAX_CHARS = 5000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const { notas_brutas, tipo_servicio } = req.body || {};
    const notas = String(notas_brutas || '').trim();

    if (!notas) return res.status(400).json({ error: 'notas_brutas es requerido' });
    if (notas.length > MAX_CHARS)
      return res.status(400).json({ error: `Máximo ${MAX_CHARS} caracteres` });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1500,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Tipo de servicio: ${tipo_servicio || 'No especificado'}\n\nNotas del técnico:\n${notas}`,
        }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'Error en la API de IA');

    const notas_analiticas = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // Verifica que ningún dato numérico se haya perdido o alterado
    const nums = notas.match(/\d+(?:[.,]\d+)?/g) || [];
    const faltantes = [...new Set(nums)].filter((n) => !notas_analiticas.includes(n));

    return res.status(200).json({
      notas_analiticas,
      ...(faltantes.length && { advertencia_numeros: faltantes }),
    });
  } catch (e) {
    console.error('procesar-notas:', e);
    return res.status(500).json({ error: e.message });
  }
}
