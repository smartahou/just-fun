#!/usr/bin/env python3
"""One-time authoring: photograph-based near-square hardcover WebPs; not runtime graphics."""
import base64,hashlib,io,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
R=Path(__file__).resolve().parents[1]; src=json.loads((R/'assets/paper-covers/embedded-v799.json').read_text('utf8'))
out=R/'assets/paper-covers/embedded-v7101.json';folder=R/'assets/paper-covers/v7101';folder.mkdir(parents=True,exist_ok=True)
colors=[(109,70,47),(61,62,43),(137,79,43),(105,46,55),(128,109,86),(54,45,41),(79,51,39),(52,70,78),(111,77,52),(70,48,65),(87,98,81),(61,44,40)]
names=['walnut leather','olive buckram','russet calf','oxblood cloth','weathered linen','charcoal leather','smoked walnut','sea slate buckram','aged saddle tan','aubergine cloth','sage-grey linen','black chestnut']
pack={'version':'7.101.0','type':'photographed-hollow-hardcover-rim','purpose':'real reconstructed photo rims, not CSS border','render_strategy':'photo-only-alpha','canvas':{'width':960,'height':600},'singleCanvas':{'width':480,'height':960},'covers':[],'single_covers':[]}
for n,(rgb,name) in enumerate(zip(colors,names),1):
 for kind,dims in [('covers',(960,600)),('single_covers',(480,960))]:
  original=base64.b64decode(src[kind][(n-1)%6]['base64'])
  im=Image.open(io.BytesIO(original)).convert('RGBA');a=np.array(im)
  H,W=a.shape[:2];y,x=np.mgrid[:H,:W]
  tinted=a.astype(np.float32)
  # Preserve authentic photographic relief and faded cover pigments.
  luma=np.sum(tinted[:,:,:3]*[.299,.587,.114],axis=2,keepdims=True)
  dyed=np.array(rgb,np.float32)[None,None,:]*.53+tinted[:,:,:3]*.47+(tinted[:,:,:3]-luma)*.28
  grain=np.sin((x+n*17)/19.)*np.cos((y+n*11)/23.)*1.3
  tinted[:,:,:3]=np.clip(dyed*.93+grain[:,:,None],0,255)
  # Change actual RGBA photo silhouette, not CSS corner/border geometry.
  thick=18 if W>700 else 15
  for right in (False,True):
   for bottom in (False,True):
    cx=(W-1-x) if right else x;cy=(H-1-y) if bottom else y
    corner=(cx<30)&(cy<30)&((cx<thick)|(cy<thick))
    refx=W-45 if right else 44;refy=H-45 if bottom else 44
    top=a[y,refx,:3].astype(np.float32);side=a[refy,x,:3].astype(np.float32)
    take=np.where((cx<cy)[:,:,None],side,top)
    missing=corner&(tinted[:,:,3]<200)
    tinted[missing,:3]=take[missing,:3]*.47+np.array(rgb)*.53
    tinted[missing,3]=255
  rounded=Image.new('L',(W,H),0)
  ImageDraw.Draw(rounded).rounded_rectangle((1,1,W-2,H-2),radius=5,fill=255)
  mask=np.array(rounded.filter(ImageFilter.GaussianBlur(.55)),np.float32)/255.
  tinted[:,:,3]*=mask
  pix=np.clip(tinted,0,255).astype(np.uint8);pix[pix[:,:,3]==0,:3]=0
  buf=io.BytesIO();Image.fromarray(pix,'RGBA').save(buf,'WEBP',quality=87,method=1)
  raw=buf.getvalue()
  filename=f'cover-{n:02}'+('-single' if kind=='single_covers' else '')+'.webp'
  (folder/filename).write_bytes(raw)
  check=Image.open(io.BytesIO(raw)).convert('RGBA')
  assert check.size==dims and check.getpixel((W//4,H//2))[3]==0 and check.getpixel((0,0))[3]==0
  pack[kind].append({'filename':filename,'name':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode('ascii')})
out.write_text(json.dumps(pack,ensure_ascii=False,separators=(',',':')),'utf8')
print('PASS 24 physical photo assets',out.stat().st_size)
