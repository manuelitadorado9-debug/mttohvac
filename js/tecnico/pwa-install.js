/* =====================================================================
   pwa-install.js · Instalación en pantalla de inicio
   – Android : captura el evento beforeinstallprompt y muestra un botón.
   – iOS/iPadOS : Safari no dispara beforeinstallprompt; se detecta con
     navigator.standalone y se muestra un instructivo con los pasos.
   El aviso se cierra definitivamente si el usuario lo descarta, y no
   vuelve a aparecer una vez que la app se abre desde el icono.
   ===================================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'HVAC_PWA_INSTALL_DISMISSED';
  const RESHOW_DAYS = 30; // si descartó, volver a preguntar después de N días

  // Ya está instalada como PWA → no mostrar nada
  const isStandalone =
    window.navigator.standalone === true ||                       // iOS Safari
    window.matchMedia('(display-mode: standalone)').matches ||    // Android / Chrome
    window.matchMedia('(display-mode: fullscreen)').matches;

  if (isStandalone) return;

  // ¿El usuario ya descartó el banner y aún no pasaron RESHOW_DAYS días?
  function wasDismissedRecently() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (!val) return false;
      return Date.now() - Number(val) < RESHOW_DAYS * 86400000;
    } catch (_) { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
  }

  // ------------------------------------------------------------------ //
  //  Detección de plataforma                                            //
  // ------------------------------------------------------------------ //
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad con iPadOS 13+
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const isAndroidChrome = /Android/i.test(ua) && /Chrome\/[0-9]/i.test(ua);

  // ------------------------------------------------------------------ //
  //  Estilos del banner                                                 //
  // ------------------------------------------------------------------ //
  const style = document.createElement('style');
  style.textContent = `
    #hvac-pwa-banner {
      position: fixed;
      bottom: calc(80px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%) translateY(0);
      width: calc(100% - 32px);
      max-width: 400px;
      background: var(--surface, #131f3c);
      border: 1.5px solid var(--line, #26385f);
      border-radius: 20px;
      box-shadow: 0 16px 40px -12px rgba(0,0,0,.7);
      padding: 16px 16px 14px;
      z-index: 9000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      animation: hvacPwaBannerIn .28s cubic-bezier(.22,.68,0,1.2) both;
    }
    @keyframes hvacPwaBannerIn {
      from { opacity: 0; transform: translateX(-50%) translateY(24px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    #hvac-pwa-banner .pwa-head {
      display: flex;
      align-items: center;
      gap: 11px;
    }
    #hvac-pwa-banner .pwa-icon {
      width: 44px; height: 44px; border-radius: 12px; flex: none;
      background: linear-gradient(135deg,#3b82f6,#6366f1);
      display: grid; place-items: center;
      font-size: 22px; color: #fff;
      box-shadow: 0 6px 14px -6px rgba(59,130,246,.8);
    }
    #hvac-pwa-banner .pwa-texts { flex: 1; min-width: 0; }
    #hvac-pwa-banner .pwa-title {
      font-size: 13.5px; font-weight: 800;
      color: var(--text, #eaf0ff); line-height: 1.25;
    }
    #hvac-pwa-banner .pwa-sub {
      font-size: 11.5px; font-weight: 600;
      color: var(--muted, #93a5cf); margin-top: 2px;
    }
    #hvac-pwa-banner .pwa-close {
      position: absolute; top: 10px; right: 12px;
      font-size: 15px; color: var(--muted, #93a5cf);
      line-height: 1; padding: 4px; cursor: pointer;
      background: none; border: none;
    }
    /* Steps (iOS) */
    #hvac-pwa-banner .pwa-steps {
      display: flex; flex-direction: column; gap: 7px;
      background: var(--bg-2, #0f1a33);
      border-radius: 13px; padding: 12px 13px;
    }
    #hvac-pwa-banner .pwa-step {
      display: flex; align-items: center; gap: 9px;
      font-size: 12.5px; font-weight: 600; color: var(--text, #eaf0ff);
    }
    #hvac-pwa-banner .pwa-step-num {
      width: 22px; height: 22px; border-radius: 50%; flex: none;
      background: var(--primary, #3b82f6); color: #fff;
      font-size: 11px; font-weight: 900;
      display: grid; place-items: center;
    }
    #hvac-pwa-banner .pwa-step em {
      font-style: normal;
      background: var(--surface-2, #1a2a4f);
      border: 1px solid var(--line, #26385f);
      border-radius: 6px; padding: 1px 7px;
      font-size: 11.5px; color: var(--accent, #fbbf24);
      white-space: nowrap;
    }
    /* Botón Android */
    #hvac-pwa-banner .pwa-btn {
      display: flex; align-items: center; justify-content: center;
      gap: 8px; min-height: 48px; border-radius: 15px;
      background: linear-gradient(135deg,#3b82f6,#1d5fd6);
      color: #fff; font-size: 13px; font-weight: 800;
      border: none; cursor: pointer; width: 100%;
      box-shadow: 0 10px 22px -10px rgba(59,130,246,.85);
      transition: transform .12s;
    }
    #hvac-pwa-banner .pwa-btn:active { transform: scale(.97); }
  `;
  document.head.appendChild(style);

  // ------------------------------------------------------------------ //
  //  Banner iOS                                                         //
  // ------------------------------------------------------------------ //
  function showIosBanner() {
    if (wasDismissedRecently()) return;
    if (!isIOS || !isSafari) return; // solo Safari en iOS puede instalar
    if (document.getElementById('hvac-pwa-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'hvac-pwa-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar aplicación en pantalla de inicio');
    banner.innerHTML = `
      <button class="pwa-close" aria-label="Cerrar" id="hvac-pwa-close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="pwa-head">
        <div class="pwa-icon"><i class="fa-solid fa-snowflake"></i></div>
        <div class="pwa-texts">
          <div class="pwa-title">Instalar HVAC Campo</div>
          <div class="pwa-sub">Ábrela como una app desde tu pantalla de inicio</div>
        </div>
      </div>
      <div class="pwa-steps">
        <div class="pwa-step">
          <div class="pwa-step-num">1</div>
          <span>Toca el botón <em><i class="fa-solid fa-arrow-up-from-bracket"></i> Compartir</em> en Safari</span>
        </div>
        <div class="pwa-step">
          <div class="pwa-step-num">2</div>
          <span>Elige <em><i class="fa-solid fa-plus-square"></i> Agregar a inicio</em></span>
        </div>
        <div class="pwa-step">
          <div class="pwa-step-num">3</div>
          <span>Pulsa <em>Agregar</em> — ¡listo!</span>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
    document.getElementById('hvac-pwa-close').addEventListener('click', dismissBanner);
  }

  // ------------------------------------------------------------------ //
  //  Banner Android                                                     //
  // ------------------------------------------------------------------ //
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!wasDismissedRecently()) showAndroidBanner();
  });

  function showAndroidBanner() {
    if (document.getElementById('hvac-pwa-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'hvac-pwa-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Instalar aplicación');
    banner.innerHTML = `
      <button class="pwa-close" aria-label="Cerrar" id="hvac-pwa-close">
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="pwa-head">
        <div class="pwa-icon"><i class="fa-solid fa-snowflake"></i></div>
        <div class="pwa-texts">
          <div class="pwa-title">Instalar HVAC Campo</div>
          <div class="pwa-sub">Acceso directo desde tu pantalla de inicio, sin abrir el navegador</div>
        </div>
      </div>
      <button class="pwa-btn" id="hvac-pwa-install-btn">
        <i class="fa-solid fa-download"></i> Instalar aplicación
      </button>
    `;
    document.body.appendChild(banner);
    document.getElementById('hvac-pwa-close').addEventListener('click', dismissBanner);
    document.getElementById('hvac-pwa-install-btn').addEventListener('click', triggerAndroidInstall);
  }

  async function triggerAndroidInstall() {
    if (!deferredPrompt) return;
    const btn = document.getElementById('hvac-pwa-install-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Abriendo…'; }
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        removeBanner();
      } else {
        markDismissed();
        removeBanner();
      }
    } catch (_) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-download"></i> Instalar aplicación'; }
    }
    deferredPrompt = null;
  }

  // La app fue instalada desde otro flujo (menú del navegador, etc.)
  window.addEventListener('appinstalled', removeBanner);

  // ------------------------------------------------------------------ //
  //  Helpers comunes                                                    //
  // ------------------------------------------------------------------ //
  function dismissBanner() {
    markDismissed();
    removeBanner();
  }

  function removeBanner() {
    const el = document.getElementById('hvac-pwa-banner');
    if (el) {
      el.style.transition = 'opacity .2s, transform .2s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(16px)';
      setTimeout(() => el.remove(), 220);
    }
  }

  // ------------------------------------------------------------------ //
  //  Lanzar iOS al cargar (después de que el DOM esté listo)           //
  // ------------------------------------------------------------------ //
  if (isIOS && isSafari) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(showIosBanner, 2500); // dar tiempo al login
      });
    } else {
      setTimeout(showIosBanner, 2500);
    }
  }

  // Si iOS pero no Safari (Chrome en iOS, Firefox en iOS, etc.) —
  // esos navegadores tampoco permiten instalar PWA desde la web;
  // no mostramos nada porque no hay acción posible para el usuario.

})();
