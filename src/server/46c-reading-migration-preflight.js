// v7.12: deterministic, read-only Workspace v1 -> v2 preflight.
// This file intentionally has NO write, delete, rename, or migration function.
// The v2 protocol is not enabled; a preview is not permission to migrate.
const JF_READING_OBJECT_NAME=/^[a-f0-9]{64}$/;
function jfReadingMigrationManifest(workspace){
  if(!workspace||workspace.version!==1||!Number.isSafeInteger(workspace.revision)||
     !Array.isArray(workspace.notes))throw jfReaderError(409,'阅读数据格式不符合迁移预检要求');
  const objects=new Map();
  let refs=0,embeddedBytes=0;
  for(const note of workspace.notes){
    if(!note||typeof note!=='object')throw jfReaderError(409,'笔记内容损坏，无法预检');
    if(note.quotes===undefined)continue;
    if(!Array.isArray(note.quotes))throw jfReaderError(409,'摘录列表损坏，无法预检');
    for(const quote of note.quotes){
      if(!quote||typeof quote!=='object')throw jfReaderError(409,'摘录内容损坏，无法预检');
      if(quote.type!=='image')continue;
      // On legacy multi-page quotes the first image is also pages[0].
      // Count it exactly once, as jfReadingImageInventory has since v7.07.
      const pages=Array.isArray(quote.pages)&&quote.pages.length?quote.pages:[quote];
      for(const page of pages){
        const id=jfReadingImageIdentity(page?.image);
        if(!JF_READING_OBJECT_NAME.test(id.imageRef))throw jfReaderError(409,'图片身份不合法');
        refs++;embeddedBytes+=id.bytes;
        if(!objects.has(id.imageRef))objects.set(id.imageRef,Object.freeze({
          imageRef:id.imageRef,
          // Only derived from a SHA-256 digest, never from a client-provided path.
          relativePath:'objects/'+id.imageRef.slice(0,2)+'/'+id.imageRef+'.jpg',
          bytes:id.bytes,
          format:'jpeg'
        }));
      }
    }
  }
  const files=Object.freeze([...objects.values()].sort((a,b)=>a.imageRef.localeCompare(b.imageRef)));
  const uniqueBytes=files.reduce((sum,x)=>sum+x.bytes,0);
  return Object.freeze({version:1,revision:workspace.revision,embeddedCount:refs,
    uniqueCount:files.length,embeddedBytes,uniqueBytes,
    duplicateReferences:refs-files.length,estimatedPayloadSavingsBytes:embeddedBytes-uniqueBytes,
    // Encryption envelope sizing is only an estimate, not an allocation promise.
    estimatedEncryptedObjectBytes:files.reduce((sum,x)=>sum+Math.ceil(x.bytes/3)*4+180,0),
    files});
}
function jfReadingMigrationPreflight(){
  const healthy=jfReadingIntegrity(); // authenticates the backup at its own AAD path
  const hasMain=fs.existsSync(JF_READING_DATA);
  let manifest=null;
  const blockers=[...healthy.issues];
  if(!hasMain)blockers.push('workspace_not_initialized');
  if(healthy.ok&&hasMain){
    try{manifest=jfReadingMigrationManifest(jfReadingLoad());}
    catch{blockers.push('invalid_embedded_image_or_structure');}
  }
  return {ok:blockers.length===0,readOnly:true,dryRun:true,
    workspaceVersion:healthy.workspaceVersion,revision:healthy.revision,
    notes:healthy.notes,marks:healthy.marks,
    embeddedCount:manifest?.embeddedCount??null,uniqueCount:manifest?.uniqueCount??null,
    embeddedBytes:manifest?.embeddedBytes??null,uniqueBytes:manifest?.uniqueBytes??null,
    duplicateReferences:manifest?.duplicateReferences??null,
    estimatedEncryptedObjectBytes:manifest?.estimatedEncryptedObjectBytes??null,
    backupAuthenticated:healthy.backup.valid===true,
    snapshotRequired:healthy.backup.valid!==true,
    blockers:[...new Set(blockers)].sort(),
    // Deliberate P0 safety interlock until v2 reader/writer+rollback passes.
    migrationEnabled:false,requiresExplicitOptIn:true,
    scope:'authenticated-workspace-v1-and-backup-only',
    notChecked:['free-disk-space','orphan-objects','windows-dpapi','removable-drive','v2-write-recovery']};
}
