#!/usr/bin/env python3
"""Verifica la Fase 0: re-inserta cada archivo CSS/JS en su lugar original y compara
byte a byte con el HTML original.  Uso:
  python3 tools/verify_split.py <index_original.html> <tecnico_original.html>"""
import json, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
man = json.load(open(os.path.join(root, 'tools/split_manifest.json'), encoding='utf-8'))
orig = dict(zip(['index.html', 'tecnico.html'], sys.argv[1:3]))
ok = True
for page, info in man.items():
    html = open(os.path.join(root, page), encoding='utf-8', newline='').read()
    for b in info['blocks']:
        content = open(os.path.join(root, b['file']), encoding='utf-8', newline='').read()
        assert html.count(b['replacement']) == 1, (page, b['file'], 'referencia no encontrada/duplicada')
        close = '</script>' if b['tag'] == 'script' else '</style>'
        html = html.replace(b['replacement'], b['open_tag'] + content + close)
    src = open(orig[page], encoding='utf-8', newline='').read()
    same = html == src
    ok &= same
    print(f"{page}: {len(info['blocks'])} bloques re-insertados -> {'IDENTICO al original' if same else 'DIFERENTE'}")
sys.exit(0 if ok else 1)
