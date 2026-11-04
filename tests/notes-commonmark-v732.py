#!/usr/bin/env python3
"""v7.32: notes render through markdown-it (CommonMark) bundled by esbuild.

Reads the embedded page from the real build artifact, so this fails if the
vendor bundle is missing, truncated, or rejected by the inline-script parser.
"""
import json, re, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
BT = chr(96)
checks = 0
def ck(label, ok):
    global checks
    if not ok:
        raise AssertionError(label)
    checks += 1
    print('PASS', label, flush=True)

script = (ROOT / 'dist/douyin.js').read_text(encoding='utf8')
m = re.search(r'function htmlPage\(\)\s*\{\s*return ("(?:[^"\\]|\\.)*");\s*\}', script)
assert m, 'embedded HTML not found'
html = json.loads(m.group(1))

MD = (
    '# 标题一\n\n'
    '- 外层\n  - 内层\n\n'
    '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n'
    '~~删~~ **粗** ' + BT + 'code' + BT + ' [外](https://example.com) [坏](javascript:alert(1))\n\n'
    '> 引用\n\n'
    + BT * 3 + 'js\nconst a = 1 < 2;\n' + BT * 3 + '\n'
)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/api/**', lambda rt: rt.fulfill(status=200, content_type='application/json',
                                                   body='{"items":[],"folders":[],"ok":true}'))
    page.set_content(html, wait_until='domcontentloaded', timeout=60000)
    page.wait_for_function("typeof jfNoteMarkdownHtml==='function'", timeout=20000)

    ck('Vendor bundle exposes the markdown renderer',
       page.evaluate("!!(window.JF && typeof window.JF.markdown.render==='function')"))
    ck('No script errors while booting the page', not errors)

    out = page.evaluate("(md)=>jfNoteMarkdownHtml(md)", MD)
    ck('CommonMark heading renders', '<h1>' in out and '标题一' in out)
    ck('Table renders (unsupported by the legacy scanner)', '<table>' in out and '<th>' in out)
    ck('Nested list keeps a child list', out.count('<ul>') >= 2)
    ck('Strikethrough preserved from the legacy renderer', '<s>删</s>' in out)
    ck('Inline code renders', '<code>code</code>' in out)
    ck('Emphasis renders', '<strong>粗</strong>' in out)
    ck('Blockquote renders', '<blockquote>' in out)
    ck('Fenced code escapes angle brackets', '<pre><code' in out and '1 &lt; 2' in out)
    ck('External link is target=_blank and noopener',
       'target="_blank"' in out and 'rel="noopener noreferrer"' in out)

    unsafe = page.evaluate("(md)=>jfNoteMarkdownHtml(md)", '[危险](javascript:alert(1))')
    ck('javascript: URL is never emitted as an href', 'href="javascript' not in unsafe)
    raw = page.evaluate("(md)=>jfNoteMarkdownHtml(md)", '<img src=x onerror=alert(1)>')
    ck('Raw HTML is escaped, not emitted', '<img' not in raw and '&lt;img' in raw)
    ck('Legacy fallback still available',
       page.evaluate("typeof jfNoteMarkdownHtmlLegacy==='function'"))
    browser.close()

print('TOTAL', checks)
