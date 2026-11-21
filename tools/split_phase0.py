import re, json, os, sys
SRC = '/mnt/user-data/uploads'
OUT = '/mnt/user-data/outputs/hvac-app'
VER = 'f0'

# nombre de archivo por bloque: por id, o por linea de inicio si no tiene id
NAMES = {
 'index': {
  'name': 'index.html', 'src': 'index__3_.html', 'dir': 'admin',
  'anon': {17:'theme-init.js', 56:'app-ui.css', 3156:'app.js', 12273:'nav-tabs.js', 12351:'double-click-guard.js',
           12751:'plan-calendar-dark.css', 14000:'zones.js', 14165:'new-routine.js', 15375:'report-trigger.js'},
  'ids': {'hvac-security':'security.js','client-side-pagination':'pagination.js','attendance-module':'attendance.js',
          'plan-calendar-module':'plan-calendar.js','geocode-module':'geocode.js','period-module':'period.js',
          'daymodal-module':'day-modal.js','prog-module':'prog.js','att-edit-module':'att-edit.js','qr-module':'qr.js',
          'ui-transitions-v1-js':'ui-transitions.js','row-dblclick-js':'row-dblclick.js','footer-year':'footer-year.js',
          'report-module':'report.js','modal-outside-click':'modal-outside-click.js','select-all-sync':'select-all-sync.js',
          'no-split-reset':'no-split-reset.js'}},
 'tecnico': {
  'name': 'tecnico.html', 'src': 'tecnico__5_.html', 'dir': 'tecnico',
  'anon': {24:'theme-init.js', 34:'app.css', 814:'app.js', 4422:'mx.css', 4485:'mx.js', 5152:'lazy-execution-load.js'},
  'ids': {'qr-deeplink':'qr-deeplink.js','last-maint':'last-maint.js','ui-transitions-v1-js':'ui-transitions.js',
          'hvac-update-sync-hook':'update-sync-hook.js'}},
}
# ids de <style>: se nombran <id>.css
open_re = re.compile(r'<!--|<(script|style)(?=[\s>])([^>]*)>', re.I)

def split(key, cfg):
    raw = open(f"{SRC}/{cfg['src']}", encoding='utf-8', newline='').read()
    pos, out, manifest, used = 0, [], [], set()
    while True:
        m = open_re.search(raw, pos)
        if not m:
            out.append(raw[pos:]); break
        if m.group(0) == '<!--':
            e = raw.index('-->', m.end()) + 3
            out.append(raw[pos:e]); pos = e; continue
        tag, attrs = m.group(1).lower(), m.group(2)
        close = re.compile(r'</%s\s*>' % tag, re.I).search(raw, m.end())
        if 'src=' in attrs:                       # externo: se deja tal cual
            out.append(raw[pos:close.end()]); pos = close.end(); continue
        content = raw[m.end():close.start()]
        line = raw.count('\n', 0, m.start()) + 1
        endline = raw.count('\n', 0, close.end()) + 1
        idm = re.search(r'id="([^"]+)"', attrs)
        bid = idm.group(1) if idm else None
        ext = 'js' if tag == 'script' else 'css'
        fname = cfg['anon'].get(line) or (cfg['ids'].get(bid) if bid else None) or (f'{bid}.css' if bid and tag=='style' else None)
        if not fname: raise SystemExit(f'sin nombre: {key} linea {line} id={bid}')
        assert fname.endswith(ext) and fname not in used, fname
        used.add(fname)
        rel = f'{ext}/{cfg["dir"]}/{fname}'
        os.makedirs(os.path.dirname(f'{OUT}/{rel}'), exist_ok=True)
        open(f'{OUT}/{rel}', 'w', encoding='utf-8', newline='').write(content)
        idattr = f' id="{bid}"' if bid else ''
        if tag == 'script':
            repl = f'<script{idattr} src="{rel}?v={VER}"></script>'
        else:
            repl = f'<link{idattr} rel="stylesheet" href="{rel}?v={VER}">'
        out.append(raw[pos:m.start()] + repl); pos = close.end()
        manifest.append({'file': rel, 'tag': tag, 'open_tag': raw[m.start():m.end()], 'replacement': repl,
                         'orig_lines': [line, endline], 'bytes': len(content.encode()), 'lines': content.count('\n')+1})
    html = ''.join(out)
    open(f"{OUT}/{cfg['name']}", 'w', encoding='utf-8', newline='').write(html)
    return manifest, len(raw.encode()), len(html.encode())

os.makedirs(f'{OUT}/tools', exist_ok=True)
allm = {}
for k, c in NAMES.items():
    m, a, b = split(k, c)
    allm[c['name']] = {'source': c['src'], 'blocks': m, 'orig_bytes': a, 'html_bytes': b}
    print(c['name'], len(m), 'bloques', a, '->', b, 'bytes')
json.dump(allm, open(f'{OUT}/tools/split_manifest.json', 'w'), ensure_ascii=False, indent=1)
