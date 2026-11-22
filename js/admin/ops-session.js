/* ===== Sesión de administrador validada en el servidor (Etapa 6) =====
   Al iniciar sesión se pide un token a ops_login (SQL 10). Las funciones ops_* reciben ese token
   en p_hash en lugar del hash de la contraseña. Si no hay token, se usa el hash (modo antiguo). */
(function () {
    const KEY = 'HVAC_OPS_TOKEN';
    const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.token && Number(s.expiresAt) > Date.now() ? s : null; } catch (_) { return null; } };
    const call = async (fn, body) => {
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return r.ok ? r.json().catch(() => null) : null;
    };
    window.opsSessionLogin = async function (user, password) {
        try {
            const d = await call('ops_login', { p_username: String(user.username || ''), p_password: String(password || '') });
            if (d && d.token) localStorage.setItem(KEY, JSON.stringify({ token: d.token, userId: String(d.admin_id), expiresAt: Date.parse(d.expires_at) || (Date.now() + 864e5) }));
            return !!(d && d.token);
        } catch (_) { return false; }
    };
    window.opsSessionLogout = function () {
        const s = read();
        try { localStorage.removeItem(KEY); } catch (_) {}
        if (s) call('ops_logout', { p_token: s.token });
    };
    // Parámetros de autenticación para cualquier RPC ops_*
    window.opsAuth = function () {
        const u = systemUsers.find(x => String(x.id) === String(activeUser)) || {};
        const s = read();
        return { p_admin_id: String(u.id), p_hash: (s && s.userId === String(u.id)) ? s.token : (u.passwordHash || '') };
    };
})();
