
    (function () {
        const TABS = ['admin-dashboard','admin-clients','admin-users','admin-planning','admin-agenda','admin-caja','admin-history','admin-attendance','admin-equipment','admin-tools','admin-transports','admin-overtime','admin-billing','admin-financial','admin-settings'];
        const META = {
            'admin-dashboard': ['Panel', 'Panel Principal'], 'admin-clients': ['Gestión', 'Gestión de Clientes'],
            'admin-users': ['Gestión', 'Gestión de Usuarios'], 'admin-planning': ['Operación', 'Programación'],
            'admin-agenda': ['Operación', 'Agenda de Gestión'], 'admin-caja': ['Finanzas', 'Caja Menor'],
            'admin-history': ['Operación', 'Histórico & Avance Global'], 'admin-attendance': ['Operación', 'Asistencia & GPS'], 'admin-equipment': ['Gestión', 'Gestión de Equipos'],
            'admin-tools': ['Operación', 'Recogida de Herramientas'],
            'admin-transports': ['Operación', 'Transportes'],
            'admin-overtime': ['Operación', 'Horas Extras'],
            'admin-billing': ['Finanzas', 'Facturación'], 'admin-financial': ['Finanzas', 'Finanzas'], 'admin-settings': ['Sistema', 'Configuración']
        };
        const $ = id => document.getElementById(id);
        const safe = fn => { try { fn(); } catch (e) { console.warn('UI layer:', e); } };

        function currentTab() {
            const s = [...document.querySelectorAll('main > section')].find(x => !x.classList.contains('hidden'));
            return s ? s.id.replace('view-', '') : null;
        }
        function syncNav() {
            const tab = currentTab(); if (!tab) return;
            const m = META[tab] || ['Panel', tab];
            if ($('topbar-section')) $('topbar-section').textContent = m[0];
            if ($('topbar-page-title')) $('topbar-page-title').textContent = m[1];
            const links = [...document.querySelectorAll('#sidebar-nav-list a')];
            links.forEach(a => a.removeAttribute('aria-current'));
            let idx = links.findIndex(a => a.dataset && a.dataset.tab === tab);
            if (idx < 0 && links.length === 1) idx = 0;
            if (links[idx]) links[idx].setAttribute('aria-current', 'page');
            const changed = tab !== syncNav._last; syncNav._last = tab;
            document.querySelectorAll('#sidebar-nav-list .nav-group').forEach(g => {
                const has = !!g.querySelector('a[aria-current="page"]');
                g.classList.toggle('has-active', has);
                if (has && changed && !g.classList.contains('open')) {
                    g.classList.add('open');
                    const bt = g.querySelector('.nav-group-btn'); if (bt) bt.setAttribute('aria-expanded', 'true');
                }
            });
        }
        window.hvacSyncUser = function () { syncUser(); };
        function syncUser() {
            const user = activeUser && systemUsers.find(x => String(x.id) === String(activeUser));
            const name = user ? (user.name || user.username || '') : '';
            const parts = name.trim().split(/\s+/).filter(w => !/^(ing|dr|dra|lic|director)\.?$/i.test(w));
            const ini = ((parts[0] || '?')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
            if ($('topbar-avatar')) $('topbar-avatar').textContent = ini;
            const h = new Date().getHours();
            const sal = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
            if ($('hero-greet')) $('hero-greet').textContent = name ? `${sal}, ${name}` : 'Panel de control';
            if ($('hero-date')) $('hero-date').textContent = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        }
        function syncDist() {
            const n = id => parseInt(($(id) || {}).textContent, 10) || 0;
            const p = n('kpi-dash-prog'), d = n('kpi-dash-done'), b = n('kpi-dash-bill');
            const t = Math.max(p + d + b, 0);
            const bar = $('dist-bar'); if (!bar) return;
            const segs = bar.children, vals = [p, d, b];
            for (let i = 0; i < 3; i++) segs[i].style.width = (t ? (vals[i] / t * 100) : 0) + '%';
            $('dist-total').textContent = n('kpi-dash-total');
            $('dist-prog').textContent = p; $('dist-done').textContent = d; $('dist-bill').textContent = b;
        }

        function init() {
            const main = document.querySelector('main');
            if (main) new MutationObserver(() => safe(syncNav)).observe(main, { attributes: true, attributeFilter: ['class'], subtree: true });
            const nav = $('sidebar-nav-list');
            if (nav) new MutationObserver(() => safe(syncNav)).observe(nav, { childList: true });
            const w = $('header-user-welcome');
            if (w) new MutationObserver(() => safe(syncUser)).observe(w, { childList: true, characterData: true, subtree: true });
            ['kpi-dash-total','kpi-dash-prog','kpi-dash-done','kpi-dash-bill'].forEach(id => {
                const el = $(id);
                if (el) new MutationObserver(() => safe(syncDist)).observe(el, { childList: true, characterData: true, subtree: true });
            });
            safe(syncNav); safe(syncUser); safe(syncDist);
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    })();
    