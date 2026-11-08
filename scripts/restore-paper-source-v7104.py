#!/usr/bin/env python3
"""v7.104 conservative visual repair: restore EXACT approved v7.101 photos.

The observed v7.103 dark right-angle corner gaps are caused by the custom
ellipse-alpha punches. The earlier v7.102 pixel continuation also replaced
authentic photographic pigments. The original scanned leaf photos are the
correct source of truth; do not reconstruct, mask, or retouch their pixels.

The v7.91 CSS border-radius (18–34px) was the primary exaggeration of those
corners. v7.104 keeps border-radius:0 on the sheet/overlay so that *only the
original photographed alpha* determines the visible contour.
"""
import json
import hashlib
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APPROVED="ec22e318b383750d2483c95ff3bff2ca3d592b4b"
ASSETS=ROOT/"assets/paper-spreads"

def source(path):
    return subprocess.check_output(["git","show",f"{APPROVED}:{path}"],cwd=ROOT)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    manifest_rel="assets/paper-spreads/manifest.json"
    manifest_raw=source(manifest_rel)
    manifest=json.loads(manifest_raw)
    assert manifest["version"]=="3.0-approved"
    assert manifest["images"]==16 and manifest["pairs"]==8
    assert len(manifest["assets"])==16

    details=[]
    # Byte-identical source masters, not a lossy re-export from the damaged
    # v7.102/v7.103 photos. Likewise for runtime photo bundles: no mismatch
    # between the source folder and what the offline browser actually paints.
    for i,spec in enumerate(manifest["assets"]):
        name=spec["file"]
        rel="assets/paper-spreads/"+name
        raw=source(rel)
        assert spec["sha256"]==digest(raw) and spec["bytes"]==len(raw)
        (ASSETS/name).write_bytes(raw)
        details.append({"file":name,"original_sha256":digest(raw),
                        "source_bytes":len(raw),"source_commit":APPROVED})
    for n in range(1,9):
        rel=f"assets/paper-spreads/runtime/group-{n:02}.json"
        group=json.loads(source(rel))
        assert group["group"]==n and len(group["assets"])==2
        for j,photo in enumerate(group["assets"]):
            assert photo["file"]==manifest["assets"][(n-1)*2+j]["file"]
            assert photo["sourceSha256"]==manifest["assets"][(n-1)*2+j]["sha256"]
        (ROOT/rel).write_bytes(source(rel))
    (ROOT/manifest_rel).write_bytes(manifest_raw)

    css_path=ROOT/"src/client/styles/41-reading.css"
    css=css_path.read_text("utf8")
    old="""/* v7.102 · The revised WebP photographs own the visible leaf contour.
   Do not clip old paper into an 18–34px UI-card ellipse; genuine edges and
   corner damage come from the verified alpha channel of each paired image.
   Keep the independent full-height book binding and page-layout untouched. */"""
    new="""/* v7.104 · Unaltered approved photographic paper edges.
   These 16 WebP masters and all eight runtime bundles have been restored
   byte-for-byte from v7.101. The old 18–34px CSS ellipse was the cause of
   exaggerated card-like corners; v7.102/v7.103 re-encoded and cut the
   photographs, creating unnatural black voids that exposed the book cover.
   No additional CSS clip, radius, mask or alpha manipulation is permitted:
   the original scanned photograph owns the full visible paper silhouette.
   The physical cover, spine, page stacks and layout are untouched. */"""
    if css.count(old)!=1:
        raise RuntimeError("CSS override must match exactly once")
    css=css.replace(old,new)
    css_path.write_text(css,"utf8")

    # Update only the targeted historical regression whose previous assertions
    # enforced the very processed WebPs we are explicitly rolling back.
    test=ROOT/"tests/paper-corners-v791.js"
    code=test.read_text("utf8")
    code=code.replace("/* v7.102 · The revised WebP photographs",
                      "/* v7.104 · Unaltered approved photographic paper edges")
    code=code.replace("assert.equal(manifest.version,'3.2-subtle-natural-corners');",
                      "assert.equal(manifest.version,'3.0-approved');")
    code=code.replace("assert(manifest.assets.every(x=>x.corner_revision&&x.original_sha256));",
                      "assert(manifest.assets.every(x=>!x.corner_revision&&!x.v7102_sha256));")
    code=code.replace("assert(manifest.assets.every(x=>x.v7102_sha256),'v7.102 reference preserved');",
                      "assert(manifest.assets.every(x=>x.sha256&&x.bytes>1000),'approved originals retained');")
    code=code.replace("console.log('PASS v7.103: subtle photo alpha corners, 8 matched pairs, no UI-radius');",
                      "console.log('PASS v7.104: 16 byte-identical approved photos, no CSS card-radius or alpha cuts');")
    test.write_text(code,"utf8")
    pkg_path=ROOT/"package.json"
    pkg=json.loads(pkg_path.read_text("utf8"))
    pkg["version"]="7.104.0"
    pkg_path.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+"\n","utf8")
    lock_path=ROOT/"package-lock.json"
    lock=json.loads(lock_path.read_text("utf8"))
    lock["version"]="7.104.0"
    lock["packages"][""]["version"]="7.104.0"
    lock_path.write_text(json.dumps(lock,ensure_ascii=False,indent=2)+"\n","utf8")
    # V7.102/V7.103 image modification scripts remain archived for forensic
    # reproducibility, but neither is part of the build or invoked here.
    audit=ASSETS/"paper-source-restore-v7104.json"
    audit.write_text(json.dumps({
        "version":"7.104.0",
        "decision":"Preserve real photo, remove CSS artificial curvature",
        "approved_commit":APPROVED,
        "originals_exact":True,
        "asset_count":16,"paired_runtime_groups":8,
        "previous_damaged_versions":["7.102.0","7.103.0"],
        "assets":details
    },ensure_ascii=False,indent=2)+"\n","utf8")
    print("PASS v7.104 — restored 16 untouched paper photographs and 8 exact runtime bundles")
    for row in details:
        print(row["file"],row["original_sha256"][:16],row["source_bytes"])
if __name__=="__main__":
    main()
