"""Capture README screenshots of every UI page (Playwright driving the installed Google Chrome).
Start the backend first (it serves the built UI), then: python docs/make_screenshots.py [base_url]"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8077'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'screenshots')
os.makedirs(OUT, exist_ok=True)
PAGES = [  # (file, route, full page?)
    ('01_landing.png', '/', False),
    ('02_ask_answer.png', '/research/11d4d23e58f7', True),
    ('03_ask_abstention.png', '/research/139b725cf8a5', True),
    ('04_architecture.png', '/architecture', True),
    ('05_dashboard.png', '/dashboard', True),
    ('06_experiments.png', '/experiments', False),
    ('07_history.png', '/history', False),
    ('08_upload.png', '/upload', False),
    ('09_judgment_viewer.png', '/judgments/33c7754e21392ad5', False),
]
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, color_scheme='dark', device_scale_factor=1)
    for name, route, full in PAGES:
        pg.goto(BASE + route, wait_until='networkidle')
        pg.wait_for_timeout(2500)  # entrance animations
        if full:  # sections animate in when scrolled into view
            h = pg.evaluate('document.documentElement.scrollHeight')
            for y in range(0, h, 400):
                pg.mouse.wheel(0, 400); pg.wait_for_timeout(250)
            pg.wait_for_timeout(1500)
            pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(800)
        f = os.path.join(OUT, name)
        pg.screenshot(path=f, full_page=full)
        from PIL import Image  # README images are stored as compressed JPEG
        j = f[:-4] + '.jpg'
        Image.open(f).convert('RGB').save(j, quality=82, optimize=True, progressive=True)
        os.remove(f)
        print(os.path.basename(j), os.path.getsize(j) // 1024, 'KB')
    b.close()
