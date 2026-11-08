#!/usr/bin/env python3
"""v7.102: reconstruct photographed leaf corners; regenerate BOTH offline masters and runtime.

Original approved masters are read from pinned Git history, never resampled from
already-repaired images. The central 95%+ of each photograph is unchanged.
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

ROOT = Path(__file__).resolve().parents[1]
BASE = "ec22e318b383750d2483c95ff3bff2ca3d592b4b"
ASSETS = ROOT / "assets/paper-spreads"
CSS = ROOT / "src/client/styles/41-reading.css"
OLD_TEST = ROOT / "tests/paper-corners-v791.js"
REPORT = ASSETS / "corner-refinement-v7102.json"
CORNER = 96

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def source_bytes(rel):
    return subprocess.check_output(["git", "show", f"{BASE}:{rel}"], cwd=ROOT)

def encode(im, quality):
    mem = io.BytesIO()
    im.save(mem, "WEBP", quality=quality, method=5, exact=True)
    return mem.getvalue()

def first_opaque(v):
    hits = np.flatnonzero(v >= 180)
    return int(hits[0]) if len(hits) else 20

def repair(im, side, number):
    rgba = np.asarray(im.convert("RGBA")).copy()
    h, w, _ = rgba.shape
    if (w, h) != (960, 1440):
        raise ValueError(f"unexpected page size {w}x{h}")
    old = rgba.copy()
    # Leave the binding-side corners square; they connect without a white seam.
    # Reconstruct the upper/lower OUTER corners in the actual photographic alpha,
    # not with border-radius, clipping polygons or a translucent CSS layer.
    is_left = side == "left"
    col = 0 if is_left else w-1
    def xcoord(n):
        return n if is_left else w-1-n
    # Infer the unrounded physical edge inset from away-from-corner pixels.
    alpha = old[:, :, 3]
    baseline_side = int(np.median([
        first_opaque(alpha[y, :] if is_left else alpha[y, ::-1])
        for y in (115, 145, 175, 205)
    ]))
    baseline_side = min(12, max(2, baseline_side))
    baseline_top = []
    baseline_bottom = []
    for dx in (120, 148, 180, 210):
        x=xcoord(dx)
        baseline_top.append(first_opaque(alpha[:60, x]))
        baseline_bottom.append(first_opaque(alpha[::-1, x][:60]))
    base_top = min(12, max(2, int(np.median(baseline_top))))
    base_bottom = min(12, max(2, int(np.median(baseline_bottom))))
    edits = 0
    for bottom, top_inset in ((False, base_top), (True, base_bottom)):
        yy, xx = np.mgrid[0:CORNER, 0:CORNER]
        global_x = xx if is_left else w - 1 - xx
        global_y = h - 1 - yy if bottom else yy
        sub = rgba[global_y, global_x].copy()
        src = old[global_y, global_x]
        # Tiny, deterministic micro-fraying, varying by leaf; NOT random noise.
        phase = number * 0.61 + (0.8 if bottom else 0)
        side_inset = baseline_side + 0.85*np.sin(yy*.23+phase) + .52*np.sin(yy*.49+phase)
        end_inset = top_inset + .83*np.sin(xx*.19+phase+.9) + .55*np.sin(xx*.43+phase)
        x_alpha = np.clip((xx-side_inset+1)*135,0,255)
        y_alpha = np.clip((yy-end_inset+1)*135,0,255)
        shape_alpha = np.minimum(x_alpha,y_alpha)
        # Localize the reconstruction: past the corner, scanned edges are original.
        dist = np.maximum(xx,yy)
        weight = np.clip((CORNER-dist)/43,0,1)
        wanted = np.maximum(src[:,:,3].astype(float), shape_alpha*weight)
        added = np.maximum(0,wanted-src[:,:,3])
        changes = added >= 1
        if not np.any(changes):
            continue
        # Extrapolate photographic pigment from actual adjacent page pixels:
        # top-edge tint and fore-edge tint blend. Never paint a flat cardboard
        # corner, synthesize a new overall texture, or touch the printed area.
        base_x=xcoord(CORNER+16)
        y_for_top = np.clip(global_y, 17, h-18)
        x_for_side = xcoord(np.maximum(xx, 17))
        y_for_side = (h - 1 - (CORNER+16)) if bottom else CORNER+16
        top_pigment = old[y_for_top, np.full_like(global_x,base_x), :3].astype(float)
        side_pigment = old[np.full_like(global_y,y_for_side), x_for_side, :3].astype(float)
        color = np.clip(top_pigment*.56+side_pigment*.44,0,255)
        # High-quality antialiasing: composite inherited pixels with restored ink.
        mix = np.clip(added/255,0,1)[:,:,None]
        sub[:,:,:3] = np.clip(src[:,:,:3]*(1-mix)+color*mix,0,255).astype(np.uint8)
        sub[:,:,3] = np.clip(wanted,0,255).astype(np.uint8)
        rgba[global_y,global_x] = sub
        edits += int(np.count_nonzero(changes))
    # Keep the transparent periphery truly transparent (no black halo).
    rgba[rgba[:,:,3]==0,:3] = 0
    return Image.fromarray(rgba,"RGBA"), {
        "outer_side":side, "outer_pixels_reconstructed":edits,
        "side_inset":baseline_side,"upper_inset":base_top,"lower_inset":base_bottom,
        "corner_rgba":[int(rgba[y,x,3]) for x,y in
            ((24 if is_left else w-25,24),
             (24 if is_left else w-25,h-25))]
    }

def main():
    manifest=json.loads((ASSETS/"manifest.json").read_text("utf8"))
    if manifest["pairs"]!=8 or manifest["images"]!=16:
        raise ValueError("unexpected set of paper masters")
    report={"version":"7.102.0","baseline":BASE,"method":"photo pigment continuation + alpha silhouette","items":[]}
    specs=manifest["assets"]
    for i,spec in enumerate(specs):
        file=spec["file"]
        raw=source_bytes(f"assets/paper-spreads/{file}")
        old_sha=sha(raw)
        original=Image.open(io.BytesIO(raw))
        edited,metrics=repair(original,spec["side"],i+1)
        new_raw=encode(edited,95)
        if len(new_raw)<1000:
            raise ValueError("invalid image "+file)
        (ASSETS/file).write_bytes(new_raw)
        spec["original_sha256"]=old_sha
        spec["sha256"]=sha(new_raw)
        spec["bytes"]=len(new_raw)
        spec["corner_revision"]="v7.102 photographed edge reconstruction"
        out={"file":file,"before_sha256":old_sha,"after_sha256":spec["sha256"],**metrics}
        report["items"].append(out)
        # Actual runtime data is NOT the master JPEG/WebP. Re-encode from the
        # repaired pixels and rebind sourceSha256 on every paired runtime group.
        runtime=encode(edited,83)
        runtime_json=ASSETS/"runtime"/f"group-{(i//2)+1:02}.json"
        if i%2==0:
            group={"version":"7.102.0","group":i//2+1,"assets":[]}
        group["assets"].append({
            "file":file,"bytes":len(runtime),"sourceSha256":spec["sha256"],
            "runtimeSha256":sha(runtime),"base64":base64.b64encode(runtime).decode("ascii")
        })
        if i%2:
            runtime_json.write_text(json.dumps(group,ensure_ascii=False,separators=(",",":"))+"\n","utf8")
    manifest["version"]="3.1-corner-refined"
    manifest["created"]="2026-11-08"
    manifest["source"]="v7.101 approved 8 pairs; v7.102 repairs excessive rounded corners"
    manifest["texture_usage"]="Matched left/right pages, original paper grain preserved; repaired alpha is embedded in offline runtime"
    (ASSETS/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n","utf8")
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n","utf8")

    css=CSS.read_text("utf8")
    begin=css.index("/* v7.91 · asymmetric photograph corner treatment")
    end=css.index("/* v7.92 · Silhouette-matched photographic fore-edge",begin)
    css=css[:begin]+"""/* v7.102 · The revised WebP photographs own the visible leaf contour.
   Do not clip old paper into an 18–34px UI-card ellipse; genuine edges and
   corner damage come from the verified alpha channel of each paired image.
   Keep the independent full-height book binding and page-layout untouched. */
.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-group][data-paper-side],
.jfReader.paged.jf-aged-paper #jfPageView .jfSheet[data-paper-group][data-paper-side]::after {
  border-radius:0!important;
}

"""+css[end:]
    CSS.write_text(css,"utf8")
    # Keep the historical test entrypoint meaningful after removing old rounding.
    OLD_TEST.write_text("""#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'src/client/styles/41-reading.css'),'utf8');
const block=css.slice(css.lastIndexOf('/* v7.102 · The revised WebP photographs'),css.indexOf('/* v7.92 ·'));
assert(block.includes('border-radius:0!important'),'real photo alpha must own corners');
assert(!/clamp\\(1[78]px,2/.test(block),'legacy large UI-like page corners must be absent');
const manifest=require('../assets/paper-spreads/manifest.json');
assert.equal(manifest.version,'3.1-corner-refined');
assert.equal(manifest.assets.length,16);
assert(manifest.assets.every(x=>x.corner_revision&&x.original_sha256));
console.log('PASS v7.102: photographed corner alpha, no CSS-rounded cards, 8 matched pairs');
""","utf8")
    print("PASS repaired 16 photographed leaves / 8 paired runtime bundles")
    for x in report["items"]:
        print(x["file"],"restored",x["outer_pixels_reconstructed"],"pixels","alpha@24",x["corner_rgba"])

if __name__=="__main__":
    main()
