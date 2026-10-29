'use strict';
/* POST /api/consecutivo   { "tipo": "PREVENTIVO" | "CORRECTIVO" | "REVISION" }
   → 200 { ok: true, tipo: "PREVENTIVO", consecutivo: "PRE0001" }
   Cada tipo lleva su propia numeración (PRE0001…, COR0001…, REV0001…). El número lo asigna Postgres de forma
   atómica (función generar_consecutivo_rutina), así que nunca se repite aunque lleguen peticiones simultáneas. */
const { TIPOS, send, guard, readJson, supabaseRpc } = require('./_lib/common');

module.exports = async function handler(req, res) {
  if (!guard(req, res, { methods: ['POST'], name: 'consecutivo', max: 30, windowMs: 60000 })) return;
  try {
    const body = await readJson(req, 10 * 1024);
    const tipo = String(body.tipo || body.tipo_rutina || '').trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(TIPOS, tipo)) {
      return send(res, 400, { ok: false, error: 'tipo inválido.', permitidos: Object.keys(TIPOS) });
    }
    let consecutivo = await supabaseRpc('generar_consecutivo_rutina', { p_tipo: tipo });
    if (Array.isArray(consecutivo)) consecutivo = consecutivo[0];
    if (typeof consecutivo !== 'string' || !new RegExp('^' + TIPOS[tipo] + '\\d{4,}$').test(consecutivo)) {
      console.error('[consecutivo] Respuesta inesperada del RPC:', consecutivo);
      return send(res, 502, { ok: false, error: 'La base de datos devolvió un consecutivo inválido.' });
    }
    return send(res, 200, { ok: true, tipo, consecutivo });
  } catch (err) {
    const status = err && err.status && err.status >= 400 && err.status < 600 ? err.status : (err instanceof SyntaxError ? 400 : 500);
    console.error('[consecutivo]', err && err.message, err && err.detail || '');
    return send(res, status, { ok: false, error: status === 400 ? (err instanceof SyntaxError ? 'JSON inválido.' : err.message) : 'No se pudo generar el consecutivo.' });
  }
};
