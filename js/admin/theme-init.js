
    (function () {
        function readSaved() { try { var t = localStorage.getItem('HVAC_THEME'); return (t === 'dark' || t === 'light') ? t : null; } catch (e) { return null; } }
        function systemTheme() { try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; } }
        function paint(t) {
            document.documentElement.setAttribute('data-theme', t);
            var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#070c19' : '#f1f4fa');
            ['light', 'dark'].forEach(function (k) { var b = document.getElementById('theme-btn-' + k); if (b) b.setAttribute('aria-pressed', String(k === t)); });
        }
        window.setTheme = function (t) {
            if (t !== 'dark' && t !== 'light') return;
            var root = document.documentElement; root.classList.add('theme-anim');
            paint(t);
            try { localStorage.setItem('HVAC_THEME', t); } catch (e) {}
            setTimeout(function () { root.classList.remove('theme-anim'); }, 400);
        };
        paint(readSaved() || systemTheme());
        document.addEventListener('DOMContentLoaded', function () { paint(readSaved() || systemTheme()); });
        try {
            var mq = window.matchMedia('(prefers-color-scheme: dark)');
            var onChange = function () { if (!readSaved()) paint(systemTheme()); };
            if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
        } catch (e) {}
    })();
    