
/* ===== Ubicación de la sede: búsqueda por dirección (Nominatim/OSM + Photon) + mapa Leaflet con pin ajustable ===== */
const geoSleep = ms => new Promise(r => setTimeout(r, ms));
async function geoFetchJson(url) {                       // con tiempo máximo: nunca deja la pantalla "pensando"
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
    try { const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
}
function geoNormalize(addr) {
    return String(addr || '').replace(/\s+/g, ' ').trim()
        .replace(/\b(cra|kra|kr|cr)\b\.?(?=\s*\d)/gi, 'Carrera').replace(/\b(cl|cll)\b\.?(?=\s*\d)/gi, 'Calle')
        .replace(/\bav\b\.?/gi, 'Avenida').replace(/\bdg\b\.?(?=\s*\d)/gi, 'Diagonal').replace(/\b(tv|trans)\b\.?(?=\s*\d)/gi, 'Transversal');
}
function geoVariants(addr) {
    let base = geoNormalize(addr); if (!base) return [];
    const hasCountry = /colombia/i.test(base); if (!hasCountry) base += ', Colombia';
    const noHash = base.replace(/\s*(#|n[oº°]\.?|nro\.?|num\.?)\s*/i, ' ').replace(/\s+/g, ' ');                   // "Calle 90 11-13"
    const street = base.replace(/\s*(#|n[oº°]\.?|nro\.?|num\.?)\s*[\w\s\-]+?(?=,|$)/i, '');                       // "Calle 90, Bogotá"
    const out = [{ q: base, approx: false }];
    if (noHash !== base) out.push({ q: noHash, approx: false });
    if (street !== base) out.push({ q: street, approx: true });
    return out;
}
const geoNominatim = async (q, n) => ((await geoFetchJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' + (n || 5) + '&countrycodes=co&accept-language=es&q=' + encodeURIComponent(q))) || [])
    .map(x => ({ lat: parseFloat(x.lat), lng: parseFloat(x.lon), label: x.display_name }));
const geoPhoton = async q => (((await geoFetchJson('https://photon.komoot.io/api/?limit=4&lang=es&q=' + encodeURIComponent(q))) || {}).features || [])
    .filter(f => !f.properties || !f.properties.countrycode || f.properties.countrycode === 'CO')
    .map(f => { const p = f.properties || {}; return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: [p.name, p.street, p.housenumber, p.district, p.city].filter(Boolean).join(', ') }; });
async function geocodeAddress(addr) {
    const vs = geoVariants(addr); let first = true;
    for (const v of vs) {
        if (!first) await geoSleep(1100); first = false;                       // política de Nominatim: máx. 1 consulta/segundo
        let list = await geoNominatim(v.q);
        if (!list.length) list = await geoPhoton(v.q);
        list = list.filter(r => isFinite(r.lat) && isFinite(r.lng));
        if (list.length) return { list, approx: v.approx };
    }
    // Sin resultados: al menos centra el mapa en la ciudad para que el usuario ubique el pin a mano
    const parts = geoNormalize(addr).split(',').map(s => s.trim()).filter(Boolean).filter(s => !/^colombia$/i.test(s));
    if (parts.length > 1) { await geoSleep(1100); const c = await geoNominatim(parts[parts.length - 1] + ', Colombia', 1); if (c.length) return { list: [], city: c[0] }; }
    return { list: [] };
}
/* ---- Mapa ---- */
let cliMap = null, cliMarker = null, leafletP = null;
function leafletLoad() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    return leafletP = new Promise((res, rej) => {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l);
        const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; s.onload = res; s.onerror = () => { leafletP = null; rej(new Error('leaflet')); }; document.head.appendChild(s);
    });
}
const cliPinIcon = () => L.divIcon({ className: 'cli-pin', iconSize: [34, 44], iconAnchor: [17, 42],
    html: '<svg viewBox="0 0 34 44" width="34" height="44"><path d="M17 1C8.7 1 2 7.5 2 15.6 2 26 17 43 17 43s15-17 15-27.4C32 7.5 25.300 1 17 1z" fill="#0d9488" stroke="#fff" stroke-width="2"/><circle cx="17" cy="15.500" r="5.500" fill="#fff"/></svg>' });
const cliSetCoords = (lat, lng) => { document.getElementById('cli-f-lat').value = Number(lat).toFixed(6); document.getElementById('cli-f-lng').value = Number(lng).toFixed(6); };
function cliPlace(lat, lng, manual) {
    if (!cliMap) return;
    cliSetCoords(lat, lng);
    if (!cliMarker) {
        cliMarker = L.marker([lat, lng], { draggable: true, icon: cliPinIcon() }).addTo(cliMap);
        cliMarker.on('dragend', () => { const p = cliMarker.getLatLng(); cliPlace(p.lat, p.lng, true); });
    } else cliMarker.setLatLng([lat, lng]);
    if (manual) {
        const a = document.getElementById('cli-f-address'); a.dataset.geoAddr = a.value.trim();      // no sobrescribir el pin manual
        cliGeoSet('📌 Ubicación ajustada en el mapa (' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + ')', 'ok');
    }
}
async function cliMapShow(lat, lng, zoom) {
    const el = document.getElementById('cli-map'); if (!el) return;
    try { await leafletLoad(); } catch (e) { el.innerHTML = '<div class="text-xs text-rose-600 p-4">No se pudo cargar el mapa (sin conexión). Puedes usar el ajuste manual.</div>'; return; }
    if (!cliMap) {
        cliMap = L.map(el, { zoomControl: true, attributionControl: true }).setView([4.65, -74.08], 6);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(cliMap);
        cliMap.on('click', e => cliPlace(e.latlng.lat, e.latlng.lng, true));
    }
    setTimeout(() => cliMap.invalidateSize(), 50);
    if (lat != null && lng != null && isFinite(lat) && isFinite(lng)) { cliPlace(lat, lng, false); cliMap.setView([lat, lng], zoom || 17); }
    else { if (cliMarker) { cliMap.removeLayer(cliMarker); cliMarker = null; } cliMap.setView([4.65, -74.08], 6); }
}
/* ---- Estado, resultados y búsqueda ---- */
const cliGeoSet = (html, kind) => { const s = document.getElementById('cli-geo-status'); if (!s) return; s.innerHTML = html; s.style.color = kind === 'ok' ? '#0f766e' : kind === 'bad' ? '#e11d48' : kind === 'warn' ? '#b45309' : ''; };
function cliGeoInit(c) {
    const addr = document.getElementById('cli-f-address'), has = c && c.lat != null && c.lng != null && c.lat !== '' && c.lng !== '';
    addr.dataset.geoAddr = has ? (c.address || '') : '';
    document.getElementById('cli-geo-results').innerHTML = '';
    cliGeoSet(has ? '📍 Ubicación guardada (' + Number(c.lat).toFixed(5) + ', ' + Number(c.lng).toFixed(5) + '). Arrastra el pin para corregirla.' : 'Escribe la dirección y pulsa Buscar, o toca el mapa para ubicar la sede.', has ? 'ok' : '');
    if (!addr.dataset.geoBound) {
        addr.dataset.geoBound = '1';
        addr.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cliGeoLookup(); } });
        addr.addEventListener('change', () => { if (addr.value.trim() && addr.value.trim() !== addr.dataset.geoAddr) cliGeoLookup(true); });
    }
    setTimeout(() => cliMapShow(has ? parseFloat(c.lat) : null, has ? parseFloat(c.lng) : null), 300);
}
function cliPickResult(i) {
    const r = (window.cliGeoList || [])[i]; if (!r) return;
    cliMap.setView([r.lat, r.lng], 18); cliPlace(r.lat, r.lng, false);
    const a = document.getElementById('cli-f-address'); a.dataset.geoAddr = a.value.trim();
    cliGeoSet('✅ Ubicación seleccionada. Si el pin no está exacto, arrástralo o toca el mapa.', 'ok');
}
let cliGeoBusy = null;
function cliGeoLookup(silent) {
    if (cliGeoBusy) return cliGeoBusy;
    const addrEl = document.getElementById('cli-f-address'), addr = addrEl.value.trim(), btn = document.getElementById('cli-geo-btn'), box = document.getElementById('cli-geo-results');
    if (!addr) { cliGeoSet('Escribe primero la dirección.', 'warn'); return Promise.resolve(false); }
    if (!navigator.onLine) { cliGeoSet('Sin conexión: no se puede buscar ahora. Puedes ubicar el pin a mano.', 'warn'); return Promise.resolve(false); }
    cliGeoSet('<i class="fa-solid fa-spinner fa-spin"></i> Buscando dirección…'); if (btn) btn.disabled = true; box.innerHTML = '';
    cliGeoBusy = (async () => {
        const r = await geocodeAddress(addr);
        await cliMapShow(null, null);
        if (r.list.length) {
            window.cliGeoList = r.list; const b = r.list[0];
            cliMap.setView([b.lat, b.lng], r.approx ? 16 : 18); cliPlace(b.lat, b.lng, false); addrEl.dataset.geoAddr = addr;
            cliGeoSet((r.approx ? '⚠️ Encontrada solo la calle (sin número exacto). ' : '✅ Dirección encontrada. ') + '<b>Si el pin no está exacto, arrástralo o toca el mapa.</b>', r.approx ? 'warn' : 'ok');
            if (r.list.length > 1) box.innerHTML = '<div class="text-[10px] font-bold text-slate-500 mb-1">Otros resultados:</div>' + r.list.slice(0, 5).map((x, i) => `<button type="button" onclick="cliPickResult(${i})" class="cli-res">${esc(String(x.label).slice(0, 110))}</button>`).join('');
            return true;
        }
        if (r.city) cliMap.setView([r.city.lat, r.city.lng], 13);
        cliGeoSet('❌ No se encontró la dirección. <b>Toca el mapa o arrastra el pin</b> para ubicar la sede (el mapa quedó centrado en la ciudad).', 'bad');
        return false;
    })().catch(() => { cliGeoSet('No se pudo consultar el servicio de mapas. Ubica el pin a mano.', 'bad'); return false; })
        .finally(() => { cliGeoBusy = null; if (btn) btn.disabled = false; });
    return cliGeoBusy;
}
async function cliGeoEnsure() {                           // al guardar: solo busca si hay dirección nueva y no hay pin; máximo 15 s
    const el = document.getElementById('cli-f-address'), addr = el.value.trim();
    if (addr && (addr !== el.dataset.geoAddr || !document.getElementById('cli-f-lat').value)) await Promise.race([cliGeoLookup(true), geoSleep(15000)]);
}
function cliUseMyLocation() {
    if (!navigator.geolocation) return showToast('Geolocalización no disponible.', 'error');
    navigator.geolocation.getCurrentPosition(async p => { await cliMapShow(p.coords.latitude, p.coords.longitude, 18); cliPlace(p.coords.latitude, p.coords.longitude, true); },
        () => showToast('No se pudo obtener la ubicación.', 'error'), { enableHighAccuracy: true, timeout: 20000 });
}
