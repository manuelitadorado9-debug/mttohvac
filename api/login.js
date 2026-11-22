'use strict';
/* POST /api/login   { "username": "...", "password": "..." }
   → 200 { ok: true, user: { id, username, name, role, ... } }  — sin passwordHash
   → 200 { ok: false, error: "..." }

   Verifica la contraseña contra hvac_user_secrets (tabla privada, solo service_role).
   El cliente recibe el usuario sin hash; nunca vuelve a necesitar leerlo de hvac_users. */

import { createClient } from '@supabase/supabase-js';
import { pbkdf2 as nodePbkdf2, timingSafeEqual } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ ok: false, error: 'Faltan credenciales.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ ok: false, error: 'Servidor no configurado.' });

  // Usamos fetch directo para evitar dependencia de versión del SDK
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Buscar usuario por username (payload sin hash)
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hvac_users?select=id,payload&payload->>username=eq.${encodeURIComponent(username.toLowerCase())}`,
      { headers }
    );
    if (!userRes.ok) return res.status(200).json({ ok: false, error: 'Error al consultar usuarios.' });
    const users = await userRes.json();
    if (!Array.isArray(users) || !users.length)
      return res.status(200).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });

    const row  = users[0];
    const user = row.payload;

    // 2. Leer hash desde tabla privada
    const secretRes = await fetch(
      `${SUPABASE_URL}/rest/v1/hvac_user_secrets?select=password_hash&user_id=eq.${encodeURIComponent(row.id)}`,
      { headers }
    );
    if (!secretRes.ok) return res.status(200).json({ ok: false, error: 'Error al verificar credenciales.' });
    const secrets = await secretRes.json();
    if (!Array.isArray(secrets) || !secrets.length)
      return res.status(200).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });

    // 3. Verificar PBKDF2 — mismo formato que el cliente: pbkdf2$iterations$saltHex$hashHex
    const ok = await verifyPbkdf2(password, secrets[0].password_hash);
    if (!ok) return res.status(200).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });

    // 4. Devolver usuario SIN hash
    const safeUser = { ...user };
    delete safeUser.passwordHash;
    delete safeUser.password;

    return res.status(200).json({ ok: true, user: safeUser });

  } catch (err) {
    console.error('[login] error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
  }
}

function verifyPbkdf2(password, stored) {
  return new Promise((resolve) => {
    try {
      const parts = stored.split('$');
      if (parts[0] !== 'pbkdf2' || parts.length !== 4) return resolve(false);
      const iterations = parseInt(parts[1], 10);
      const saltBuf    = Buffer.from(parts[2], 'hex');
      const expected   = Buffer.from(parts[3], 'hex');
      nodePbkdf2(password, saltBuf, iterations, expected.length, 'sha256', (err, derived) => {
        if (err) return resolve(false);
        try { resolve(timingSafeEqual(derived, expected)); }
        catch { resolve(false); }
      });
    } catch { resolve(false); }
  });
}
