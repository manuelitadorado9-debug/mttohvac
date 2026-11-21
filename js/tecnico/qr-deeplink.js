
/* ===== Enlace del QR: tecnico.html?eq=<ID del equipo> =====
   Si el técnico no ha iniciado sesión, el equipo queda pendiente y se abre apenas ingrese. */
(function () {
  const KEY = 'HVAC_PENDING_EQ';
  try {
    const p = new URLSearchParams(location.search), eq = (p.get('eq') || '').trim();
    if (eq) {
      sessionStorage.setItem(KEY, eq);
      p.delete('eq');
      const q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
  } catch (_) {}
  const pending = () => { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } };
  let running = false;
  async function run() {
    if (running) return;
    const key = pending(); if (!key) return;
    if (!(typeof sessionAuthenticated !== 'undefined' && sessionAuthenticated && restoreActiveSession())) return;
    running = true;
    try { sessionStorage.removeItem(KEY); } catch (_) {}
    try {
      showToast('Buscando la rutina de este equipo…');
      try { if (cloudCtl.loading && cloudCtl.loading.promise) await Promise.race([cloudCtl.loading.promise.catch(() => {}), new Promise(r => setTimeout(r, 8000))]); } catch (_) {}
      await mxHandleCode(key);
    } catch (err) {
      console.warn('[QR]', err);
      mxQ('mx-block-title').textContent = 'No se pudo abrir el equipo';
      mxQ('mx-block-body').textContent = 'No fue posible consultar la rutina de este equipo. Revisa tu conexión e inténtalo de nuevo escaneando el QR.';
      mxOpen('mx-block');
    } finally { running = false; }
  }
  setInterval(run, 600);
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    run();
    if (pending() && !(typeof sessionAuthenticated !== 'undefined' && sessionAuthenticated)) showToast('Inicia sesión para abrir la rutina del equipo escaneado.');
  }, 900));
})();
