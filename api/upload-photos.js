'use strict';
/* POST /api/upload-photos
   Recibe hasta 8 imágenes en base64, las sube a Cloudflare R2 y devuelve las URLs públicas definitivas.

   Body (JSON):
     { "orden": "PRE0001",
       "antes":   ["data:image/jpeg;base64,...", ...],      // → fotos_antes
       "despues": ["data:image/jpeg;base64,...", ...],      // → fotos_despues
       "fotos":   ["data:image/png;base64,...", {"data": "...", "etapa": "antes"}] }   // opcional, lista libre
     Entre todas las listas: mínimo 1 y máximo 8 imágenes.

   200 → { ok, orden, total, urls: [...en el mismo orden enviado], antes: [...], despues: [...], general: [...] }
   Las claves se calculan con el hash del contenido: reintentar la misma foto NO crea duplicados en R2.

   Variables de entorno (las mismas de /api/r2-sign): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE
   Opcionales: UPLOAD_REQUIRE_ORDER=1 (exige que la orden exista en Supabase y respeta el tope de 8 fotos por orden),
               SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (necesarias solo con la opción anterior), ALLOWED_ORIGINS.

   OJO · Vercel limita el cuerpo de una función a 4,5 MB: comprime en el cliente (≈1280 px, JPEG calidad 0,7 → 150-350 KB por foto). */
const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { send, guard, readJson, supabaseSelect } = require('./_lib/common');

const MAX_PHOTOS = 8;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;        // por imagen (ya decodificada)
const MAX_TOTAL_BYTES = 4.2 * 1024 * 1024;        // todo el lote decodificado
const MAX_BODY_BYTES = 6 * 1024 * 1024;           // tope propio si el cuerpo llega como flujo
const ETAPAS = ['antes', 'despues', 'general'];
const ORDEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;     // sin "/" ni "." → seguro para usarlo en la clave del objeto
const REQUIRED_ENV = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'];

let s3 = null;
function r2Client() {
  if (!s3) s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    // Las versiones recientes del SDK añaden checksums que R2 no necesita: se piden solo cuando son obligatorios.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
  });
  return s3;
}

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

/* El tipo REAL se determina por los primeros bytes (no por lo que declare el cliente): evita subir HTML/SVG disfrazados. */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { ext: 'png', type: 'image/png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

function decodeImage(raw, n) {
  if (typeof raw !== 'string') throw new HttpError(400, `Imagen #${n}: formato inválido (se esperaba una cadena base64).`);
  const head = /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.exec(raw.slice(0, 40));
  if (!head) throw new HttpError(400, `Imagen #${n}: debe ser un data URL base64 (jpeg, png o webp).`);
  const b64 = raw.slice(head[0].length).replace(/\s+/g, '');
  if (!b64 || b64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError(400, `Imagen #${n}: base64 inválido.`);
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, `Imagen #${n}: pesa ${(buf.length / 1048576).toFixed(1)} MB (máximo ${(MAX_IMAGE_BYTES / 1048576).toFixed(1)} MB). Comprímela antes de enviarla.`);
  const kind = sniff(buf);
  if (!kind) throw new HttpError(400, `Imagen #${n}: el contenido no es una imagen JPEG, PNG o WEBP válida.`);
  return { buf, ...kind };
}

function collect(body) {
  const items = [];
  const add = (list, etapa) => (Array.isArray(list) ? list : []).forEach(x => {
    if (x && typeof x === 'object') {
      const e = String(x.etapa || etapa || 'general').toLowerCase();
      items.push({ etapa: ETAPAS.includes(e) ? e : 'general', raw: x.data || x.dataUrl || x.base64 });
    } else items.push({ etapa, raw: x });
  });
  add(body.antes, 'antes');
  add(body.despues, 'despues');
  add(body.fotos, 'general');
  return items;
}

/* Con UPLOAD_REQUIRE_ORDER=1: la orden debe existir y (fotos ya guardadas + nuevas) ≤ 8. */
async function checkOrder(orden, nuevas) {
  const rows = await supabaseSelect(`ordenes_mantenimiento?numero_orden=eq.${encodeURIComponent(orden)}&select=id,fotos_antes,fotos_despues&limit=1`);
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(404, `La orden ${orden} no existe.`);
  const previas = (rows[0].fotos_antes || []).length + (rows[0].fotos_despues || []).length;
  if (previas + nuevas > MAX_PHOTOS) throw new HttpError(409, `La orden ya tiene ${previas} foto(s); con ${nuevas} más superaría el máximo de ${MAX_PHOTOS}.`, { fotos_actuales: previas, maximo: MAX_PHOTOS });
}

module.exports = async function handler(req, res) {
  if (!guard(req, res, { methods: ['POST'], name: 'upload-photos', max: 20, windowMs: 60000 })) return;
  try {
    const missing = REQUIRED_ENV.filter(k => !process.env[k]);
    if (missing.length) return send(res, 503, { ok: false, error: 'R2 no está configurado en Vercel.', faltan: missing });

    const body = await readJson(req, MAX_BODY_BYTES);
    const orden = String(body.orden || '').trim().toUpperCase();
    if (!ORDEN_RE.test(orden)) return send(res, 400, { ok: false, error: 'orden inválida (letras, números y guion; 3 a 40 caracteres).' });

    const items = collect(body);
    if (!items.length) return send(res, 400, { ok: false, error: 'No se recibió ninguna imagen.' });
    if (items.length > MAX_PHOTOS) return send(res, 400, { ok: false, error: `Máximo ${MAX_PHOTOS} imágenes por orden (recibidas: ${items.length}).` });

    let total = 0;
    const files = items.map((it, i) => {
      const f = decodeImage(it.raw, i + 1);
      total += f.buf.length;
      if (total > MAX_TOTAL_BYTES) throw new HttpError(413, `El lote pesa más de ${(MAX_TOTAL_BYTES / 1048576).toFixed(1)} MB. Comprime las fotos (≈1280 px, JPEG 0,7) o envíalas en dos lotes.`);
      const hash = crypto.createHash('sha256').update(f.buf).digest('hex').slice(0, 20);
      return { ...f, etapa: it.etapa, key: `ordenes/${orden}/${it.etapa}/${hash}.${f.ext}` };
    });

    if (process.env.UPLOAD_REQUIRE_ORDER === '1') await checkOrder(orden, files.length);

    const base = process.env.R2_PUBLIC_BASE.replace(/\/+$/, '');
    const results = await Promise.allSettled(files.map(f => r2Client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET, Key: f.key, Body: f.buf, ContentType: f.type, ContentLength: f.buf.length,
      CacheControl: 'public, max-age=31536000, immutable'
    }))));

    const urls = files.map(f => `${base}/${f.key}`);
    const failed = results.map((r, i) => r.status === 'rejected' ? i : -1).filter(i => i >= 0);
    if (failed.length) {
      failed.forEach(i => console.error('[upload-photos] Falló', files[i].key, results[i].reason && results[i].reason.name, results[i].reason && results[i].reason.message));
      // Las claves son por contenido: reintentar el lote completo es seguro (no duplica lo ya subido).
      return send(res, 502, {
        ok: false, error: `No se pudieron subir ${failed.length} de ${files.length} imagen(es) a R2.`,
        fallidas: failed.map(i => i + 1), subidas: files.map((f, i) => failed.includes(i) ? null : urls[i])
      });
    }

    const by = e => files.map((f, i) => f.etapa === e ? urls[i] : null).filter(Boolean);
    return send(res, 200, { ok: true, orden, total: urls.length, urls, antes: by('antes'), despues: by('despues'), general: by('general') });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { ok: false, error: err.message, ...(err.extra || {}) });
    if (err instanceof SyntaxError) return send(res, 400, { ok: false, error: 'JSON inválido.' });
    const status = err && err.status >= 400 && err.status < 600 ? err.status : 500;
    console.error('[upload-photos]', err && err.message);
    return send(res, status, { ok: false, error: status === 503 ? err.message : 'Error interno al procesar las imágenes.' });
  }
};
