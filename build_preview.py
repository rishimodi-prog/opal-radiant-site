#!/usr/bin/env python3
"""Build a self-contained preview.html with inlined CSS, JS, and base64 images."""
import base64, re, os

ROOT = os.path.dirname(os.path.abspath(__file__))

def read(path):
    with open(os.path.join(ROOT, path), 'r') as f:
        return f.read()

def img_to_base64(match):
    src = match.group(1)
    # Strip leading slash
    rel = src.lstrip('/')
    fpath = os.path.join(ROOT, rel)
    if not os.path.isfile(fpath):
        return match.group(0)  # leave unchanged if missing
    ext = os.path.splitext(fpath)[1].lower()
    mime = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
            'webp': 'image/webp', 'svg': 'image/svg+xml', 'gif': 'image/gif'}
    mtype = mime.get(ext.lstrip('.'), 'image/jpeg')
    with open(fpath, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    return f'src="data:{mtype};base64,{b64}"'

html = read('index.html')
css = read('css/style.css')
js = read('js/main.js')

# Inline CSS (use lambda to avoid backslash issues in CSS)
html = re.sub(
    r'<link[^>]+href="[^"]*style\.css"[^>]*>',
    lambda m: f'<style>\n{css}\n</style>',
    html
)

# Inline JS (use lambda to avoid backslash issues in JS)
html = re.sub(
    r'<script[^>]+src="[^"]*main\.js"[^>]*></script>',
    lambda m: f'<script>\n{js}\n</script>',
    html
)

# Inline images (src="/images/...")
html = re.sub(r'src="(/images/[^"]+)"', img_to_base64, html)

# Write preview
out = os.path.join(ROOT, 'preview.html')
with open(out, 'w') as f:
    f.write(html)

size_kb = os.path.getsize(out) // 1024
print(f"Preview: {size_kb} KB")
