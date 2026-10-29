'use strict';
/* POST /api/consecutivo   { "tipo": "PREVENTIVO" | "CORRECTIVO", "base"?: "PRE-0007" }
   → 200 { ok: true, tipo: "PREVENTIVO", consecutivo: "PRE-0007" }
   Mismo formato y misma función SQL que usa la app (index.html): PRE-0001…, COR-0001… vía RPC generar_consecutivo,
   que asigna el número de forma atómica y nunca repite aunque lleguen peticiones simultáneas.

   Zonas / pisos: con "base" (un consecutivo ya emitido, p. ej. "PRE-0007") NO se consume un número nuevo; se devuelve
   la siguiente parte de ese mismo cliente y periodo → { consecutivo: "PRE-0007-P2", base: "PRE-0007", parte: 2 }.
   La parte se calcula con las órdenes existentes en hvac_orders; no reserva el id, así que la orden debe guardarse
   enseguida (la app ya calcula las partes localmente con la misma regla). */
const { send, guard, readJson, supabaseRpc, supabaseSelect } = require('./_lib/common');

const PREFIJOS = { PREVENTIVO: 'PRE-', CORRECTIVO: 'COR-' };

module.exports = async function handler(req, res) {
  if (!guard(req, res, { methods: ['POST'], name: 'consecutivo', max: 30, windowMs: 60000 })) return;
  try {
    const body = await readJson(req, 10 * 1024);
    const base = String(body.base || '').trim().toUpperCase();

    if (base) {
      const m = /^(PRE|COR)-(\d{4,})$/.exec(base);
      if (!m) return send(res, 400, { ok: false, error: 'base inválida (formato esperado: PRE-0007 o COR-0007).' });
      const rows = await supabaseSelect(`hvac_orders?id=like.${encodeURIComponent(base + '-P*')}&select=id&limit=1000`);
      const re = new RegExp('^' + base + '-P(\\d+)$');
      const parte = (Array.isArray(rows) ? rows : []).reduce((max, r) => { const k = re.exec(String(r.id || '')); return k ? Math.max(max, parseInt(k[1], 10)) : max; }, 0) + 1;
      return send(res, 200, { ok: true, tipo: m[1] === 'PRE' ? 'PREVENTIVO' : 'CORRECTIVO', base, parte, consecutivo: `${base}-P${parte}` });
    }

    const tipo = String(body.tipo || body.tipo_rutina || '').trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(PREFIJOS, tipo)) {
      return send(res, 400, { ok: false, error: 'tipo inválido.', permitidos: Object.keys(PREFIJOS) });
    }
    let consecutivo = await supabaseRpc('generar_consecutivo', { p_tipo: tipo });
    if (Array.isArray(consecutivo)) consecutivo = consecutivo[0];
    if (typeof consecutivo !== 'string' || !new RegExp('^' + PREFIJOS[tipo] + '\\d{4,}$').test(consecutivo)) {
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
