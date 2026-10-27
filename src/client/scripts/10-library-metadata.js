

const VIDEO_VIEW_PREF = 'justfun-video-view-v1';
let videoViewMode = 'cover';
try { videoViewMode = localStorage.getItem(VIDEO_VIEW_PREF) === 'text' ? 'text' : 'cover'; } catch (_) {}
function videoTextCard(item,stars){
  const key=esc(item.key), title=esc(item.displayName || item.title || '未命名');
  const author=String(item.creator||'').trim();
  const meta=[item.durationText, item.sizeText].filter(Boolean).map(esc).join(' <span class="metaSep">·</span> ');
  return '<article class="card mediaTile videoTextTile'+(mediaSelectedKeys.has(item.key)?' unifiedSelected':'')+'" data-key="'+key+'" data-media-key="'+key+'" data-favorite="'+(item.favorite?'true':'false')+'" tabindex="0" title="双击卡片播放">'+
    '<button type="button" class="mediaTileCheck" data-media-select="'+key+'" aria-label="选择视频">✓</button>'+
    '<div class="videoTextContent">'+
      '<div class="videoTextHeading"><span class="titleText" data-key="'+key+'" title="'+title+'">'+title+'</span><button type="button" class="unifiedMore" data-media-more="'+key+'" aria-label="更多文件操作">⋯</button></div>'+
      (author?'<div class="videoTextAuthor"><span class="creatorText" data-key="'+key+'" title="双击编辑作者：'+esc(author)+'">'+esc(author)+'</span>'+(item.creatorLink?'<a class="creatorLinkBtn" target="_blank" rel="noopener noreferrer" href="'+esc(item.creatorLink)+'" aria-label="作者链接">↗</a>':'')+'</div>':'')+
      '<div class="videoTextMeta">'+meta+'</div>'+
      '<div class="videoTextFoot"><div class="stars" data-key="'+key+'" data-rating="'+Number(item.rating||0)+'">'+stars+'<span class="ratingValue">'+Number(item.rating||0).toFixed(1)+'</span></div>'+
      '<button type="button" class="iconBtn multiBtn videoTextMulti" data-key="'+key+'" title="多开视频" aria-label="多开视频">'+studioIcon('multi')+'</button></div>'+
    '</div></article>';
}
function card(item) {
  const stars = [1,2,3,4,5]
    .map(n => {
      const fill =
        Math.max(
          0,
          Math.min(
            100,
            (Number(item.rating || 0) - (n - 1)) * 100
          )
        );

      return (
        '<button class="ratingStar" type="button">' +
          '<span class="ratingStarBase">★</span>' +
          '<span class="ratingStarFill" style="width:' + fill + '%">★</span>' +
        '</button>'
      );
    })
    .join('');

  if(videoViewMode==='text') return videoTextCard(item,stars);

  // Preserved aspect ratio follows the physical frame orientation, never CSS stretching.
  const dims = String(item.resolution || '').match(/(\d+)\s*[×xX]\s*(\d+)/);
  let frameW = dims ? Number(dims[1]) : 0;
  let frameH = dims ? Number(dims[2]) : 0;
  const rotation = ((Number(item.rotation || 0) % 360) + 360) % 360;
  if (rotation === 90 || rotation === 270) [frameW,frameH] = [frameH,frameW];
  const orientation = frameW && frameH && frameW >= frameH ? 'landscape' : 'portrait';
  const ratio = frameW && frameH ? Math.max(.52, Math.min(2.35,frameW/frameH)) : (orientation==='landscape'?16/9:9/16);
  return `
  <article class="card mediaTile jfCoverTile${mediaSelectedKeys.has(item.key) ? ' unifiedSelected' : ''}" data-key="${esc(item.key)}" tabindex="0" data-media-key="${esc(item.key)}" data-orientation="${orientation}" style="--jf-video-ratio:${ratio}" data-favorite="${item.favorite ? 'true' : 'false'}">
    <button type="button" class="mediaTileCheck" data-media-select="${esc(item.key)}" aria-label="选择媒体">✓</button>
    <div class="coverWrap" data-feed-key="${esc(item.key)}">
      ${item.cover ? '<img class="cover" loading="lazy" decoding="async" src="' + esc(item.cover) + '">' : '<div class="empty">暂无封面</div>'}
      <div class="badges">
        ${item.durationText ? '<span class="badge">' + esc(item.durationText) + '</span>' : ''}
        ${item.resolution ? '<span class="badge">' + esc(item.resolution) + '</span>' : ''}
      </div>
      <div class="body jfCoverInfo">
        <div class="creatorRow">
          <span class="creatorText" data-key="${esc(item.key)}" title="双击修改作者">${esc(item.creator || '未设置创作者')}</span>
          <button class="creatorEditBtn" type="button" data-key="${esc(item.key)}" title="修改作者" aria-label="修改作者">${studioIcon('rename')}</button>
          ${item.creatorLink ? '<a class="creatorLinkBtn" href="' + esc(item.creatorLink) + '" target="_blank" rel="noopener noreferrer" title="访问作者链接" aria-label="访问作者链接">↗</a>' : ''}
          <button class="creatorLinkBtn creatorLinkCardEdit" type="button" data-creator="${esc(item.creator || '')}" title="编辑作者链接" aria-label="编辑作者链接">${studioIcon('link')}</button>
        </div>
        <span class="titleText" data-key="${esc(item.key)}" title="双击修改名称">${esc(item.displayName || item.title || '未命名')}</span>
        <div class="actions">
          <div class="stars" data-key="${esc(item.key)}" data-rating="${Number(item.rating || 0)}">${stars}<span class="ratingValue">${Number(item.rating || 0).toFixed(1)}</span></div>
          <div class="iconActions">
            <button type="button" class="unifiedMore" data-media-more="${esc(item.key)}" title="更多文件操作" aria-label="更多文件操作">⋯</button>
            <button class="iconBtn multiBtn" type="button" data-key="${esc(item.key)}" title="多开" aria-label="多开">${studioIcon('multi')}</button>
            <button class="iconBtn deleteBtn" type="button" data-key="${esc(item.key)}" title="删除媒体" aria-label="删除媒体">${studioIcon('delete')}</button>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

async function renameCreatorEverywhere(
  oldName
) {
  const from =
    String(oldName || '').trim();

  if (!from) {
    return;
  }

  const entered =
    prompt(
      '统一修改作者名\n将「' +
      from +
      '」修改为：',
      from
    );

  if (entered === null) {
    return;
  }

  const to =
    String(entered).trim();

  if (!to) {
    alert('作者名不能为空');
    return;
  }

  if (to === from) {
    return;
  }

  try {
    const response =
      await fetch(
        '/api/update-creator-bulk',
        {
          method:'POST',
          headers:{
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              from,
              to
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.ok
    ) {
      throw new Error(
        data.error ||
        '统一修改失败'
      );
    }

    allItems.forEach(
      item => {
        if (
          String(
            item.creator || ''
          ).trim() === from
        ) {
          item.creator = to;
        }
      }
    );

    if (
      selectedCreator === from
    ) {
      selectedCreator = to;
    }

    renderCreatorTags();
    render();
  } catch (error) {
    alert(
      error.message ||
      '统一修改失败'
    );
  }
}

function normalizeCreatorLink(value) {
  let link = String(value || '').trim();
  if (!link) return '';
  const lower = link.toLowerCase();
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    link = 'https://' + link;
  }
  try {
    const parsed = new URL(link);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

async function editCreatorLink(creatorName) {
  const creator = String(creatorName || '').trim();
  if (!creator) {
    alert('请先设置作者名');
    return;
  }

  const sample = allItems.find(item => String(item.creator || '').trim() === creator);
  const current = sample ? String(sample.creatorLink || '') : '';
  const entered = prompt('作者链接：\n留空可删除链接', current);
  if (entered === null) return;

  const raw = String(entered).trim();
  const link = normalizeCreatorLink(raw);
  if (raw && !link) {
    alert('链接格式无效，请输入 http:// 或 https:// 链接');
    return;
  }

  try {
    const response = await fetch('/api/update-creator-link', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ creator, link })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '保存失败');

    allItems.forEach(item => {
      if (String(item.creator || '').trim() === creator) item.creatorLink = link;
    });
    renderCreatorTags();
    render();
  } catch (error) {
    alert(error.message || '保存失败');
  }
}

function renderCreatorTags() {
  const counts = new Map();

  for (const item of allItems.filter(x => x.kind === 'video')) {
    const creator =
      String(item.creator || '').trim();

    if (!creator) continue;

    counts.set(
      creator,
      (counts.get(creator) || 0) + 1
    );
  }

  if (
    selectedCreator &&
    !counts.has(selectedCreator)
  ) {
    selectedCreator = '';
  }

  const creators =
    [...counts.entries()]
      .sort(
        (a,b) =>
          b[1] - a[1] ||
          a[0].localeCompare(b[0], 'zh-CN')
      );

  document.querySelector('#creatorTags').innerHTML =
    [
      '<button class="creatorTag ' +
        (!selectedCreator ? 'on' : '') +
        '" data-creator="">全部 ' +
        allItems.filter(x=>x.kind==='video').length +
        '</button>',
      ...creators.map(
        ([name,count]) =>
          '<span class="creatorTagGroup">' +
            '<button class="creatorTag ' +
            (selectedCreator === name ? 'on' : '') +
            '" data-creator="' +
            esc(name) +
            '" title="' +
            esc(name) +
            ' · ' +
            count +
            ' 个作品">' +
            esc(name) +
            ' ' +
            count +
            '</button>' +
            '<button class="creatorRename" type="button" data-creator="' +
            esc(name) +
            '" title="统一修改该作者名" aria-label="统一修改 ' +
            esc(name) +
            ' 的作者名">✎</button>' +
            (allItems.some(item => String(item.creator || '').trim() === name && item.creatorLink)
              ? '<a class="creatorLinkEdit" href="' + esc((allItems.find(item => String(item.creator || '').trim() === name && item.creatorLink) || {}).creatorLink || '') + '" target="_blank" rel="noopener noreferrer" title="访问作者链接">↗</a>'
              : '') +
            '<button class="creatorLinkEdit" type="button" data-creator-link-edit="' + esc(name) + '" title="编辑作者链接">🔗</button>' +
          '</span>'
      )
    ].join('');

  document
    .querySelectorAll(
      '.creatorTag'
    )
    .forEach(
      button => {
        button.addEventListener(
          'click',
          () => {
            selectedCreator =
              button.dataset.creator || '';

            renderCreatorTags();
            render();
          }
        );
      }
    );

  document
    .querySelectorAll(
      '.creatorRename'
    )
    .forEach(
      button => {
        button.addEventListener(
          'click',
          event => {
            event.preventDefault();
            event.stopPropagation();

            renameCreatorEverywhere(
              button.dataset.creator || ''
            );
          }
        );
      }
    );

  document.querySelectorAll('[data-creator-link-edit]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      editCreatorLink(button.dataset.creatorLinkEdit || '');
    });
  });

  document.querySelector('#creatorToggle').textContent =
    '创作者' +
    (creators.length
      ? ' · ' + creators.length + '人'
      : '') +
    (creatorOpen ? ' ▴' : ' ▾');
}

// 素材区：目录显示原名；实际目录/文件仍然是 hash。
function folderDisplayName(relativeDir) {
  if (relativeDir === 'root') return '原媒体目录';
  if (relativeDir === 'data') return 'data';
  if (relativeDir === 'source') return '工作学习目录';
  if (relativeDir === 'data/1001') return '截图与精选帧';
  if (relativeDir === 'data/1002') return '提取的音轨';
  const folder = allFolders.find(x=>x.relativeDir===relativeDir);
  return folder ? folder.originalName : relativeDir;
}

function audioDisplayName(item) {
  return item.displayName || item.originalName || item.title || '未命名音频';
}
function unifiedMediaName(item) {
  if (!item) return '';
  if (item.displayName) return item.displayName;
  if (item.kind === 'video') {
    const base=item.title || item.originalName || '未命名视频';
    const ext=item.originalExt || '';
    return base + (ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? ext : '');
  }
  return item.originalName || item.title || '未命名素材';
}
function naturalFileOrder(a,b) {
  const an = unifiedMediaName(a);
  const bn = unifiedMediaName(b);
  const diff = filenameCollator.compare(an,bn);
  return (fileSortAscending ? 1 : -1) * (diff || a.key.localeCompare(b.key));
}

// 单曲循环默认开启；A-B 循环优先于整曲循环。用户可逐条设置 A/B。
const AUDIO_LOOP_STORAGE_KEY = 'douyin-audio-single-loop';