
/* Vacía ambas colas del técnico: operaciones de nube y marcaciones/fotos/Telegram en IndexedDB. */
window.HVAC_UPDATE_SYNC = async function () {
  try { if (typeof hvacStorageReady !== 'undefined') await hvacStorageReady; } catch (_) {}
  try { if (typeof hvacFlushStorageWrites === 'function') await hvacFlushStorageWrites(); } catch (_) {}
  if (typeof cloudFlushOutbox === 'function') await cloudFlushOutbox();
  if (typeof auditEnviarCola === 'function') await auditEnviarCola();
  if (typeof mxFlushQueue === 'function') await mxFlushQueue();
  try { if (typeof hvacFlushStorageWrites === 'function') await hvacFlushStorageWrites(); } catch (_) {}
};
