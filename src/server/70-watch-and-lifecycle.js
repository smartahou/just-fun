

function openUrl(url) {
  try {
    if (
      process.platform ===
      'win32'
    ) {
      spawn(
        'cmd',
        [
          '/c',
          'start',
          '',
          url
        ],
        {
          detached:true,
          stdio:'ignore',
          windowsHide:true
        }
      ).unref();
    } else if (
      process.platform ===
      'darwin'
    ) {
      spawn(
        'open',
        [url],
        {
          detached:true,
          stdio:'ignore'
        }
      ).unref();
    } else {
      spawn(
        'xdg-open',
        [url],
        {
          detached:true,
          stdio:'ignore'
        }
      ).unref();
    }
  } catch {}
}

let watcher = null;
let dataWatcher = null;
let watchTimer = null;
let safetyTimer = null;

// USB drives can enter firmware/bridge standby while a video is paused or the
// browser is idle. Keep the SELECTED library mildly active without creating
// files or touching media contents beyond a tiny read-only sample.
// Best effort only: USB bridges, Windows power policy or a disconnected drive
// may still suspend access. --no-drive-awake disables background reads.
const DRIVE_AWAKE_ENABLED = !args.includes('--no-drive-awake');
const DRIVE_AWAKE_MS = 45000;
let driveAwakeTimer = null;
let driveAwakeBusy = false;
let driveAwakeSample = 0;
let driveAwakeCursor = 0;
let driveAwakeFailureReported = false;

async function touchDriveReadOnly() {
  if (driveAwakeBusy) return;
  driveAwakeBusy = true;
  try {
    // Traverse indexed media without allocating a second array of all ready
    // items every 45 seconds (large 20k+ libraries can remain open for days).
    const items = catalog.items;
    if (items.length) {
      let touched = false;
      let candidates = 0;
      for (let visited = 0; visited < items.length && candidates < 4; visited++) {
        const item = items[(driveAwakeCursor++ % items.length)];
        if (item.state !== 'ready' || !(Number(item.size) > 0)) continue;
        candidates++;
        let handle;
        try {
          const file = managedPath(item);
          handle = await fs.promises.open(file, 'r');
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size < 1) continue;
          const buffer = Buffer.allocUnsafe(4096);
          const maxPosition = Math.max(0, stat.size - buffer.length);
          const position = maxPosition ? (driveAwakeSample++ * 4194304) % maxPosition : 0;
          await handle.read(buffer, 0, Math.min(buffer.length, stat.size), position);
          touched = true;
          break;
        } catch { /* Removed or locked media: try another indexed item. */ }
        finally { if (handle) await handle.close().catch(() => {}); }
      }
      if (!touched) await fs.promises.readdir(targetDir);
    } else {
      await fs.promises.readdir(targetDir);
    }
    driveAwakeFailureReported = false;
  } catch(error) {
    // Never crash the server when a portable drive is unplugged or sleeps.
    if (!driveAwakeFailureReported) {
      driveAwakeFailureReported = true;
      logStep('磁盘保活暂时不可用：' + (error.code || error.message));
    }
  } finally { driveAwakeBusy = false; }
}

function startDriveAwake() {
  if (!DRIVE_AWAKE_ENABLED || driveAwakeTimer) return;
  driveAwakeTimer = setInterval(() => void touchDriveReadOnly(), DRIVE_AWAKE_MS);
  driveAwakeTimer.unref?.();
  logStep('磁盘轻量保活：每 45 秒只读访问一次（--no-drive-awake 可关闭）');
}


function scheduleRescan(
  message
) {
  clearTimeout(
    watchTimer
  );

  watchTimer =
    setTimeout(
      () => {
        scanAll(
          message
        ).catch(
          error => {
            logStep(
              `自动更新失败：${error.message}`
            );
          }
        );
      },
      1200
    );
}

function startAutoWatch() {
  try {
    dataWatcher = fs.watch(DATA_DIR, {persistent:true, recursive:process.platform === 'win32'}, (eventType, name) => {
      // 文件夹批量粘贴后尽快索引，macOS/Linux 的深层目录仍由定时扫描兜底。
      scheduleRescan('新增素材目录…');
    });
    dataWatcher.on('error', () => {});
  } catch {}
  try {
    watcher =
      fs.watch(
        targetDir,
        {
          persistent:true
        },
        (
          eventType,
          fileName
        ) => {
          const name =
            String(
              fileName || ''
            );

          // 缓存目录自身变化不触发再次扫描。
          if (
            name ===
              path.basename(
                CACHE_DIR
              ) ||
            name.startsWith(
              path.basename(
                CACHE_DIR
              ) +
              path.sep
            )
          ) {
            return;
          }

          // 新视频通常带扩展名；已有 hash 文件删除/变化也允许触发 reconcile。
          if (
            name &&
            path.extname(
              name
            ) &&
            !MEDIA_EXTENSIONS.has(
              path
                .extname(name)
                .toLowerCase()
            )
          ) {
            return;
          }

          logStep(
            `目录变化：${eventType}${name ? ` · ${name}` : ''}`
          );

          scheduleRescan(
            '检测到目录变化，自动更新…'
          );
        }
      );

    watcher.on(
      'error',
      error => {
        logStep(
          `实时目录监控异常：${error.message}`
        );
      }
    );

    logStep(
      '实时监控：已启用 fs.watch'
    );
  } catch (error) {
    logStep(
      `实时监控启动失败：${error.message}`
    );
  }

  // Windows 的 fs.watch 偶尔会漏事件，因此每 15 秒兜底扫描。
  safetyTimer =
    setInterval(
      () => {
        // A running scan is already checking the filesystem. Queuing an extra
        // full pass every 15s during slow disks amplifies load without helping
        // catch missed fs.watch events; the next tick remains the fallback.
        if (scanRunning) return;
        scanAll(
          '15 秒兜底扫描…'
        ).catch(
          () => {}
        );
      },
      15000
    );

  if (
    safetyTimer &&
    typeof safetyTimer.unref ===
      'function'
  ) {
    safetyTimer.unref();
  }

  logStep(
    '兜底扫描：每 15 秒检查一次新增媒体'
  );
}

// --doctor is deliberately side-effect-free: no password prompt, media scan,
// cache migration, startup server, or user-library path probing.
function jfPrintRuntimeDoctor(){
  const checkCommand=(name)=>{
    try{const result=spawnSync(name,['-version'],{encoding:'utf8',timeout:3500,windowsHide:true});
      return {available:result.status===0,version:String(result.stdout||result.stderr||'').split(/\r?\n/)[0].slice(0,140)};
    }catch{return {available:false,version:''};}
  };
  const output={mode:'doctor',readOnly:true,mediaDirectoryTouched:false,
    node:process.versions.node,platform:process.platform,arch:process.arch,
    nodeCompatible:(()=>{const [major,minor]=process.versions.node.split('.').map(Number);return major>=24 || (major===22&&minor>=13);})(),
    bundledPdfJsAssets:Object.keys(JF_PDFJS_VENDOR).length,
    ffmpeg:checkCommand('ffmpeg'),ffprobe:checkCommand('ffprobe')};
  console.log(JSON.stringify(output,null,2));
}

async function main() {
  if(DOCTOR_MODE){jfPrintRuntimeDoctor();return;}
  if (!BACKUPS_MODE) console.log('Just Fun：目录已输入，正在检查安全设置…');
  if (BACKUPS_MODE) {
    printExternalBackups();
    return;
  }

  if (
    !fs.existsSync(
      targetDir
    ) ||
    !fs.statSync(
      targetDir
    ).isDirectory()
  ) {
    console.error(
      '目录不可用'
    );

    process.exit(1);
  }

  // --hash and --pwd remain deliberate, user-selected library settings.
  // Do not infer directory purpose from its contents; do not emit a redundant
  // Hash+password startup notice. Authentication and three-failure behavior
  // remain unchanged in the security module.

  // Authenticate the user BEFORE reading even an encrypted index; no startup leak.
  persistLibrarySettings();
  const unlockedPassword=PWD_ENABLED ? await unlockLibrary() : null;
  if(PWD_ENABLED&&!unlockedPassword){
    if(nonTtyLineReader)nonTtyLineReader.close();
    process.exitCode=2;return;
  }
  vaultUnlock(unlockedPassword);
  if(RESTORE_MODE){
    const restored=await restoreFromExternalBackup(restoreBackupPath);
    if(!restored){process.exitCode=1;return;}
  }
  loadCatalogAfterUnlock();
  if(catalogLoadError){
    console.error(catalogLoadError.message||'缓存异常，已停止启动以保护历史数据');
    process.exitCode=1;return;
  }

  // 如果主 data.json 损坏/丢失而使用了 .bak，先恢复主文件，
  // 后续扫描仍然基于历史 catalog，而不是空库。
  if (catalogLoadedFromBackup) {
    try {
      fs.mkdirSync(
        CACHE_DIR,
        { recursive:true }
      );

      const restored =
        DATA_FILE +
        '.restore-' +
        process.pid;

      fs.writeFileSync(restored,vaultEncrypt(DATA_FILE,JSON.stringify(catalog)),{mode:0o600});

      fs.renameSync(restored,DATA_FILE);
    } catch (error) {
      console.error(
        '缓存备份恢复失败，已停止启动'
      );

      process.exitCode =
        1;

      return;
    }
  }

    logStep(
    '已选择媒体目录'
  );

  console.log('Just Fun：安全检查完成，正在读取媒体库配置…');

  console.log('Just Fun：正在准备缓存与索引（不会清理原始媒体）…');
  ensureDirs();
  ensureAiUsageNotice();

  try {
    ensureCatalogLibraryId();

    if (PWD_ENABLED) {
      createEncryptedRunBackup(unlockedPassword);
      vaultMigrateLegacyMetadata();
    }
  } catch (error) {
    console.error(
      '安全备份失败，已停止启动'
    );

    process.exitCode = 1;
    return;
  }


  logStep(
    `缓存：${CACHE_DIR}`
  );

  logStep(
    `ffprobe：${HAS_FFPROBE ? '已找到' : '未找到'}`
  );

  logStep(
    `ffmpeg：${HAS_FFMPEG ? '已找到' : '未找到'}`
  );

  console.log('Just Fun：正在检查历史索引…');
  recoverPendingImports();

  // v1.1.6：旧版缓存可能没有 kind 字段，启动时自动补齐 video / image。
  migrateLegacyItemKinds();

  // 旧缓存没有文件修改时间字段时，直接从真实媒体文件补齐。
  syncFileModificationTimes();

  // v1.1.1：把旧版本已经生成的 .jpg/.png 封面也改成无扩展名 hash。
  migrateLegacyCoverFiles();

  // 保留已完成的低清逐帧缓存，加速下次进入；未完成的任务会按需重新生成。
  // Cleanup of old preview JPEGs is async; it must never stall startup.
  setImmediate(()=>void pruneFramePreviewCache());
  fs.mkdirSync(DATA_DIR,{recursive:true});
  console.log('Just Fun：正在启动本地服务…');
  startServer();
  startAutoWatch();
  startDriveAwake();
  setTimeout(()=>sweepAudioDurations().catch(()=>{}),5000).unref?.();
  setInterval(()=>sweepAudioDurations().catch(()=>{}),300000).unref?.();

  setTimeout(
    () => {
      scanAll(
        '启动扫描…'
      ).catch(
        error => {
          void error;
        }
      );
    },
    250
  );
}

function shutdown() {
  if (driveAwakeTimer) {clearInterval(driveAwakeTimer);driveAwakeTimer=null;}
  stopActiveMediaChildren();
  for (const job of framePreviewJobs.values()) {try{job.child?.kill('SIGTERM');}catch{}}
  try {
    if (watcher) watcher.close();
    if (dataWatcher) dataWatcher.close();
  } catch {}

  try {
    if (safetyTimer) {
      clearInterval(
        safetyTimer
      );
    }
  } catch {}

  process.exit(0);
}

process.on(
  'SIGINT',
  shutdown
);

process.on(
  'SIGTERM',
  shutdown
);

main().catch(
  error => {
    console.error('启动失败：'+(error && error.message || '未知错误'));
    console.error('请勿删除媒体或缓存；检查目录权限、磁盘可用空间及启动日志。');

    process.exitCode =
      1;
  }
);
