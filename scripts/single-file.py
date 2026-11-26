# Turns a Vite build into one HTML file (CSS, JS and the sql.js wasm inline), for previews that cannot load files.
# Usage: VITE_PREVIEW_DEMO=1 npx vite build --outDir dist-preview && python3 scripts/single-file.py dist-preview preview.html
import base64, glob, os, re, sys
d = sys.argv[1]; out = sys.argv[2]
js = open(glob.glob(d + '/assets/index-*.js')[0]).read().replace('</script', '<\\/script')
css = open(glob.glob(d + '/assets/index-*.css')[0]).read()

def data_uri(name):
    path = os.path.join(d, 'assets', name)
    mime = {'.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'}[os.path.splitext(name)[1]]
    return f'data:{mime};base64,' + base64.b64encode(open(path, 'rb').read()).decode()

# Images imported by the app (logo) and the fonts: inline as data URIs, the preview cannot load files.
js = re.sub(r'new URL\("([^"]+\.(?:svg|png))",import\.meta\.url\)\.href', lambda m: '"' + data_uri(m.group(1)) + '"', js)
css = re.sub(r'url\(\./([^)]+\.woff2)\)', lambda m: 'url(' + data_uri(m.group(1)) + ')', css)
wasm = base64.b64encode(open(glob.glob(d + '/assets/sql-wasm-*.wasm')[0], 'rb').read()).decode()
html = f'''<title>Parto PA</title>
<meta name="description" content="Parto PA Phase-1-Vorschau">
<meta name="theme-color" content="#172a4d">
<style>{css}</style>
<div id="root"></div>
<script>window.__PA_WASM__ = "{wasm}";</script>
<script type="module">{js}</script>
'''
open(out, 'w').write(html)
print(len(html))
