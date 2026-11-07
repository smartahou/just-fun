#!/usr/bin/env python3
"""Pixel-level RGBA regression: no top/bottom white opacity fog."""
import base64
import io
import json
from pathlib import Path
import numpy as np
from PIL import Image

pack=json.loads((Path(__file__).resolve().parents[1]/'assets/paper-stacks/embedded-v794.json').read_text())
assert pack['version']=='7.94.0'
assert pack['canvas']=={'width':64,'height':1440}
assert len(pack['progress_states'])==11
for stage,row in enumerate(pack['progress_states']):
    assert row['percent']==stage*10
    for side in ('left','right'):
        raw=base64.b64decode(row[side+'_base64'],validate=True)
        a=np.asarray(Image.open(io.BytesIO(raw)).convert('RGBA'))[:,:,3]
        assert a.shape==(1440,64)
        name=row[side]
        empty=(stage==0 and side=='left') or (stage==10 and side=='right')
        if empty:
            assert a.max()==0,(name,'endpoint not transparent')
            continue
        assert a[:10].max()==0 and a[-10:].max()==0,(name,'tip exposed')
        assert a[110:1330].max()==255,(name,'paper not opaque')
        cover=[int((a[y]>180).sum()) for y in (20,40,60,80,110)]
        assert cover[0]<cover[1]<cover[2]<cover[3]<=cover[4],(name,cover)
        cap=a[18:102]
        visible=(cap>10)
        fog=((cap>10)&(cap<220))
        assert fog.sum()/max(1,visible.sum())<0.16,(name,'translucent fog')
        body=a[160:1270]
        assert (body>245).sum()>(body>10).sum()*0.70,(name,'paper body foggy')
print('PASS v7.94: crisp solid-alpha corners for 20 states, 2 invisible endpoints')
