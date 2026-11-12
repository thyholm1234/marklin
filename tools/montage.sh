#!/bin/bash
# montage.sh prefix -> prefix_all.png (2 kolonner)
p=$1; W=$(rsvg-convert $p"0.svg" -f svg | grep -o 'width="[0-9.]*' | head -1 | grep -o '[0-9.]*$'); 
python3 - "$p" <<'PY'
import sys,re,glob,os
p=sys.argv[1]
files=sorted(glob.glob(p+'[0-9].svg'))
parts=[];x=y=0;maxh=0;cols=2;W=H=0
for i,f in enumerate(files):
    s=open(f).read()
    m=re.search(r'viewBox="0 0 (\d+) (\d+)"',s);w,h=int(m.group(1)),int(m.group(2))
    inner=s[s.index('>')+1:s.rindex('</svg>')]
    cx=(i%cols)*(w+40);cy=(i//cols)*(h+40)
    parts.append(f'<g transform="translate({cx},{cy})">{inner}</g>')
    W=max(W,cx+w);H=max(H,cy+h)
sc=min(1,1800/W)
open(p+'all.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W*sc:.0f}" height="{H*sc:.0f}">'+''.join(parts)+'</svg>')
PY
rsvg-convert ${p}all.svg -o ${p}all.png
