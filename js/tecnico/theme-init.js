
    (function () {
        var t = 'dark';
        try { var s = localStorage.getItem('TECH_THEME'); if (s === 'light' || s === 'dark') t = s; } catch (e) {}
        document.documentElement.setAttribute('data-theme', t);
        var m = document.querySelector('meta[name="theme-color"]');
        if (m) m.setAttribute('content', t === 'dark' ? '#0a1122' : '#eef2fa');
    })();
    