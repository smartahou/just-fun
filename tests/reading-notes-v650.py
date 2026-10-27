#!/usr/bin/env python3
"""v6.50: isolated API+Chromium reading, notes, EPUB inertness, encrypted workspace."""
import pathlib,tempfile,subprocess,hashlib,json,zipfile,urllib.request,urllib.parse,time
from playwright.sync_api import sync_playwright
from isolated import ROOT,launch,stop,urlopen

pass_count=0
def ck(name,ok):
    global pass_count
    if not ok: raise AssertionError(name)
    pass_count+=1;print('PASS',name,flush=True)
def json_api(base,uri,body=None,headers=None):
    hdr={'Content-Type':'application/json'} if body is not None else {}
    hdr.update(headers or {})
    status,h,data=urlopen(base+uri,hdr,method='POST' if body is not None else 'GET') if body is None else urlopen_post(base+uri,json.dumps(body).encode(),hdr)
    try:result=json.loads(data)
    except:result={'error':str(data[:100])}
    return status,h,result
def urlopen_post(url,data,headers):
    req=urllib.request.Request(url,data=data,headers=headers,method='POST')
    try:
        with urllib.request.urlopen(req,timeout=8) as resp:return resp.status,dict(resp.headers),resp.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def fixture(lib):
    books=lib/'书籍/经典';books.mkdir(parents=True)
    (books/'心经.txt').write_text('色即是空，空即是色。\n\n'+('无眼耳鼻舌身意。\n'*2600),encoding='utf8')
    (books/'读书.md').write_text('# Just Fun\n\n读书笔记内容。')
    epub=books/'样本.epub'
    with zipfile.ZipFile(epub,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('mimetype','application/epub+zip')
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf','<package><manifest><item id="a" href="chap1.xhtml"/><item id="b" href="chap2.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>')
        z.writestr('OEBPS/chap1.xhtml','<html><head><title>禁用</title><script>window.xssHappened=true</script></head><body><h1>第一章</h1><p>众生平等 &amp; 互相尊重。</p><img src="remote.jpg" onerror="alert(1)"></body></html>')
        z.writestr('OEBPS/chap2.xhtml','<html><body><h2>第二章</h2><p>修行始于此刻。</p></body></html>')
    # PDF header for HTTP delivery; native render isn't asserted with this stub.
    (books/'经典.pdf').write_bytes(b'%PDF-1.4\n'+b'X'*2048)
    return {str(p.relative_to(lib)):hashlib.sha256(p.read_bytes()).hexdigest() for p in lib.rglob('*') if p.is_file()}
with tempfile.TemporaryDirectory(prefix='jf-architecture-test-v650-') as folder:
    tmp=pathlib.Path(folder);lib=tmp/'媒体';lib.mkdir();original=fixture(lib)
    proc=lg=None
    try:
        proc,port,lg=launch(ROOT/'dist/douyin.js',lib,tmp/'home')
        base=f'http://127.0.0.1:{port}'
        st,_,out=json_api(base,'/api/books?refresh=1')
        ck('Existing root discovers TXT/MD/EPUB/PDF',st==200 and out['total']==4)
        ids={b['name']:b['id'] for b in out['books']}
        b=ids['心经.txt'];ep=ids['样本.epub'];pdf=ids['经典.pdf']
        st,_,outline=json_api(base,'/api/reading/outline?id='+b)
        ck('TXT split into navigable sections',st==200 and len(outline['chapters'])>1)
        st,_,c=json_api(base,'/api/reading/chapter?id='+b+'&chapter=0')
        ck('Unicode source text preserved',st==200 and '色即是空' in c['text'])
        st,_,e=json_api(base,'/api/reading/outline?id='+ep)
        ck('EPUB OPF spine resolves both chapters',st==200 and len(e['chapters'])==2)
        st,_,e1=json_api(base,'/api/reading/chapter?id='+ep+'&chapter=0')
        ck('EPUB extracts inert readable text',st==200 and '众生平等 & 互相尊重' in e1['text'] and 'window.xssHappened' not in e1['text'] and '<img' not in e1['text'])
        st,_,e2=json_api(base,'/api/reading/chapter?id='+ep+'&chapter=1')
        ck('EPUB second chapter readable',st==200 and '修行始于此刻' in e2['text'])
        st,_,bad=json_api(base,'/api/reading/chapter?id='+ep+'&chapter=400')
        ck('Out-of-bounds chapter rejected',st in (400,404))
        st,headers,raw=urlopen(base+'/api/reading/pdf?id='+pdf,{'Range':'bytes=10-41'})
        ck('PDF native Range returns 206 correct bytes',st==206 and len(raw)==32 and headers.get('Content-Range','').startswith('bytes 10-41/'))
        st,headers,raw=urlopen(base+'/api/reading/pdf?id='+pdf,{'Range':'bytes=9999999-99999999'})
        ck('Invalid PDF Range rejected',st==416)
        st,_,bad=json_api(base,'/api/reading/outline?id=../../etc/passwd')
        ck('Traversal IDs refused',st==400)
        st,_,ws=json_api(base,'/api/reading/workspace')
        ck('Initial workspace empty',st==200 and ws['revision']==0 and ws['notes']==[])
        note={'id':'a'*24,'title':'读书时的心得','content':'你好，Just Fun!','excerpt':'色即是空，空即是色。','bookId':b,'chapter':0}
        st,_,ws=json_api(base,'/api/reading/workspace',{'action':'note','note':note,'revision':0})
        ck('Create citation note persists',st==200 and ws['revision']==1 and len(ws['notes'])==1)
        st,_,other=json_api(base,'/api/reading/workspace',{'action':'note','note':note,'revision':0})
        ck('Stale revision cannot overwrite',st==409 and '重新载入' in other['error'])
        st,_,ws=json_api(base,'/api/reading/workspace',{'action':'progress','bookId':b,'chapter':1,'ratio':.38,'revision':1})
        ck('Progress and notes retain both values',st==200 and ws['progress'][b]['chapter']==1 and len(ws['notes'])==1)
        st,_,other=json_api(base,'/api/reading/workspace',{'action':'note','note':note,'revision':2},headers={'Origin':'http://evil.example','Sec-Fetch-Site':'cross-site'})
        ck('Cross-site notes mutation rejected',st==403)
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':1440,'height':900});errors=[]
            page.on('pageerror',lambda exc:errors.append(str(exc)))
            def route(proxy):
                r=proxy.request;u=urllib.parse.urlsplit(r.url)
                if u.path.startswith('/api/books') or u.path.startswith('/api/reading'):
                    req=urllib.request.Request(base+u.path+('?' + u.query if u.query else ''),data=r.post_data.encode() if r.method=='POST' else None,method=r.method,headers={'Content-Type':'application/json'} if r.method=='POST' else {})
                    try:
                        with urllib.request.urlopen(req,timeout=15) as resp:status=resp.status;body=resp.read()
                    except urllib.error.HTTPError as exc:status=exc.code;body=exc.read()
                    proxy.fulfill(status=status,body=body,headers={'Content-Type':'application/json'})
                else:proxy.fulfill(status=200,body='{}',headers={'Content-Type':'application/json'})
            page.route('http://justfun.test/**',route)
            html=urlopen(base+'/')[2].decode()
            page.set_content(html.replace('<head>','<head><base href="http://justfun.test/">',1),wait_until='domcontentloaded',timeout=30000)
            page.wait_for_timeout(250)
            page.locator('#studioRailToggle').click();page.locator('[data-media-kind="books"]').click()
            page.locator('.jfBookTile').first.wait_for(timeout=10000)
            ck('Book shelf remains operational with workspace',page.locator('.jfBookTile').count()==4)
            page.locator('#studioRailToggle').click();page.locator('[data-media-kind=notes]').click()
            page.locator('#jfDeskNotes').wait_for(state='visible')
            ck('Independent notes panel lists saved note',page.locator('.jfDeskNoteItem').count()==1)
            page.locator('.jfDeskNoteItem').first.click()
            ck('Note text and source link appear',page.locator('#jfDeskNoteBody').input_value()=='你好，Just Fun!' and page.locator('.jfDeskQuote button').is_visible())
            page.locator('#jfDeskNoteBody').fill('改进后的笔记正文')
            page.wait_for_function("document.querySelector('#jfDeskSaveState').textContent.includes('已保存')",timeout=15000)
            ck('Autosave resolves to confirmed server response','已保存' in page.locator('#jfDeskSaveState').inner_text())
            page.locator('#studioRailToggle').click();page.locator('[data-media-kind=books]').click()
            page.locator('.jfBookTile').filter(has_text='心经').first.click()
            page.wait_for_function('jfDeskBook && jfDeskChapter===1 && jfReadText.textContent.length>10',timeout=15000)
            ck('Saved progress restores chapter',page.locator('#jfReadChapters').input_value()=='1')
            page.locator('#jfReadChapters').select_option('0')
            page.wait_for_timeout(200)
            ck('Text reader opens actual book',page.locator('#jfReadText').inner_text().find('色即是空')>=0)
            page.evaluate('''()=>{const text=document.querySelector('#jfReadText').firstChild;const r=document.createRange();r.setStart(text,0);r.setEnd(text,7);const s=getSelection();s.removeAllRanges();s.addRange(r);}''')
            page.locator('#jfReadExcerpt').click()
            page.locator('#jfPdfQuoteChooser').wait_for()
            page.locator('#jfPdfQuoteOptions button[data-note-id="'+note['id']+'"]').click()
            page.locator('#jfPdfQuoteCommit').click()
            page.locator('#jfReadNotes').click()
            page.locator('#jfDeskNoteList .jfDeskNoteItem').first.wait_for()
            ck('Selected text captured as anchored excerpt',page.evaluate("jfDeskWorkspace.notes.some(n=>n.quotes?.some(q=>q.text.includes('色即是空') && q.bookId))") )
            page.locator('#jfDeskNotesClose').click();page.locator('#jfReadBack').click()
            page.wait_for_function('jfReader.hidden',timeout=15000)
            ck('Closing reader returns intact bookshelf',page.locator('#jfBooksWorkspace').is_visible() and not page.locator('#jfReader').is_visible())
            ck('No browser script exceptions',not errors)
            browser.close()
        st,_,ws=json_api(base,'/api/reading/workspace')
        ck('Browser auto-save persisted to Node',any('改进后的笔记正文' in x['content'] for x in ws['notes']))
        ck('Original books unchanged',all(hashlib.sha256((lib/p).read_bytes()).hexdigest()==v for p,v in original.items()))
    finally:
        if proc: stop(proc,lg)
    # Isolated encrypted library verifies non-plaintext vault and corruption handling.
    encrypted=tmp/'受保护媒体';encrypted.mkdir();fixture(encrypted)
    proc=lg=None
    try:
        proc,port,lg=launch(ROOT/'dist/douyin.js',encrypted,tmp/'encrypted-home',flags=('--pwd',),password='testpassword123')
        base=f'http://127.0.0.1:{port}'
        st,_,ws=json_api(base,'/api/reading/workspace')
        ck('Password-enabled workspace starts locked to vault key',st==200 and ws['revision']==0)
        st,_,ws=json_api(base,'/api/reading/workspace',{'action':'note','revision':0,'note':{'id':'b'*24,'title':'秘密摘录','content':'私有书房信息','excerpt':'','bookId':'','chapter':0}})
        ck('Vault-backed note can be saved',st==200 and ws['revision']==1)
        secret=(encrypted/'.douyin-nav-cache/reading/workspace.json').read_bytes()
        ck('Encrypted notes never disclose plaintext',b'justfun-metadata-vault' in secret and '私有书房信息'.encode() not in secret)
        ck('Backup file not needed at first save',not (encrypted/'.douyin-nav-cache/reading/workspace.json.bak').exists())
        st,_,ws=json_api(base,'/api/reading/workspace',{'action':'note','revision':1,'note':{'id':'b'*24,'title':'秘密摘录','content':'二次修改','excerpt':'','bookId':'','chapter':0}})
        backup=(encrypted/'.douyin-nav-cache/reading/workspace.json.bak').read_bytes()
        ck('Separate authenticated backup encrypted',st==200 and b'justfun-metadata-vault' in backup and '私有书房信息'.encode() not in backup)
        (encrypted/'.douyin-nav-cache/reading/workspace.json').write_bytes(b'{"broken":true}')
        st,_,ws=json_api(base,'/api/reading/workspace')
        ck('Vault downgrade/tampering rejected',st>=400 and not ws.get('ok'))
        st,_,ws=json_api(base,'/api/reading/workspace',{'action':'note','revision':2,'note':{'id':'b'*24,'title':'危险','content':'不能写入','bookId':''}})
        ck('Corrupt metadata not overwritten',st>=400 and (encrypted/'.douyin-nav-cache/reading/workspace.json').read_bytes()==b'{"broken":true}')
    finally:
        if proc:stop(proc,lg)
print('PASS TOTAL',pass_count,flush=True)
