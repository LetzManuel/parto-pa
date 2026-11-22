# Turns a Vite build into one HTML file (CSS, JS and the sql.js wasm inline), for previews that cannot load files.
# Usage: VITE_PREVIEW_DEMO=1 npx vite build --outDir dist-preview && python3 scripts/single-file.py dist-preview preview.html
import base64, glob, sys
d = sys.argv[1]; out = sys.argv[2]
js = open(glob.glob(d + '/assets/index-*.js')[0]).read().replace('</script', '<\\/script')
css = open(glob.glob(d + '/assets/index-*.css')[0]).read()
wasm = base64.b64encode(open(glob.glob(d + '/assets/sql-wasm-*.wasm')[0], 'rb').read()).decode()
html = f'''<title>Parto PA</title>
<meta name="description" content="Parto PA Phase-1-Vorschau">
<meta name="theme-color" content="#1f3b57">
<style>{css}</style>
<div id="root"></div>
<script>window.__PA_WASM__ = "{wasm}";</script>
<script type="module">{js}</script>
'''
open(out, 'w').write(html)
print(len(html))
