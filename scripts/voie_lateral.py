# ecart lateral SIGNE des fixes (acc <= 8 m) au ruban dense, mediane par km de s
import json,re,math,sys,statistics as st,datetime,collections
rib=[]
for m in re.finditer(r'\{\s*s_km:\s*([\d.]+),\s*lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)\s*\}', open("S:/Dev/LIM2/src/lib/ligne050_ribbon_dense.ts",encoding="utf-8").read()):
    rib.append((float(m.group(1)),float(m.group(2)),float(m.group(3))))
def xy(lat,lon,lat0): return ((lon)*111320*math.cos(math.radians(lat0)), lat*110540)
rows=collections.defaultdict(list)
for ln in open(sys.argv[1],encoding="utf-8"):
    if '"gps:position"' not in ln: continue
    e=json.loads(ln); p=e["payload"]
    if (p.get("accuracy") or 99)>8 or p.get("nearestIdx") is None or not p.get("onLine"): continue
    i=p["nearestIdx"]
    if i<1 or i>=len(rib)-1: continue
    s,lat,lon=rib[i]; _,la0,lo0=rib[i-1]; _,la1,lo1=rib[i+1]
    ax,ay=xy(la0,lo0,lat); bx,by=xy(la1,lo1,lat); fx,fy=xy(p["lat"],p["lon"],lat); px,py=xy(lat,lon,lat)
    dx,dy=bx-ax,by-ay; n=math.hypot(dx,dy)
    if n==0: continue
    cross=(dx*(fy-py)-dy*(fx-px))/n   # >0 = a gauche du sens s croissant
    t=datetime.datetime.fromisoformat(e["t"].replace("Z","+00:00"))+datetime.timedelta(hours=2)
    rows[int(s)].append((cross,t.strftime("%H:%M")))
print("s_km  n   mediane  (premier fix)")
for k in sorted(rows):
    v=[c for c,_ in rows[k]]
    print(f"{k:4d} {len(v):3d} {st.median(v):+6.1f}   {rows[k][0][1]}")
