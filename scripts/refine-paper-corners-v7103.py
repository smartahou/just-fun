#!/usr/bin/env python3
"""v7.103 paper: subtly wear the outer two corners of all 8 paired spreads.

Read the pinned v7.102 sources, preserve paper tone and original wear. Only
reduce corner alpha inside a small irregular elliptical edge. The large v7.91
CSS corner mask must stay removed; these are physical photo silhouettes.
"""
import base64
import hashlib
import io
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE="aa91dbde45a47275b9009faa3aa23c7519d31305"
ASSETS=ROOT/"assets/paper-spreads"
PATCH_SIZE=32

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def original(rel):
    return subprocess.check_output(["git","show",BASE+":"+rel],cwd=ROOT)

def encode(im,quality):
    dst=io.BytesIO()
    im.save(dst,format="WEBP",quality=quality,method=5,exact=True)
    return dst.getvalue()

def soften(im,side,idx):
    pixels=np.asarray(im.convert("RGBA")).copy()
    h,w,_=pixels.shape
    if (w,h)!=(960,1440):
        raise ValueError("Unexpected source resolution")
    is_left=side=="left"
    count=0
    radii=[]
    for bottom in (False,True):
        # 5-9 final display pixels, not 18-34 CSS pixels:
        # horizontal and vertical curvature are intentionally unequal.
        rx=11+(idx*3+(1 if bottom else 0))%5
        ry=13+(idx*5+(2 if bottom else 0))%6
        radii.append([rx,ry])
        ys,xs=np.mgrid[0:PATCH_SIZE,0:PATCH_SIZE]
        gx=xs if is_left else w-1-xs
        gy=(h-1-ys) if bottom else ys
        old=pixels[gy,gx].copy()
        # Quarter ellipse with tiny, deterministic edge fluctuations: this is
        # a softened, rubbed-off paper corner, never a uniform UI border radius.
        distance=np.sqrt(((rx-xs)/rx)**2+((ry-ys)/ry)**2)
        ripple=.020*np.sin(xs*.78+idx*.83+int(bottom)) + .012*np.sin(ys*.61+idx*.53)
        signed=(1-distance-ripple)*min(rx,ry)
        mask=np.clip(.5+signed/1.3,0,1)
        cap=np.rint(mask*255).astype(np.uint8)
        new_alpha=np.minimum(old[:,:,3],cap)
        count+=int(np.count_nonzero(new_alpha!=old[:,:,3]))
        old[:,:,3]=new_alpha
        old[new_alpha==0,:3]=0
        pixels[gy,gx]=old
    return Image.fromarray(pixels,"RGBA"),{"alpha_pixels_refined":count,"radii_image_px":radii}

def main():
    m=json.loads((ASSETS/"manifest.json").read_text("utf8"))
    if m["version"]!="3.1-corner-refined" or len(m["assets"])!=16:
        raise ValueError("This script expects the v7.102 masters")
    audit={"version":"7.103.0","source_commit":BASE,"method":"small asymmetric rubbed-paper alpha at outer corners only","assets":[]}
    for i,s in enumerate(m["assets"]):
        filename=s["file"]
        src=original("assets/paper-spreads/"+filename)
        if sha(src)!=s["sha256"]:
            raise ValueError("Unexpected v7.102 original: "+filename)
        img=Image.open(io.BytesIO(src))
        edited,metrics=soften(img,s["side"],i+1)
        master=encode(edited,95)
        (ASSETS/filename).write_bytes(master)
        s["v7102_sha256"]=s["sha256"]
        s["sha256"]=sha(master)
        s["bytes"]=len(master)
        s["corner_revision"]="v7.103 slight asymmetric matte paper wear, source photograph preserved"
        runtime=encode(edited,83)
        group_path=ASSETS/"runtime"/("group-%02d.json"%(i//2+1))
        if i%2==0:
            group={"version":"7.103.0","group":i//2+1,"assets":[]}
        group["assets"].append({
            "file":filename,"bytes":len(runtime),
            "sourceSha256":s["sha256"],"runtimeSha256":sha(runtime),
            "base64":base64.b64encode(runtime).decode("ascii")
        })
        if i%2:group_path.write_text(json.dumps(group,ensure_ascii=False,separators=(",",":"))+"\n","utf8")
        audit["assets"].append({"file":filename,"before":s["v7102_sha256"],"after":s["sha256"],**metrics})
    m["version"]="3.2-subtle-natural-corners"
    m["source"]="v7.102 photographed leaves, slight v7.103 corner abrasion"
    m["texture_usage"]="Original matched photo grain retained; 16 revised alpha photos and 8 offline runtime groups SHA verified"
    (ASSETS/"manifest.json").write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n","utf8")
    (ASSETS/"corner-refinement-v7103.json").write_text(json.dumps(audit,ensure_ascii=False,indent=2)+"\n","utf8")

    pkg_path=ROOT/"package.json"
    pkg=json.loads(pkg_path.read_text("utf8"))
    pkg["version"]="7.103.0"
    pkg["scripts"]["test:reading-boundary"]="node tests/paged-forward-boundary-v7103.js"
    if "tests/paged-forward-boundary-v7103.js" not in pkg["scripts"]["test:epub-paper"]:
        pkg["scripts"]["test:epub-paper"]+=" && node tests/paged-forward-boundary-v7103.js"
    pkg_path.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+"\n","utf8")
    lock_path=ROOT/"package-lock.json"
    lock=json.loads(lock_path.read_text("utf8"))
    lock["version"]="7.103.0"
    lock["packages"][""]["version"]="7.103.0"
    lock_path.write_text(json.dumps(lock,ensure_ascii=False,indent=2)+"\n","utf8")

    test_path=ROOT/"tests/paper-corners-v791.js"
    test=test_path.read_text("utf8")
    test=test.replace("assert.equal(manifest.version,'3.1-corner-refined');",
                      "assert.equal(manifest.version,'3.2-subtle-natural-corners');")
    test=test.replace("console.log('PASS v7.102: photographed corner alpha, no CSS-rounded cards, 8 matched pairs');",
                      "assert(manifest.assets.every(x=>x.v7102_sha256),'v7.102 reference preserved');\n"
                      "console.log('PASS v7.103: subtle photo alpha corners, 8 matched pairs, no UI-radius');")
    test_path.write_text(test,"utf8")
    assert sum(x["alpha_pixels_refined"] for x in audit["assets"])>0
    print("PASS v7.103: 16 subtly softened outside-paper corners, 8 regenerated runtime pairs")
    for r in audit["assets"]:
        print(r["file"],"alpha corrections",r["alpha_pixels_refined"],"radii",r["radii_image_px"])

if __name__=="__main__":
    main()
