#!/usr/bin/env python3
"""Produce the two *uploaded* Source Han Serif CN 1.000 fonts for offline Just Fun.

The user-provided 2017 Regular and SemiBold OTFs are byte-identical to
adobe-fonts/source-han-serif tag 1.000R (verified Git blob SHAs in 2026-11).
Download only those pinned upstream binaries when building the project;
NEVER download fonts in the user-facing reader.

The 2017 OTF glyph library is large: subset to all GBK-representable code
points plus reading punctuation (about 22,000 covered codepoints). Characters
outside the subset fall back to the previous serif stack. The subset is an
OFL-modified derivative: its internal reserved Source family name is renamed.
"""
import hashlib
import io
import json
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"assets/fonts/book-serif"
TAG="1.000R"
SOURCE_BASE="https://raw.githubusercontent.com/adobe-fonts/source-han-serif/"+TAG
ORIGINALS={
    "Regular": ("1ddaf8183212f81e5b9a5b8c87a24aab8b7d2ff8f05eb3f6eaab341a7a285e58",
                "91b48b7fc680b2c887e8d1f6527719e60b0fd098"),
    "SemiBold": ("c058c0bd712ff3d9e9176a22650de8d0dcdb15396235cb6e3e373e6dc455d7bc",
                 "efa94cb5ecca0290da770c6d691717f74bc17fad")
}
FAMILY="JustFun Book Serif CN"
EXTRA_TEXT="蕃蜀璧滟曛芟溽蜚谶觞轺篆幢龃龉芷徂宥祚槎欤诘璇峤舸霁槟苒骈畛翮榇妁旰漓莽攒椟翰黔黜嫡"
LICENSE_GIT_SHA="d952d62c065f3f35fb83a173496e90b21525aef3"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git_sha(data):
    return hashlib.sha1(("blob %d\0"%len(data)).encode()+data).hexdigest()

def download(relative):
    url=SOURCE_BASE+"/"+relative
    with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"JustFun-font-build/7.110"}),timeout=180) as response:
        return response.read()

def coverage():
    chars=set(range(0x20,0x300)) # western, combining, punctuation
    chars.update(range(0x2000,0x2100))
    chars.update(range(0x2100,0x2200))
    chars.update(range(0x3000,0x3040))
    chars.update(range(0xff00,0xfff0))
    for lead in range(0x81,0xff):
        for trail in range(0x40,0xff):
            if trail==0x7f:continue
            try:
                chars.update(map(ord,bytes((lead,trail)).decode("gbk")))
            except UnicodeDecodeError:
                pass
    chars.update(map(ord,EXTRA_TEXT))
    return chars

def rename(font,weight):
    names=font["name"]
    # This is a modified (subset) OFL font, so do not use Adobe's Reserved
    # Font Name "Source" in the derivative's family/PostScript name.
    editable={1,2,3,4,6,16,17,25}
    names.names=[n for n in names.names if n.nameID not in editable]
    style="Regular" if weight=="Regular" else "SemiBold"
    ps=("JustFunBookSerifCN-"+style)
    fields={1:FAMILY,2:style,3:"JustFun Book Serif CN 1.000; "+style,
            4:FAMILY+" "+style,6:ps,16:FAMILY,17:style}
    for namelabel,value in fields.items():
        names.setName(value,namelabel,3,1,0x0409)

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    license_bytes=download("LICENSE.txt")
    if git_sha(license_bytes)!=LICENSE_GIT_SHA:raise RuntimeError("Unexpected OFL license source")
    (OUT/"OFL-1.1.txt").write_bytes(license_bytes)
    codepoints=coverage()
    results=[]
    for weight,size in (("Regular",400),("SemiBold",600)):
        original_relative="SubsetOTF/CN/SourceHanSerifCN-"+weight+".otf"
        raw=download(original_relative)
        expected256,expectedGit=ORIGINALS[weight]
        if sha(raw)!=expected256 or git_sha(raw)!=expectedGit:
            raise RuntimeError("Official font version does not match the user-uploaded "+weight)
        font=TTFont(io.BytesIO(raw),recalcTimestamp=False)
        available=set(font.getBestCmap())
        glyphs=codepoints.intersection(available)
        options=subset.Options()
        options.layout_features=[]
        options.layout_closure=False
        options.hinting=False
        options.name_IDs=["*"]
        options.name_languages=["*"]
        options.notdef_glyph=True
        options.recalc_timestamp=False
        sb=subset.Subsetter(options=options)
        sb.populate(unicodes=glyphs)
        sb.subset(font)
        rename(font,weight)
        font.flavor="woff2"
        name="justfun-book-serif-cn-"+str(size)+".woff2"
        dest=OUT/name
        font.save(str(dest))
        result=dest.read_bytes()
        if result[:4]!=b"wOF2" or len(result)<100000:
            raise RuntimeError("Invalid WOFF2 output "+name)
        verify=TTFont(io.BytesIO(result),lazy=True)
        assert verify.flavor=="woff2"
        cmap=set(verify.getBestCmap())
        assert glyphs.issubset(cmap)
        for codepoint in map(ord,"旧书道光唐诗三百首1842。，《》"):
            assert codepoint in cmap,hex(codepoint)
        results.append({
            "weight":size,"filename":name,"bytes":len(result),
            "sha256":sha(result),"glyphs":len(cmap),
            "original_otf_path":original_relative,
            "original_sha256":expected256,"original_git_sha":expectedGit
        })
        print("Built",name,len(result),"bytes",len(cmap),"codepoints",flush=True)
    manifest={
        "version":"7.110.0","family":FAMILY,"source_tag":TAG,
        "source_commit":"f6cf97d92b22e7bd77e355a61fe549ae44b6de76",
        "source_repository":"https://github.com/adobe-fonts/source-han-serif",
        "license":"SIL OFL 1.1","license_file":"OFL-1.1.txt",
        "originals_match_user_upload":True,
        "subset_policy":"GBK repertoires + typographic punctuation; no added content or visual transformations",
        "fallback_for_missing_codepoints":True,
        "files":results
    }
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("PASS 7.110 exact uploaded 1.000R source, 2 offline subsets + OFL",flush=True)

if __name__=="__main__":main()
