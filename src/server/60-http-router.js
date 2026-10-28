

let compiledHomeHTML = null;
function startServer() {
  const server =
    http.createServer(
      async (
        req,
        res
      ) => {
        try {
          const url =
            new URL(
              req.url,
              `http://127.0.0.1:${server.address()?.port || PORT}`
            );

          if (url.pathname === '/favicon.ico') {
             res.writeHead(200, {'Content-Type':'image/x-icon', 'Content-Length':APP_FAVICON_ICO.length, 'Cache-Control':'private, max-age=300'});
             if (req.method === 'HEAD') res.end();
             else res.end(APP_FAVICON_ICO);
             return;
           }

           if (
            url.pathname ===
              '/manifest.webmanifest'
          ) {
            const body =
              manifestJson();

            res.writeHead(
              200,
              {
                'Content-Type':
                  'application/manifest+json; charset=utf-8',
                'Content-Length':
                  Buffer.byteLength(
                    body
                  ),
                'Cache-Control':
                  'no-cache'
              }
            );

            res.end(
              body
            );

            return;
          }

          if (
            url.pathname === '/'
          ) {
            const html = compiledHomeHTML || (compiledHomeHTML = htmlPage());

            res.writeHead(
              200,
              {
                'Content-Type':
                  'text/html; charset=utf-8'
              }
            );

            res.end(
              html
            );

            return;
          }

          if(url.pathname.startsWith('/api/jf-pdf/')){
            try{jfReadingCheckOrigin(req);jfPdfJsServeAsset(req,res,url.pathname.slice('/api/jf-pdf/'.length));}
            catch(error){sendJson(res,{ok:false,error:error.message},error.status||403);}
            return;
          }
          // P1: books share targetDir; listing is read-only and never mutates the media catalog.
          if(url.pathname==='/api/books' && req.method==='GET'){
            try{sendJson(res,await jfListBooks(url.searchParams.get('refresh')==='1'));}
            catch(error){sendJson(res,{ok:false,error:'扫描书籍失败：'+error.message},503);}
            return;
          }
          if(url.pathname==='/api/books/delete' && req.method==='POST'){
            try{jfReadingCheckOrigin(req);const body=await parseBody(req);sendJson(res,await jfBookDelete(String(body.id||'')));}
            catch(error){sendJson(res,{ok:false,error:error.message},error.status||500);}
            return;
          }
          if(url.pathname==='/api/books/cover' && req.method==='GET'){
            try{jfReadingCheckOrigin(req);await jfBookCover(req,res,String(url.searchParams.get('id')||''));}
            catch(error){sendJson(res,{ok:false,error:error.message},error.status||404);}
            return;
          }
          // v6.50 — reading and notes share the current directory and password vault.
          if(url.pathname.startsWith('/api/reading/')){
            try{
              jfReadingCheckOrigin(req);
              const id=String(url.searchParams.get('id')||'');
              if(url.pathname==='/api/reading/outline' && req.method==='GET')
                sendJson(res,await jfReadingOutline(id));
              else if(url.pathname==='/api/reading/chapter' && req.method==='GET')
                sendJson(res,await jfReadingChapter(id,Number(url.searchParams.get('chapter'))));
              else if(url.pathname==='/api/reading/pdf-info' && req.method==='GET')
                sendJson(res,await jfPdfInfoResponse(id));
              else if(url.pathname==='/api/reading/pdf-page' && req.method==='GET')
                await jfPdfPageResponse(req,res,id,Number(url.searchParams.get('page')),Number(url.searchParams.get('width')));
              else if(url.pathname==='/api/reading/pdf' && ['GET','HEAD'].includes(req.method))
                await jfReadingPdf(req,res,id);
              else if(url.pathname==='/api/reading/integrity' && req.method==='GET')
                sendJson(res,jfReadingIntegrity());
              else if(url.pathname==='/api/reading/recovery' && req.method==='GET')
                sendJson(res,jfReadingRecoveryStatus());
              else if(url.pathname==='/api/reading/recovery' && req.method==='POST')
                sendJson(res,jfReadingRestoreBackup(await parseBody(req)));
              else if(url.pathname==='/api/reading/migration-preflight' && req.method==='GET')
                sendJson(res,jfReadingMigrationPreflight());
              else if(url.pathname==='/api/reading/workspace' && req.method==='GET')
                sendJson(res,jfReadingPublic());
              else if(url.pathname==='/api/reading/workspace' && req.method==='POST')
                sendJson(res,jfReadingUpdate(await parseBody(req)));
              else sendJson(res,{ok:false,error:'未知接口'},404);
            }catch(error){sendJson(res,{ok:false,error:error.message},error.status||500);}
            return;
          }
          // v6.39 — local-only credential and transcription endpoints.
          if(url.pathname.startsWith('/api/ai-transcript')){
            try{
              jfAsrCheckOrigin(req);
              if(url.pathname==='/api/ai-transcript/key' && req.method==='GET'){
                sendJson(res,{ok:true,configured:!!(await jfAsrGetKey())});return;
              }
              if(url.pathname==='/api/ai-transcript/key' && req.method==='POST'){
                const body=await parseBody(req);await jfAsrSetKey(body.key);
                sendJson(res,{ok:true,configured:true});return;
              }
              if(url.pathname==='/api/ai-transcript/key' && req.method==='DELETE'){
                await jfAsrDeleteKey();sendJson(res,{ok:true,configured:false});return;
              }
              if(url.pathname==='/api/ai-transcript/start' && req.method==='POST'){
                const body=await parseBody(req);
                const result=await jfAsrStart(String(body.key||''),String(body.exportId||''),String(body.vocabulary||''),body.regenerate===true);
                sendJson(res,{ok:true,...result});return;
              }
              if(url.pathname==='/api/ai-transcript/job' && req.method==='GET'){
                sendJson(res,jfAsrJobPublic(String(url.searchParams.get('id')||'')));return;
              }
              if(url.pathname==='/api/ai-transcript' && req.method==='GET'){
                const key=String(url.searchParams.get('key')||'');aiLearningItem(key);
                sendJson(res,{ok:true,data:jfAsrReadTranscript(key)});return;
              }
              if(url.pathname==='/api/ai-transcript/save' && req.method==='POST'){
                const body=await parseBody(req),key=String(body.key||'');
                aiLearningItem(key);
                const saved=await jfAsrSaveTranscript(key,body.segments,body.revision,body.confirm===true);
                sendJson(res,{ok:true,data:saved});return;
              }
              sendJson(res,{ok:false,error:'未知接口'},404);
            }catch(error){sendJson(res,{ok:false,error:jfAsrSafeError(error)},400);}
            return;
          }
          // v6.38 — read / import local AI results. No browser automation or external HTTP calls.
          if(url.pathname==='/api/ai-learning' && req.method==='GET'){
            try{
              const key=String(url.searchParams.get('key')||'');aiLearningItem(key);
              const result=aiLearningRead(key);
              sendJson(res,{ok:true,data:result});
            }catch(error){sendJson(res,{ok:false,error:error.message},400);}return;
          }
          if(url.pathname==='/api/ai-learning/import' && req.method==='POST'){
            try{
              const body=await parseBody(req),key=String(body.key||'');
              const changes={};if(body.notes!==undefined)changes.notes=body.notes;if(body.outline!==undefined)changes.outline=body.outline;
              const result=await aiLearningWrite(key,changes,'manual');sendJson(res,{ok:true,result});
            }catch(error){sendJson(res,{ok:false,error:error.message},400);}return;
          }
          if(url.pathname==='/api/ai-learning/discover' && req.method==='POST'){
            try{
              const body=await parseBody(req),key=String(body.key||'');
              const found=await aiLearningFindDownload(key);
              if(!found.found.length){sendJson(res,{ok:true,found:[],message:'下载目录中未发现与当前媒体匹配的 JSON'});return;}
              const result=await aiLearningWrite(key,found.changes,'download');
              sendJson(res,{ok:true,found:found.found,result});
            }catch(error){sendJson(res,{ok:false,error:error.message},400);}return;
          }
          // v6.37: Explicit local audio export. Never uploads source media or sends prompts to an AI provider.
          if(url.pathname==='/api/ai-audio-export' && req.method==='POST'){
            try{
              const body=await parseBody(req),key=String(body.key||'');
              if(!/^[a-f0-9]{16}$/.test(key)){sendJson(res,{ok:false,error:'非法媒体编号'},400);return;}
              const item=catalog.items.find(x=>x.key===key&&x.state==='ready');
              if(!item||!['video','audio'].includes(itemMediaKind(item))){sendJson(res,{ok:false,error:'音视频已不存在'},404);return;}
              if([...aiAudioJobs.values()].some(x=>x.status==='running')){sendJson(res,{ok:false,error:'已有音频处理任务，请处理完成后再试'},409);return;}
              aiExportCleanup();const id=crypto.randomBytes(16).toString('hex');
              const job={id,status:'running',label:'准备音轨',started:Date.now(),directory:'',parts:[],clipboardCopied:false,prompt:''};
              aiAudioJobs.set(id,job);beginMediaProgress(id,job.label);
              aiExportAudio(key,id).catch(error=>{job.status='error';job.label=String(error.message||'音频处理失败');finishMediaProgress(id,error);});
              sendJson(res,{ok:true,id,status:'running'});
            }catch(error){sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if(url.pathname==='/api/ai-audio-export' && req.method==='GET'){
            const id=url.searchParams.get('id');
            if(!validProgressId(id)||!aiAudioJobs.has(id)){sendJson(res,{ok:false,error:'任务不存在'},404);return;}
            sendJson(res,aiExportPublic(aiAudioJobs.get(id)));return;
          }
          if(url.pathname==='/api/ai-audio-open' && req.method==='POST'){
            try{
              const body=await parseBody(req),job=aiAudioJobs.get(String(body.id||''));
              if(!job||job.status!=='done'||!job.directory){sendJson(res,{ok:false,error:'导出尚未完成'},400);return;}
              if(process.platform!=='win32'){sendJson(res,{ok:false,error:'请在文件管理器中打开：'+job.directory},400);return;}
              const child=spawn('explorer.exe',[job.directory],{detached:true,stdio:'ignore',windowsHide:true});child.unref();
              sendJson(res,{ok:true});
            }catch(error){sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if(url.pathname==='/api/video-compat' && req.method==='GET'){
            try {
              const key=url.searchParams.get('key');
              if(!/^[a-f0-9]{16}$/.test(key||'')){sendJson(res,{ok:false,error:'非法媒体编号'},400);return;}
              sendJson(res,{ok:true,...inspectVideoCompatibility(key)});
            } catch(error){sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if(url.pathname==='/api/video-transcode' && req.method==='POST'){
            const body=await parseBody(req);
            if(!/^[a-f0-9]{16}$/.test(String(body.key||'')) || !['auto','encode'].includes(body.mode)){
              sendJson(res,{ok:false,error:'转码参数无效'},400);return;
            }
            beginMediaProgress(body.jobId,'兼容转码');
            try{
              const result=await convertVideoCompatibility(body.key,body.mode,body.jobId);
              finishMediaProgress(body.jobId);
              sendJson(res,{ok:true,method:result.method,item:itemPublic(result.item)});
            }catch(error){finishMediaProgress(body.jobId,error);sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if(url.pathname==='/api/media-progress' && req.method==='GET'){
            const id=url.searchParams.get('id');
            if(!validProgressId(id)){sendJson(res,{ok:false,error:'任务编号无效'},400);return;}
            const job=mediaProgressJobs.get(id);
            if(!job){sendJson(res,{ok:false,error:'任务不存在'},404);return;}
            sendJson(res,{ok:true,status:job.status,percent:job.percent,label:job.label});
            return;
          }
          if(url.pathname.startsWith('/api/image-thumb/') && req.method==='GET') {
            const key=url.pathname.slice('/api/image-thumb/'.length);
            if(!/^[a-f0-9]{16}$/.test(key)){res.writeHead(400);res.end();return;}
            await servePhotoThumbnail(req,res,key);
            return;
          }
          if(url.pathname==='/api/photo-crop' && req.method==='POST') {
            try{
              const result=await jfSavePhotoCrop(req);
              sendJson(res,{ok:true,...result});
            }catch(error){sendJson(res,{ok:false,error:String(error.message||'裁剪保存失败')},400);}
            return;
          }
          if(url.pathname==='/api/delete-images' && req.method==='POST') {
            const body=await parseBody(req);
            const keys=body && body.keys;
            if(!Array.isArray(keys)||keys.length<1||keys.length>500||keys.some(x=>typeof x!=='string'||!/^[a-f0-9]{16}$/.test(x))){
              sendJson(res,{ok:false,error:'图片数量或格式无效（最多 500 张）'},400);return;
            }
            const unique=[...new Set(keys)];
            const found=unique.map(key=>catalog.items.find(x=>x.key===key&&x.state==='ready'&&itemMediaKind(x)==='image'));
            if(found.some(x=>!x)){sendJson(res,{ok:false,error:'部分图片已不存在，请刷新图库'},409);return;}
            const failed=[],deleted=[];
            for(const item of found){
              try{
                deleteIndexedMediaFile(item);
                removeCover(item);
                try{fs.unlinkSync(path.join(PHOTO_THUMB_DIR,item.key));}catch{}
                deleted.push(item.key);
              }catch(error){failed.push({key:item.key,error:error.message});}
            }
            if(deleted.length){
              const deletedSet=new Set(deleted);
              catalog.items=catalog.items.filter(x=>!deletedSet.has(x.key));
              saveCatalog();
            }
            sendJson(res,{ok:true,deleted:deleted.length,failed});return;
          }
          if (url.pathname === '/api/ghost-loop' && req.method==='POST') {
            try {
              const body=await parseBody(req);
              const details=ghostMediaDetails(String(body.key||''),body.a,body.b);
              if(!ghostLoopJobs.has(details.id)) ghostLoopJobs.set(details.id,makeGhostLoop(details).finally(()=>ghostLoopJobs.delete(details.id)));
              await ghostLoopJobs.get(details.id);
              sendJson(res,{ok:true,url:'/api/ghost-loop/'+details.id+'.mp4',length:details.end-details.start});
            } catch(error) {sendJson(res,{ok:false,error:error.message||'生成失败'},400);}
            return;
          }
          if (url.pathname.startsWith('/api/ghost-loop/') && req.method==='GET') {
            const name=url.pathname.slice('/api/ghost-loop/'.length);
            if(!/^[a-f0-9]{40}\.mp4$/.test(name)) {res.writeHead(400);res.end();return;}
            const file=path.join(GHOST_DIR,name);
            if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}
            streamMedia(req,res,{mime:'video/mp4'},file);
            return;
          }
          if (url.pathname === '/api/clips' && req.method === 'GET') {
            sendJson(res,{ok:true,clips:catalog.clips.map(publicClip)});
            return;
          }
          if (url.pathname === '/api/clips' && req.method === 'POST') {
            try {
              const body = await parseBody(req);
              const clip = mutateClip(body || {});
              sendJson(res,{ok:true,clip});
            } catch(error) {
              sendJson(res,{ok:false,error:error.message || '片段操作失败'},400);
            }
            return;
          }
          if (url.pathname === '/api/clips/export' && req.method === 'POST') {
            try {
              const body = await parseBody(req);
              const clip = catalog.clips.find(c => c.id === String(body.id || ''));
              if (!clip) {sendJson(res,{ok:false,error:'片段不存在'},404);return;}
              const source = clipSource(clip.sourceKey);
              if(itemMediaKind(source)!=='video'||!Number.isFinite(clip.b))throw new Error('仅视频区间支持导出 MP4');
              beginMediaProgress(body.jobId,'导出片段');
              const created = await createClipFromItem(source,clip.a,clip.b,body.jobId);
              finishMediaProgress(body.jobId);
              // 导出文件是独立媒体，删除虚拟片段不会影响它。
              sendJson(res,{ok:true,item:itemPublic(created)});
            } catch(error) {sendJson(res,{ok:false,error:error.message || '导出失败'},400);}
            return;
          }
          if (
            url.pathname ===
            '/api/data'
          ) {
            // 媒体库内容未更新时，304 直接返回；避免全量 JSON 序列化
            // 以及扫描每个封面文件的同步 I/O。
            const catalogETag = '"' + (catalog.updatedAt || 'initial') + '"';
            if (req.headers['if-none-match'] === catalogETag) {
              res.writeHead(304, {'ETag': catalogETag, 'Cache-Control': 'no-store'});
              res.end();
              return;
            }
            res.setHeader('ETag', catalogETag);
            sendJson(
              res,
              {
                updatedAt:
                  catalog.updatedAt,
                scanStatus:
                  catalog.scanStatus,
                scanMessage:
                  catalog.scanMessage,
                folders: catalog.folders.filter(f => f.state === 'ready').map(f => ({
                  relativeDir:f.relativeDir, parentDir:f.parentDir, originalName:f.originalName,readOnly:f.readOnly===true
                })),
                items:
                  catalog.items
                    .filter(
                      item =>
                        item.state ===
                        'ready'
                    )
                    .map(
                      itemPublic
                    )
              }
            );

            return;
          }

          if (url.pathname === '/api/frame-preview/start' && req.method === 'POST') {
            const body = await parseBody(req);
            try {sendJson(res,{ok:true,...await startFramePreview(body.key)});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/frame-preview/status' && req.method === 'GET') {
            try {sendJson(res,{ok:true,...framePreviewStatus(url.searchParams.get('key'))});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname.startsWith('/api/frame-preview/image/') && req.method === 'GET') {
            const parts = url.pathname.slice('/api/frame-preview/image/'.length).split('/');
            const id=parts[0];
            const number=parts[1];
            if (!/^[a-f0-9]{24}$/.test(id||'') || !/^\d{1,6}$/.test(number||'')) {
              res.writeHead(400);res.end();return;
            }
            const idx=Number(number);
            const job=[...framePreviewJobs.values()].find(x=>x.id===id);
            if (!job || idx<0 || idx>=job.total) {res.writeHead(404);res.end();return;}
            const file=path.join(job.dir,'f'+String(idx).padStart(6,'0')+'.jpg');
            try {
              const st=fs.statSync(file);
              if (!st.isFile() || st.size<32) throw new Error('not ready');
              res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':st.size,'Cache-Control':'private, max-age=86400'});
              fs.createReadStream(file).pipe(res);
            } catch {res.writeHead(404,{'Cache-Control':'no-store'});res.end();}
            return;
          }
          if (url.pathname === '/api/frame-times' && req.method === 'POST') {
            const body = await parseBody(req);
            try {sendJson(res,{ok:true,...await getVideoFrameTimes(body.key,body.duration)});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/screenshot' && req.method === 'POST') {
            const body = await parseBody(req);
            try {const item=await captureFrame(body.key,body.time,body.frameIndex);sendJson(res,{ok:true,key:item.key});}
            catch(error) {sendJson(res,{ok:false,error:error.message},400);}
            return;
          }
          if (url.pathname === '/api/clip-audio' && req.method === 'POST') {
            const body=await parseBody(req);
            beginMediaProgress(body.jobId,'截取音频');
            try {
              const item=await createAudioClip(body.key,body.start,body.end,body.jobId);
              finishMediaProgress(body.jobId);
              sendJson(res,{ok:true,item:itemPublic(item)});
            } catch(error) {finishMediaProgress(body.jobId,error);sendJson(res,{ok:false,error:error.message||'音频截取失败'},400);}
            return;
          }
          if (url.pathname === '/api/extract-audio' && req.method === 'POST') {
            const body = await parseBody(req);
            beginMediaProgress(body.jobId,'提取音轨');
            try {const result=await extractAudio(body.key,body.jobId);finishMediaProgress(body.jobId);sendJson(res,{ok:true,key:result.item.key,method:result.method,codec:result.codec,outputCodec:result.outputCodec});}
            catch(error) {finishMediaProgress(body.jobId,error);sendJson(res,{ok:false,error:error.message},400);}
            return;
          }

          // Directory operations remain under the current media root and use catalog-backed hashed paths.
          if (url.pathname === '/api/folder-create' && req.method === 'POST') {
            const body=await parseBody(req);
            const parent=body.parent, name=typeof body.name==='string'?cleanText(body.name):'';
            if(typeof parent!=='string'||!name||Array.from(name).length>100||/[\\/<>:"|?*]/.test(name)||name==='.'||name==='..'){
              sendJson(res,{ok:false,error:'目录名称不合法'},400);return;
            }
            const validParent=parent==='data'||catalog.folders.some(f=>f.relativeDir===parent && f.state==='ready' && !f.readOnly && f.relativeDir.startsWith('data/'));
            if(!validParent || String(parent).split('/').length>=12){sendJson(res,{ok:false,error:'只能在已有素材目录内创建'},400);return;}
            if(catalog.folders.some(f=>f.parentDir===parent&&f.originalName===name&&f.state==='ready')){
              sendJson(res,{ok:false,error:'当前目录已经存在同名文件夹'},409);return;
            }
            let relativeDir='',full='';
            try {
              const hash=HASH_ENABLED ? randomFolderHash(parent) : name;
              relativeDir=parent+'/'+hash;
              full=path.join(targetDir,safeMediaRelativeDir(relativeDir));
              if(fs.existsSync(full))throw new Error('目录已存在');
              fs.mkdirSync(full);
              const folder={relativeDir,parentDir:parent,originalName:name,state:'ready'};
              catalog.folders.push(folder);
              try{saveCatalog();}catch(e){catalog.folders.pop();fs.rmdirSync(full);throw e;}
              sendJson(res,{ok:true,relativeDir,originalName:name});
            }catch(error){sendJson(res,{ok:false,error:'无法创建目录：'+error.message},500);}
            return;
          }
          if (url.pathname === '/api/folder-rename' && req.method === 'POST') {
            const body=await parseBody(req);
            const dir=body&&body.relativeDir;
            const name=body&&typeof body.name==='string'?cleanText(body.name):'';
            const folder=catalog.folders.find(f=>f.relativeDir===dir&&f.state==='ready');
            if(!folder){sendJson(res,{ok:false,error:'文件夹不存在或不支持改名'},404);return;}
            if(folder.readOnly || dir==='source' || String(dir).startsWith('source/')){sendJson(res,{ok:false,error:'工作目录只读，不允许重命名原目录'},403);return;}
            if(!name||Array.from(name).length>100||/[\\/<>:"|?*]/.test(name)||name==='.'||name==='..'){
              sendJson(res,{ok:false,error:'目录名称不合法'},400);return;
            }
            if(catalog.folders.some(f=>f!==folder&&f.parentDir===folder.parentDir&&f.originalName===name&&f.state==='ready')){
              sendJson(res,{ok:false,error:'上级目录已存在同名文件夹'},409);return;
            }
            const old=folder.originalName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=path.join(targetDir,safeMediaRelativeDir(dir));
                const next=folder.parentDir+'/'+name;
                const newAbs=path.join(targetDir,safeMediaRelativeDir(next));
                if(fs.existsSync(newAbs))throw new Error('目标目录已存在');
                fs.renameSync(oldAbs,newAbs);
                const beforeFolders=JSON.stringify(catalog.folders),beforeItems=catalog.items.map(x=>x.relativeDir);
                for(const f of catalog.folders){
                  if(f.relativeDir===dir || f.relativeDir.startsWith(dir+'/'))f.relativeDir=next+f.relativeDir.slice(dir.length);
                  if(f.parentDir===dir || f.parentDir.startsWith(dir+'/'))f.parentDir=next+f.parentDir.slice(dir.length);
                }
                for(const x of catalog.items){if(x.relativeDir===dir || (x.relativeDir||'').startsWith(dir+'/'))x.relativeDir=next+x.relativeDir.slice(dir.length);}
                folder.originalName=name;
                try{saveCatalog();}
                catch(e){catalog.folders=JSON.parse(beforeFolders);catalog.items.forEach((x,i)=>x.relativeDir=beforeItems[i]);fs.renameSync(newAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,relativeDir:next,originalName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            folder.originalName=name;
            try{saveCatalog();}catch(error){folder.originalName=old;sendJson(res,{ok:false,error:error.message},500);return;}
            sendJson(res,{ok:true,relativeDir:dir,originalName:name});return;
          }
          if (url.pathname === '/api/media-move' && req.method === 'POST') {
            const body=await parseBody(req);
            const keys=body.keys,target=body.target;
            if(!Array.isArray(keys)||keys.length<1||keys.length>300||
               keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k))||new Set(keys).size!==keys.length||
               typeof target!=='string'||!(target==='root'||target==='data'||catalog.folders.some(f=>f.relativeDir===target&&f.state==='ready'&&!f.readOnly&&f.relativeDir.startsWith('data/')))){
              sendJson(res,{ok:false,error:'目标目录或选中文件无效'},400);return;
            }
            const items=keys.map(k=>catalog.items.find(x=>x.key===k && x.state==='ready'));
            if(items.some(x=>!x)){sendJson(res,{ok:false,error:'存在无效素材，刷新后重试'},409);return;}
            if(items.some(x=>x.readOnly)){sendJson(res,{ok:false,error:'工作目录只读，不能移动源文件'},403);return;}
            let changes=[];
            try {
              const targetRelative=target==='root'?'':target;
              const destDir=path.join(targetDir,safeMediaRelativeDir(targetRelative));
              if(!fs.lstatSync(destDir).isDirectory()||fs.lstatSync(destDir).isSymbolicLink())throw new Error('目标不是受管理的普通文件夹');
              const toMove=items.filter(x=>(x.relativeDir||'')!==targetRelative);
              for(const item of toMove){
                const from=managedPath(item), to=path.join(destDir,item.managedName);
                if(!fs.statSync(from).isFile()||fs.existsSync(to))throw new Error('源文件不存在或目标文件已存在');
                changes.push({item,from,to,oldDir:item.relativeDir||''});
              }
              let moved=[];
              try {
                for(const change of changes){fs.renameSync(change.from,change.to);moved.push(change);}
                for(const change of changes)change.item.relativeDir=targetRelative;
                if(changes.length)saveCatalog();
              }catch(error){
                for(const change of changes)change.item.relativeDir=change.oldDir;
                for(const change of moved.reverse())try{fs.renameSync(change.to,change.from);}catch(rollback){error.message+='；回滚失败：'+rollback.message;}
                throw error;
              }
              sendJson(res,{ok:true,moved:changes.length});
            }catch(error){sendJson(res,{ok:false,error:'移动失败：'+error.message},500);}
            return;
          }

          // Treat a user-designated motion clip as a photo without renaming or transcoding it.
          if (url.pathname === '/api/media-live-photo' && req.method === 'POST') {
            const body=await parseBody(req);
            if(!body||typeof body.key!=='string'||!/^[a-f0-9]{16}$/.test(body.key)||typeof body.enabled!=='boolean'){
              sendJson(res,{ok:false,error:'实况照片参数无效'},400);return;
            }
            const item=catalog.items.find(x=>x.key===body.key&&x.state==='ready');
            if(!item){sendJson(res,{ok:false,error:'媒体不存在'},404);return;}
            if(!['.mp4','.mov','.m4v'].includes(String(item.originalExt||'').toLowerCase())){
              sendJson(res,{ok:false,error:'仅支持 MP4/MOV 动态照片'},400);return;
            }
            const old={livePhoto:item.livePhoto,livePhotoManual:item.livePhotoManual,kind:item.kind};
            item.livePhoto=body.enabled;item.livePhotoManual=body.enabled;item.kind=body.enabled?'image':'video';
            try{saveCatalog();sendJson(res,{ok:true,item:itemPublic(item)});}
            catch(error){Object.assign(item,old);sendJson(res,{ok:false,error:'保存媒体类型失败'},500);}
            return;
          }

          // Shared file operations for video / image / audio. Hash paths never change on rename.
          if (url.pathname === '/api/media-rename' && req.method === 'POST') {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key && x.state === 'ready');
            if (!item) {sendJson(res,{ok:false,error:'媒体不存在'},404);return;}
            if (item.readOnly) {sendJson(res,{ok:false,error:'工作目录只读，不能重命名源文件'},403);return;}
            if (typeof body.name !== 'string') {sendJson(res,{ok:false,error:'名称必须是文本'},400);return;}
            const name = cleanText(body.name);
            if (!name || Array.from(name).length > 180 || /[\\/<>:"|?*]/.test(name) || name==='.' || name==='..') {
              sendJson(res,{ok:false,error:'名称不能为空、超过 180 字，或包含路径符号'},400);return;
            }
            const old = item.displayName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=managedPath(item),oldManaged=item.managedName,oldOriginal=item.originalName;
                const next=safeOriginalFilename(name + (item.originalExt||path.extname(oldManaged)));
                const nextAbs=path.join(path.dirname(oldAbs),next);
                if(oldAbs!==nextAbs && fs.existsSync(nextAbs))throw new Error('同名文件已存在');
                if(oldAbs!==nextAbs)fs.renameSync(oldAbs,nextAbs);
                item.managedName=next;item.originalName=next;item.displayName=name;
                try{saveCatalog();}catch(e){item.managedName=oldManaged;item.originalName=oldOriginal;item.displayName=old;if(oldAbs!==nextAbs)fs.renameSync(nextAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,displayName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            item.displayName = name;
            try {saveCatalog();} catch(error) {
              item.displayName = old;sendJson(res,{ok:false,error:error.message},500);return;
            }
            sendJson(res,{ok:true,displayName:name});return;
          }
          if (url.pathname === '/api/media-favorite' && req.method === 'POST') {
            const body = await parseBody(req);
            const keys = body && body.keys;
            if (!Array.isArray(keys) || keys.length<1 || keys.length>500 ||
                keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k)) || typeof body.favorite!=='boolean') {
              sendJson(res,{ok:false,error:'收藏操作参数无效'},400);return;
            }
            const keySet = new Set(keys);
            const targets = catalog.items.filter(x=>keySet.has(x.key)&&x.state==='ready');
            if (targets.length!==keySet.size) {sendJson(res,{ok:false,error:'有媒体已不存在，请刷新'},409);return;}
            const before=targets.map(x=>x.favorite);
            targets.forEach(x=>x.favorite=body.favorite);
            try {saveCatalog();} catch(error) {
              targets.forEach((x,i)=>x.favorite=before[i]);sendJson(res,{ok:false,error:error.message},500);return;
            }
            sendJson(res,{ok:true,updated:targets.length});return;
          }
          if (url.pathname === '/api/media-delete-batch' && req.method === 'POST') {
            const body = await parseBody(req);
            const keys=body && body.keys;
            if (!Array.isArray(keys)||keys.length<1||keys.length>500||
                keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{16}$/.test(k))) {
              sendJson(res,{ok:false,error:'一次最多删除 500 个有效媒体'},400);return;
            }
            const keySet=new Set(keys);
            const found=catalog.items.filter(x=>keySet.has(x.key)&&x.state==='ready');
            if (found.length!==keySet.size) {sendJson(res,{ok:false,error:'部分媒体已不存在，请刷新'},409);return;}
            const deleted=[], failed=[];
            for (const item of found) {
              try {
                deleteIndexedMediaFile(item);
                removeCover(item);
                if (itemMediaKind(item)==='image') {
                  try{fs.unlinkSync(path.join(PHOTO_THUMB_DIR,item.key));}catch{}
                }
                deleted.push(item.key);
              } catch(error) { failed.push({key:item.key,error:error.message}); }
            }
            if (deleted.length) {
              const gone=new Set(deleted);
              catalog.items=catalog.items.filter(x=>!gone.has(x.key));
              saveCatalog();
            }
            sendJson(res,{ok:true,deleted:deleted.length,failed});return;
          }
          if (url.pathname === '/api/rename-audio' && req.method === 'POST') {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key && x.state === 'ready');
            if (!item || itemMediaKind(item) !== 'audio') {
              sendJson(res,{ok:false,error:'音频不存在'},404);
              return;
            }
            if(item.readOnly){sendJson(res,{ok:false,error:'工作目录只读，不能重命名源音频'},403);return;}
            if (typeof body.name !== 'string') {
              sendJson(res,{ok:false,error:'名称格式无效'},400);
              return;
            }
            const name = cleanText(body.name);
            if (!name || Array.from(name).length > 180 || /[\\/<>:"|?*]/.test(name) || name === '.' || name === '..') {
              sendJson(res,{ok:false,error:'名称不能为空、超过 180 字，或包含不允许的字符'},400);
              return;
            }
            const previous = item.displayName;
            if (!HASH_ENABLED) {
              try {
                const oldAbs=managedPath(item),oldManaged=item.managedName,oldOriginal=item.originalName;
                const next=safeOriginalFilename(name+(item.originalExt||path.extname(oldManaged)));
                const nextAbs=path.join(path.dirname(oldAbs),next);
                if(oldAbs!==nextAbs && fs.existsSync(nextAbs))throw new Error('目标文件已存在');
                if(oldAbs!==nextAbs)fs.renameSync(oldAbs,nextAbs);
                item.managedName=next;item.originalName=next;item.displayName=name;
                try{saveCatalog();}catch(e){item.managedName=oldManaged;item.originalName=oldOriginal;item.displayName=previous;if(oldAbs!==nextAbs)fs.renameSync(nextAbs,oldAbs);throw e;}
                sendJson(res,{ok:true,displayName:name});
              }catch(e){sendJson(res,{ok:false,error:e.message},500);}
              return;
            }
            item.displayName = name;
            try {saveCatalog();}
            catch (error) {
              item.displayName = previous;
              sendJson(res,{ok:false,error:'保存名称失败：'+error.message},500);
              return;
            }
            sendJson(res,{ok:true,displayName:name});
            return;
          }

          if (
            url.pathname ===
              '/api/update-text' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            if (
              body.field !==
                'creator' &&
              body.field !==
                'title'
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'不支持的字段'
                },
                400
              );
              return;
            }

            item[
              body.field
            ] =
              cleanText(
                body.value
              );

            saveCatalog();

            sendJson(
              res,
              {
                ok:true
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-creator-bulk' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const from =
              cleanText(
                body.from
              );

            const to =
              cleanText(
                body.to
              );

            if (
              !from ||
              !to
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'作者名不能为空'
                },
                400
              );
              return;
            }

            let changed = 0;

            if (from !== to) {
              for (
                const item of
                catalog.items
              ) {
                if (
                  cleanText(
                    item.creator
                  ) === from
                ) {
                  item.creator = to;
                  changed++;
                }
              }
            }

            if (changed) {
              catalog.creatorLinks = catalog.creatorLinks && typeof catalog.creatorLinks === 'object'
                ? catalog.creatorLinks
                : {};
              if (catalog.creatorLinks[from] && !catalog.creatorLinks[to]) {
                catalog.creatorLinks[to] = catalog.creatorLinks[from];
              }
              if (from !== to) delete catalog.creatorLinks[from];
              saveCatalog();
            }

            sendJson(
              res,
              {
                ok:true,
                changed
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-creator-link' &&
            req.method ===
              'POST'
          ) {
            const body = await parseBody(req);
            const creator = cleanText(body.creator);
            const link = String(body.link || '').trim();

            if (!creator) {
              sendJson(res, {ok:false,error:'作者名不能为空'}, 400);
              return;
            }
            if (link && !/^https?:\/\//i.test(link)) {
              sendJson(res, {ok:false,error:'链接格式无效'}, 400);
              return;
            }

            catalog.creatorLinks = catalog.creatorLinks && typeof catalog.creatorLinks === 'object'
              ? catalog.creatorLinks
              : {};
            if (link) catalog.creatorLinks[creator] = link;
            else delete catalog.creatorLinks[creator];
            saveCatalog();
            sendJson(res, {ok:true,link});
            return;
          }

          if (
            url.pathname === '/api/create-portrait' &&
            req.method === 'POST'
          ) {
            const body = await parseBody(req);
            const item = catalog.items.find(x => x.key === body.key);
            if (!item) {
              sendJson(res, {ok:false,error:'视频不存在'}, 404);
              return;
            }
            if (itemMediaKind(item) !== 'video') {
              sendJson(res, {ok:false,error:'仅支持视频'}, 400);
              return;
            }
            const rawCropX = body.cropX === undefined ? 0.5 : Number(body.cropX);
            if (!Number.isFinite(rawCropX) || rawCropX < 0 || rawCropX > 1) {
              sendJson(res, {ok:false,error:'水平裁剪位置无效'}, 400);
              return;
            }
            // 取 0.1% 精度；旧版居中裁剪数据默认视为 50%。
            const cropX = Math.round(rawCropX * 1000) / 1000;
            const existing = catalog.items.find(x =>
              x.portraitSourceKey === item.key &&
              Math.abs((Number.isFinite(Number(x.portraitCropX)) && x.portraitCropX !== undefined
                ? Number(x.portraitCropX) : 0.5) - cropX) < 0.0005 &&
              x.state === 'ready' &&
              fs.existsSync(managedPath(x))
            );
            if (existing) {
              sendJson(res, {ok:true,reused:true,item:itemPublic(existing)});
              return;
            }
            if (portraitJobs.has(item.key)) {
              sendJson(res, {ok:false,error:'此视频正在生成竖屏版，请勿重复提交'}, 409);
              return;
            }
            portraitJobs.add(item.key);
            beginMediaProgress(body.jobId,'生成竖屏视频');
            try {
              const created = await createPortraitFromItem(item, cropX,body.jobId);
              finishMediaProgress(body.jobId);
              sendJson(res, {ok:true,reused:false,item:itemPublic(created)});
            } catch (error) {
              finishMediaProgress(body.jobId,error);
              sendJson(res, {ok:false,error:error.message || '转换失败'}, 500);
            } finally {
              portraitJobs.delete(item.key);
            }
            return;
          }

          if (
            url.pathname ===
              '/api/clip' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            beginMediaProgress(body.jobId,'截取视频片段');
            try {
              const newItem =
                await createClipFromItem(
                  item,
                  body.start,
                  body.end,
                  body.jobId
                );
              finishMediaProgress(body.jobId);

              sendJson(
                res,
                {
                  ok:true,
                  item:
                    itemPublic(
                      newItem
                    )
                }
              );
            } catch (error) {
              finishMediaProgress(body.jobId,error);
              sendJson(
                res,
                {
                  ok:false,
                  error:
                    error.message
                },
                500
              );
            }

            return;
          }

          if (
            url.pathname ===
              '/api/update-rotation' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            if (
              itemMediaKind(
                item
              ) !==
              'video'
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'只有视频支持旋转'
                },
                400
              );
              return;
            }

            const rotation =
              Number(
                body.rotation
              );

            if (
              ![0,90,180,270]
                .includes(
                  rotation
                )
            ) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'旋转角度无效'
                },
                400
              );
              return;
            }

            item.rotation =
              rotation;

            saveCatalog();

            sendJson(
              res,
              {
                ok:true,
                rotation:
                  item.rotation
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/update-rating' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false
                },
                404
              );
              return;
            }

            const rating =
              Number(
                body.rating
              );

            item.rating =
              Math.max(
                0,
                Math.min(
                  5,
                  Number.isFinite(
                    rating
                  )
                    ? Math.round(
                        rating * 2
                      ) / 2
                    : 0
                )
              );

            saveCatalog();

            sendJson(
              res,
              {
                ok:true
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/set-cover' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  body.key
              );

            if (!item) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            let result;
            try {
              result=await writeCover(item,Number(body.time),body.precise === true,body.frameIndex);
            } catch (error) {
              sendJson(res,{ok:false,error:'生成封面失败：'+error.message},500);
              return;
            }

            if (!result) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'生成封面失败'
                },
                500
              );
              return;
            }

            saveCatalog();

            sendJson(
              res,
              {
                ok:true,
                cover:
                  '/asset/' +
                  encodeURIComponent(
                    item.cover
                  ),
                time:
                  item.coverTime
              }
            );

            return;
          }

          if (
            url.pathname ===
              '/api/delete' &&
            req.method ===
              'POST'
          ) {
            const body =
              await parseBody(
                req
              );

            const index =
              catalog.items.findIndex(
                x =>
                  x.key ===
                  body.key
              );

            if (index < 0) {
              sendJson(
                res,
                {
                  ok:false,
                  error:'媒体不存在'
                },
                404
              );
              return;
            }

            const item =
              catalog.items[
                index
              ];

            try {
              deleteIndexedMediaFile(item);

              removeCover(
                item
              );

              catalog.items.splice(
                index,
                1
              );

              saveCatalog();

              logStep(
                `已删除媒体：${item.creator || '未设置创作者'} · ${item.title}`
              );

              sendJson(
                res,
                {
                  ok:true
                }
              );
            } catch (error) {
              sendJson(
                res,
                {
                  ok:false,
                  error:
                    error.message
                },
                500
              );
            }

            return;
          }

          if (
            url.pathname.startsWith(
              '/asset/'
            )
          ) {
            const rel =
              decodeURIComponent(
                url.pathname.slice(
                  '/asset/'.length
                )
              );

            const full =
              path.resolve(
                ASSET_DIR,
                rel
              );

            const root =
              path.resolve(
                ASSET_DIR
              ) + path.sep;

            if (
              !full.startsWith(
                root
              ) ||
              !fs.existsSync(
                full
              )
            ) {
              res.writeHead(
                404
              );
              res.end();
              return;
            }

            const stat =
              fs.statSync(
                full
              );

            res.writeHead(
              200,
              {
                'Content-Type':
                  'image/jpeg',
                'Content-Length':
                  stat.size,
                'Cache-Control':
                  'public, max-age=86400'
              }
            );

            fs.createReadStream(
              full
            ).pipe(
              res
            );

            return;
          }

          if (
            url.pathname.startsWith(
              '/media/'
            )
          ) {
            const key =
              url.pathname.slice(
                '/media/'.length
              );

            const item =
              catalog.items.find(
                x =>
                  x.key ===
                  key &&
                  x.state ===
                  'ready'
              );

            if (!item) {
              res.writeHead(
                404
              );
              res.end();
              return;
            }

            streamMedia(
              req,
              res,
              item
            );

            return;
          }

          res.writeHead(
            404
          );
          res.end();
        } catch (error) {
          res.writeHead(
            500
          );
          res.end(
            error.message
          );
        }
      }
    );

  // Retry strictly on EADDRINUSE; never expose the server outside loopback.
  // After 20 consecutive conflicts let the OS allocate a free ephemeral port.
  let nextPort=PORT;
  let conflicts=0;
  server.on('error',error=>{
    if(error.code!=='EADDRINUSE'){
      console.error('本地服务启动失败：'+(error.code||error.message));
      process.exit(1);
      return;
    }
    conflicts++;
    const previous=nextPort;
    nextPort=(conflicts>=20 || previous>=65535)?0:previous+1;
    console.log(`端口 ${previous} 被占用，正在切换${nextPort?'到 '+nextPort:'至系统分配的空闲端口'}…`);
    server.listen(nextPort,HOST);
  });
  server.listen(nextPort,HOST,()=>{
    const address=server.address();
    const actualPort=address && address.port;
    const url=`http://127.0.0.1:${actualPort}/`;
    console.log(`Just Fun 已启动：${url}`);
    openUrl(url);
  });
}