#!/usr/bin/env python3
"""Pixel-level RGBA regression: no top/bottom opacity fog. Requires Pillow."""
import base64, io, json
from pathlib import Path
from PIL import Image
pack=json.loads((Path(__file__).resolve().parents[1]/'assets/paper-stacks/embedded-v794.json').read_text())
assert pack['version']=='7.94.0'
assert pack['canvas']=={'width':64,'height':1440}
assert len(pack['progress_states'])==11
def count_gt(image, y, limit):
    return sum(v>limit for v in image.crop((0,y,64,y+1)).getdata())
for stage,row in enumerate(pack['progress_states']):
    assert row['percent']==stage*10
    for side in ('left','right'):
        raw=base64.b64decode(row[side+'_base64'],validate=True)
        im=Image.open(io.BytesIO(raw)).convert('RGBA')
        assert im.size==(64,1440)
        alpha=im.getchannel('A')
        name=row[side]
        empty=(stage==0 and side=='left') or (stage==10 and side=='right')
        if empty:
            assert alpha.getextrema()[1]==0,(name,'endpoint not transparent')
            continue
        assert alpha.crop((0,0,64,10)).getextrema()[1]==0,(name,'top tip exposed')
        assert alpha.crop((0,1430,64,1440)).getextrema()[1]==0,(name,'bottom tip exposed')
        assert alpha.crop((0,110,64,1330)).getextrema()[1]==255,(name,'paper body not opaque')
        cover=[count_gt(alpha,y,180) for y in (20,40,60,80,110)]
        assert cover[0]<cover[1]<cover[2]<cover[3]<=cover[4],(name,cover)
        cap=list(alpha.crop((0,18,64,102)).getdata())
        visible=sum(v>10 for v in cap)
        fog=sum(10<v<220 for v in cap)
        assert fog/max(1,visible)<0.16,(name,'translucent corner fog')
        body=list(alpha.crop((0,160,64,1270)).getdata())
        assert sum(v>245 for v in body)>sum(v>10 for v in body)*0.70,(name,'paper body foggy')
print('PASS v7.94: crisp physical photo corners for 20 states and 2 invisible endpoints')
