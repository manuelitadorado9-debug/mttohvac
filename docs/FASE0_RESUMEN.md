# Fase 0 · Separación HTML / CSS / JS

Verificación: `python3 tools/verify_split.py <index.html original> <tecnico.html original>`
re-inserta cada archivo en su lugar y compara con el original → **idéntico byte a byte** (ambas vistas).
`tools/split_manifest.json` lista cada bloque: archivo, líneas de origen, bytes.

| Vista | HTML antes → ahora | CSS extraído | JS extraído |
|---|---|---|---|
| Admin (`index.html`) | 1.146 KB → 162 KB | 14 archivos en `css/admin/` | 24 archivos en `js/admin/` |
| Técnico (`tecnico.html`) | 339 KB → 28 KB | 6 archivos en `css/tecnico/` | 8 archivos en `js/tecnico/` |

Se mantiene el orden original de carga; cada bloque quedó en su misma posición como `<link>`/`<script src>` con `?v=f0`
y conserva su `id`. No se modificó ni una línea de código.

Sin tocar (siguen igual): CDNs (Tailwind, Font Awesome, CryptoJS, jsPDF, XLSX, Inter), `common.js`, `/tailwind.css`, meta tags, favicon, manifest.

Base para fases futuras (vacíos, sin referenciar): `js/core/{config,api,state,utils}.js`, `css/base/{tokens,components}.css`.

## Control Operativo · Etapa 1B
Modal ⚙️ "Configuración Operativa" (solo ADMIN) con la subsección Transportes: tarifa general con histórico y tarifas especiales por cliente (activar/desactivar).
Archivos: `js/admin/ops-config.js`, `css/admin/ops-config.css`, modal y botón en `index.html`. Requiere el SQL de la Etapa 1A.

## Control Operativo · Etapa 1C
Se activan las tres pestañas restantes del modal ⚙️ (solo ADMIN, mismas funciones SQL `ops_*` de la 1A, sin SQL nuevo):
- **Horas extras y roles:** valor por hora según cargo y tipo (diurna, nocturna, dominical, festiva) con fecha de vigencia, y festivos de Colombia por año (agregar/quitar).
- **Alimentación y horarios:** valor de alimentación nocturna, fin de jornada y tolerancia, y días de corte del periodo.
- **Membretes:** encabezado, pie, logo (URL https://) y texto de legalización.
Archivos modificados: `js/admin/ops-config.js`, `css/admin/ops-config.css`, `index.html` (pestañas habilitadas, `?v=1c`).

## Control Operativo · Etapa 2A
Nueva sección **Transportes** en el menú (solo ADMIN): tabla de traslados con filtros (fechas y estado), indicadores, **registro manual** (valor automático según tarifa especial/general vigente a la fecha, o valor manual) y **Aprobar / Rechazar** (el rechazo exige motivo; solo traslados Pendientes).
Requiere ejecutar `sql/02_transportes_etapa2A.sql` (después del de la 1A): `ops_transfer_list`, `ops_transfer_add_manual`, `ops_transfer_decide`.
Archivos: `js/admin/transports.js`, `css/admin/transports.css`, sección y modal en `index.html`, enlace en `js/admin/app.js`, `js/admin/nav-tabs.js`.
