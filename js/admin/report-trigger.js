
(() => {
  'use strict';
  let busy = false;

  function reportError(error) {
    const msg = 'No se pudo generar el informe: ' + (error && error.message ? error.message : String(error));
    console.error('Error al generar informe HVAC:', error);
    if (typeof showToast === 'function') showToast(msg, 'error');
    else alert(msg);
  }

  // Cada tipo de informe se enruta a su propio generador.
  const ROUTES = {
    REVISION: () => window.generateRevisionPDF,
    PREVENTIVO: () => window.generatePreventivoPDF,
    CORRECTIVO: () => window.generateCorrectivoPDF
  };

  // Los botones "Informe General", "Informe Correctivos" y "PDF de este Equipo" de la rutina
  // usaban un generador anterior: ahora usan los mismos formatos oficiales (PRE / COR / REV).
  const findOrder = id => {
    const orders = (typeof workOrders !== 'undefined' && Array.isArray(workOrders)) ? workOrders : [];
    return orders.find(o => String(o.id) === String(id));
  };
  window.generateConsolidatedRoutinePDFDirect = async function(onlyCorrective = false) {
    if (busy) return;
    busy = true;
    const id = (typeof currentExecOrderId !== 'undefined') ? currentExecOrderId : null;
    const order = findOrder(id);
    if (!order) { busy = false; return; }
    try {
      const typeKey = onlyCorrective ? 'CORRECTIVO' : window.hvacOrderReportType(order);
      await window.generateMaintenancePDF(order.id, typeKey, { onlyCorrective: !!onlyCorrective });
    } catch (error) { reportError(error); }
    finally { busy = false; }
  };
  window.generateSingleEquipmentPDF = async function(orderId, eqId) {
    if (busy) return;
    busy = true;
    const order = findOrder(orderId);
    if (!order) { busy = false; return; }
    try {
      await window.generateMaintenancePDF(order.id, window.hvacOrderReportType(order), { only: [eqId] });
    } catch (error) { reportError(error); }
    finally { busy = false; }
  };

  window.hvacGenerateOrderReport = async function(orderId, reportType) {
    if (busy) return;
    busy = true;
    try {
      if (typeof window.generateMaintenancePDF !== 'function') {
        throw new Error('El generador de informes no está disponible. Recarga la página.');
      }
      // No esperar aquí a la descarga de datos: el generador inicia el canal de descarga
      // síncronamente dentro del toque y luego carga el detalle completo de la orden.
      let typeKey = window.hvacNormalizeReportType(reportType);
      if (!typeKey) {
        const orders = (typeof workOrders !== 'undefined' && Array.isArray(workOrders)) ? workOrders : [];
        const order = orders.find(o => String(o.id) === String(orderId));
        typeKey = order ? window.hvacOrderReportType(order) : 'REVISION';
      }
      const generator = ROUTES[typeKey] && ROUTES[typeKey]();
      if (typeof generator !== 'function') throw new Error('Tipo de informe no soportado: ' + typeKey);
      await generator(orderId);
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  };
})();
