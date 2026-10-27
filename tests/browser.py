#!/usr/bin/env python3
"""Browser smoke tests for generated single-file UI.
Requires an installed Chromium + Python Playwright; no npm install needed.
Test media libraries are temporary and cannot point to personal directories.
"""
import json, os, pathlib, sys, tempfile, time, urllib.request
from isolated import ROOT, make_fixture, launch, stop, api_wait, urlopen
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    raise SystemExit('Playwright missing; browser test NOT EXECUTED')

def main():
    results=[]
    with tempfile.TemporaryDirectory(prefix='jf-architecture-test-browser-') as tmp:
        base=pathlib.Path(tmp); lib=base/'library';make_fixture(lib)
        proc,port,log=launch(ROOT/'dist/douyin.js',lib,base/'home')
        try:
            payload=api_wait(port)
            html=urlopen(f'http://127.0.0.1:{port}/')[2].decode()
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
                page=browser.new_page(viewport={'width':1440,'height':900})
                errors=[]
                page.on('pageerror',lambda error: errors.append(str(error)))
                # Chromium's sandbox sometimes blocks navigation to localhost.
                # Inject the same actual served HTML while safely stubbing ONLY
                # media API transport, preserving production DOM/JS and event code.
                page.evaluate('''(data) => {
                  const original = window.fetch.bind(window);
                  window.fetch = async (input, init) => {
                    const url = String(input?.url || input);
                    if (url.startsWith('/api/data') || url.endsWith('/api/data'))
                      return { ok:true, status:200, json:async()=>data, text:async()=>JSON.stringify(data) };
                    // Do not allow tests to mutate the simulated backend by UI clicks.
                    return {ok:false,status:404,json:async()=>({error:'blocked in E2E'}),text:async()=>'{"error":"blocked in E2E"}'};
                  };
                }''',payload)
                page.set_content(html,wait_until='load',timeout=20000)
                page.wait_for_timeout(2200)
                def check(name,predicate,detail=''):
                    passed=bool(predicate);results.append({'name':name,'pass':passed,'detail':detail})
                    print(('PASS' if passed else 'FAIL'),name,detail,flush=True)
                    if not passed:raise AssertionError(name+': '+detail)
                check('Brand mark rendered',page.locator('.studioBrand').count()>0)
                check('Navigation entry rendered',page.locator('.studioMediaRail, .mediaTabs').count()>0)
                check('No runtime JS exception',not errors,repr(errors[:2]))
                check('Media page controls rendered',page.locator('#grid').count()==1)
                # Nonmutating media-mode switching on the actual unified rail.
                for mode in ['audio','image','video']:
                    rail=page.locator('#studioRailToggle')
                    if rail.count()==1: rail.evaluate('(element) => element.click()')
                    node=page.locator(f'[data-media-kind="{mode}"]')
                    check('Mode button present '+mode,node.count()==1)
                    node.evaluate('(element) => element.click()')
                    page.wait_for_timeout(300)
                    check('Mode selected '+mode,node.get_attribute('aria-selected')=='true')
                    check('No script error switching '+mode,not errors,repr(errors[-2:]))
                # detect CSS/layout corruption with viewport captures
                screens=ROOT/'dist/browser-shots';screens.mkdir(exist_ok=True)
                page.screenshot(path=str(screens/'desktop.png'))
                page.set_viewport_size({'width':900,'height':1500})
                page.wait_for_timeout(400)
                page.screenshot(path=str(screens/'portrait.png'))
                check('Portrait DOM stable',page.locator('.studioHeader').count()==1)
                check('Script still error-free',not errors,repr(errors[-2:]))
                browser.close()
        finally:stop(proc,log)
    report={'passed':sum(x['pass'] for x in results),'total':len(results),'tests':results}
    (ROOT/'dist/browser-test-report.json').write_text(json.dumps(report,indent=2)+'\n')
    return report
if __name__=='__main__':
    try:
        rpt=main()
        print('BROWSER RESULT',rpt['passed'],'/',rpt['total'])
    except Exception as e:
        print('BROWSER FAILURE:',repr(e),file=sys.stderr)
        sys.exit(1)
