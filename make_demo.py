"""Produce the self-contained browser demo from the same Android asset files."""
import base64
from pathlib import Path

root = Path(__file__).resolve().parent
assets = root / 'app/src/main/assets'
html = (assets / 'pet.html').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="pet.css">', '<style>' + (assets/'pet.css').read_text(encoding='utf-8') + '</style>')
brain = (assets/'brain.js').read_text(encoding='utf-8')
code = (assets/'pet.js').read_text(encoding='utf-8')
for image in ('idle.png', 'actions.png'):
    data = base64.b64encode((assets/image).read_bytes()).decode('ascii')
    code = code.replace("'" + image + "'", "'data:image/png;base64," + data + "'")
html = html.replace('<script src="brain.js"></script>', '<script>' + brain + '</script>')
html = html.replace('<script src="pet.js"></script>', '<script>' + code + '</script>')
destination = root / 'WhalePet-demo.html'
destination.write_text(html, encoding='utf-8')
print(destination)
