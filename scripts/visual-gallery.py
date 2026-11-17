#!/usr/bin/env python3
"""Developer visual gallery: screenshots of every core page on a synthetic
library. Not a test; not part of CI. Output goes to .jf-artifacts/visual-gallery/.

Usage:  py -3.12 scripts/visual-gallery.py [label]
"""
import os, pathlib, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolated import make_fixture, launch, stop, api_wait  # noqa: E402

CHROME = os.environ.get('JF_CHROME', '/usr/bin/chromium')
OUT = ROOT / '.jf-artifacts' / 'visual-gallery'


def shot(page, label, outdir):
    page.wait_for_timeout(450)
    path = outdir / (label + '.png')
    page.screenshot(path=str(path))
    print('shot', path.name, flush=True)


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else 'current'
    outdir = OUT / label
    outdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-gallery-') as tmp:
        base = pathlib.Path(tmp)
        lib = base / 'library'
        make_fixture(lib)
        proc, port, log = launch(ROOT / 'dist/douyin.js', lib, base / 'home')
        try:
            api_wait(port)
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True, executable_path=CHROME,
                                            args=['--no-sandbox', '--font-render-hinting=none'])
                errors = []
                page = browser.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{port}/', wait_until='load', timeout=25000)
                page.wait_for_timeout(3500)
                shot(page, '01-feed-desktop', outdir)
                rail = page.locator('#studioRailToggle')
                if rail.count():
                    rail.evaluate('(el)=>el.click()')
                    page.wait_for_timeout(500)
                    shot(page, '01b-rail-open', outdir)
                    rail.evaluate('(el)=>el.click()')
                    page.wait_for_timeout(400)

                # media modes
                for mode, name in [('audio', '02-audio-desktop'), ('image', '03-images-desktop'), ('books', '04-books-desktop'), ('notes', '05-notes-desktop')]:
                    node = page.locator(f'[data-media-kind="{mode}"]')
                    if node.count():
                        node.first.evaluate('(el)=>el.click()')
                        page.wait_for_timeout(700)
                        shot(page, name, outdir)
                # back to video, open batch bar and context menu
                page.locator('[data-media-kind="video"]').first.evaluate('(el)=>el.click()')
                page.wait_for_timeout(700)
                sel = page.locator('#unifiedSelectTop')
                if sel.count():
                    sel.evaluate('(el)=>el.click()')
                    page.wait_for_timeout(500)
                    shot(page, '06-batch-select', outdir)
                    done = page.locator('#unifiedFinish')
                    if done.count():
                        done.evaluate('(el)=>el.click()')
                card = page.locator('#grid .card, #grid [class*="card"]').first
                if card.count():
                    card.evaluate('(el)=>el.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:520,clientY:420}))')
                    page.wait_for_timeout(600)
                    shot(page, '07-context-menu', outdir)
                    page.keyboard.press('Escape')

                # mobile viewport
                mob = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
                mob.goto(f'http://127.0.0.1:{port}/', wait_until='load', timeout=25000)
                mob.wait_for_timeout(3500)
                shot(mob, '08-feed-mobile', outdir)
                for mode, name in [('audio', '09-audio-mobile'), ('image', '10-images-mobile')]:
                    node = mob.locator(f'[data-media-kind="{mode}"]')
                    if node.count():
                        node.first.evaluate('(el)=>el.click()')
                        mob.wait_for_timeout(700)
                        shot(mob, name, outdir)
                if errors:
                    print('PAGE ERRORS:', errors[:5])
                browser.close()
        finally:
            stop(proc, log)
    print('DONE', outdir)


if __name__ == '__main__':
    main()
