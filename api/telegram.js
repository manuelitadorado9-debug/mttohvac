// Vercel Serverless Function (opcional y recomendada): mantiene el token del bot fuera del navegador.
// Variables de entorno en Vercel → Settings → Environment Variables: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Para usarla: en tecnico.html pon  TG.USE_PROXY = true
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { text } = req.body || {};
  if (!text || String(text).length > 3500) return res.status(400).json({ ok: false, description: 'texto inválido' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
    });
    return res.status(r.status).json(await r.json());
  } catch (e) { return res.status(502).json({ ok: false, description: 'telegram no disponible' }); }
}
