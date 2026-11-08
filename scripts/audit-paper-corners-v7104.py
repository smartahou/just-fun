#!/usr/bin/env python3
"""Visual audit of old-book corner sources — no production files mutated."""
import base64, io, json, hashlib, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
BASES={
 "v7.101 original":"ec22e318b383750d2483c95ff3bff2ca3d592b4b",
 "v7.102 restored":"aa91dbde45a47275b9009faa3aa23c7519d31305",
 "v7.103 cut":"05f0634beaaa03c75d8a12400b112ae4f55eac9c",
}
def get(ref,filename):
 raw=subprocess.check_output(["git","show",f"{ref}:assets/paper-spreads/{filename}"],cwd=ROOT)
 return Image.open(io.BytesIO(raw)).convert("RGBA")
def contact():
 groups=(1,4,7)
 w,h=470,365
 sheet=Image.new("RGB",(w*len(groups),h*len(BASES)),(224,221,214))
 d=ImageDraw.Draw(sheet)
 for row,(title,ref) in enumerate(BASES.items()):
  for col,g in enumerate(groups):
   ox,oy=col*w,row*h
   d.rectangle((ox+7,oy+28,ox+w-7,oy+h-6),fill="#44372a")
   for k,side in enumerate(("left","right")):
    im=get(ref,f"spread-{g:02}-{side}.webp")
    # Approximate the physical dark backboard under transparent photographic alpha.
    im.thumbnail((225,320),Image.Resampling.LANCZOS)
    board=Image.new("RGBA",im.size,(61,52,41,255))
    board.alpha_composite(im)
    sheet.paste(board.convert("RGB"),(ox+10+k*225,oy+30))
   d.text((ox+12,oy+8),f"{title}  pair {g:02}",fill="#262019")
 out=io.BytesIO()
 sheet.save(out,format="JPEG",quality=72,optimize=True)
 encoded=base64.b64encode(out.getvalue()).decode("ascii")
 print("AUDIT_CONTACT_BEGIN")
 for i in range(0,len(encoded),3000):
  print("AUDIT_DATA:"+encoded[i:i+3000])
 print("AUDIT_CONTACT_END")
def metrics():
 for title,ref in BASES.items():
  for g in (1,4,7):
   for side in ("left","right"):
    img=get(ref,f"spread-{g:02}-{side}.webp")
    x=0 if side=="left" else 959
    corners=[]
    for y in (0,1439):
     n=0
     for dx in range(120):
      xx=dx if side=="left" else 959-dx
      if img.getpixel((xx,y))[3]<32:n+=1
      else:break
     corners.append(n)
    print("AUDIT_ALPHA",title,g,side,corners,"corner",img.getpixel((x,0))[3],img.getpixel((x,1439))[3])
if __name__=="__main__":
 metrics()
 contact()
