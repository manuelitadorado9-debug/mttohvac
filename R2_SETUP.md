# Subida de imágenes a Cloudflare R2 (plan gratuito) — guía de configuración

## ¿Por qué el bucket marcaba 0 bytes?
El código anterior **nunca enviaba nada a R2**: "Cloud R2" era solo una etiqueta. Las fotos y firmas se comprimían a Base64
y se guardaban dentro del registro (Supabase + copia local en el teléfono). Además, el navegador no puede escribir en R2
directamente sin exponer las llaves secretas, así que se agregó `api/r2-sign.js`: una función de Vercel que firma una URL
temporal (5 min) y el navegador sube la imagen **directo a R2** con esa URL.

Flujo: foto → compresión → `POST /api/r2-sign` → `PUT` directo a R2 → en la base de datos solo queda la URL
(`https://pub-xxxx.r2.dev/reportes/2026/10/abc123.jpg`). Sin señal o sin R2 configurado, la imagen se conserva en Base64 y se
sube sola en la siguiente sincronización.

## Pasos (10 minutos)
1. **Cloudflare → R2 → Create bucket** (ej. `hvac-evidencias`).
2. En el bucket → **Settings → Public access → R2.dev subdomain → Allow**. Copia la URL `https://pub-xxxxxxxx.r2.dev`.
3. En el bucket → **Settings → CORS policy → Add** y pega (cambia el dominio por el tuyo):
   ```json
   [
     {
       "AllowedOrigins": ["https://TU-APP.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. **R2 → Manage R2 API Tokens → Create API token** → permiso **Object Read & Write** → solo ese bucket.
   Copia *Access Key ID*, *Secret Access Key* y tu *Account ID* (aparece en la página principal de R2).
5. **Vercel → tu proyecto → Settings → Environment Variables** (Production):

   | Variable | Valor |
   |---|---|
   | `R2_ACCOUNT_ID` | tu Account ID |
   | `R2_ACCESS_KEY_ID` | Access Key ID del token |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key del token |
   | `R2_BUCKET` | nombre del bucket |
   | `R2_PUBLIC_BASE` | `https://pub-xxxxxxxx.r2.dev` (sin `/` final) |
   | `ALLOWED_ORIGINS` (opcional) | `https://TU-APP.vercel.app` |

   Luego **Deployments → Redeploy** (las variables solo se leen al desplegar).
6. Sube este proyecto completo a Vercel (incluye la carpeta `api/`).
7. Entra como administrador → **Panel principal → "Almacenamiento de imágenes (Cloudflare R2)"**:
   - **Probar conexión R2**: sube una imagen de prueba, la vuelve a leer y valida que tenga tamaño > 0. Si algo falla, dice qué.
   - **Migrar fotos antiguas**: sube a R2 las fotos y firmas que siguen en la base de datos y deja solo la URL.

## Si algo falla
| Mensaje | Causa y solución |
|---|---|
| No existe `/api/r2-sign` | No se desplegó la carpeta `api/`. |
| Faltan variables de entorno | Crea las 5 variables y haz Redeploy. |
| El navegador no pudo escribir en R2 | Falta o está mal la política CORS (paso 3). El dominio debe coincidir exactamente. |
| R2 respondió 403 | Token sin permiso *Object Read & Write*, o `R2_BUCKET` / `R2_ACCOUNT_ID` incorrectos. |
| La URL pública no abre | Activar *R2.dev subdomain* (paso 2) y revisar `R2_PUBLIC_BASE`. |

## Notas
- Plan gratuito de R2: 10 GB de almacenamiento y 1 millón de operaciones de escritura al mes (sobra para este uso).
- La función solo firma rutas `reportes|equipos|firmas|comprobantes|asistencia|otros/…`, imágenes JPG/PNG/WEBP de hasta 3 MB.
  Define `ALLOWED_ORIGINS` para que solo tu dominio pueda pedir firmas.
- Los PDF se generan igual: la app descarga las imágenes de R2 en paralelo antes de armar el PDF.
