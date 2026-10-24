// Vercel Serverless Function: genera una URL firmada (SigV4) para que el navegador suba la imagen DIRECTO a Cloudflare R2.
// Variables de entorno (Vercel → Settings → Environment Variables):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE  (ej. https://pub-xxxx.r2.dev)
//   ALLOWED_ORIGINS (opcional, separados por coma: https://tu-app.vercel.app)
const crypto = require('crypto');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha256 = d => crypto.createHash('sha256').update(d).digest('hex');
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const KEY_RE = /^(reportes|equipos|firmas|comprobantes|asistencia|otros)\/[A-Za-z0-9_\-\/]{1,160}\.(jpg|png|webp)$/;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin || '';
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length && origin && !allowed.includes(origin)) return res.status(403).json({ ok: false, error: 'origen no permitido' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { R2_ACCOUNT_ID: acc, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET: bucket, R2_PUBLIC_BASE: pub } = process.env;
  if (!acc || !ak || !sk || !bucket || !pub) return res.status(503).json({ ok: false, error: 'R2 no configurado' });

  const { key, contentType, size } = req.body || {};
  if (!KEY_RE.test(String(key || '')) || String(key).includes('..')) return res.status(400).json({ ok: false, error: 'ruta inválida' });
  if (!TYPES.includes(contentType)) return res.status(400).json({ ok: false, error: 'tipo no permitido' });
  if (!(Number(size) > 0 && Number(size) <= 3 * 1024 * 1024)) return res.status(400).json({ ok: false, error: 'tamaño no permitido (máx. 3 MB)' });

  const host = `${acc}.r2.cloudflarestorage.com`;
  const uri = '/' + bucket + '/' + String(key).split('/').map(enc).join('/');
  const now = new Date(), amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${ak}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': '300', 'X-Amz-SignedHeaders': 'content-type;host' };
  const qs = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonical = ['PUT', uri, qs, `content-type:${contentType}\nhost:${host}\n`, 'content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + sk, date), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  res.status(200).json({ ok: true, uploadUrl: `https://${host}${uri}?${qs}&X-Amz-Signature=${signature}`, publicUrl: pub.replace(/\/+$/, '') + '/' + key });
};
