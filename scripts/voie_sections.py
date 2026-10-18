# ecart lateral SIGNE median (fixes acc <= 8 m) au ruban dense, PAR SECTION ENTRE ZONES D AIGUILLAGES, pour un ou plusieurs journaux.
# >0 = a gauche du sens Sud -> Nord. En Espagne : voie 1 ~ 0 a +1,5 m, voie 2 ~ +4 a +6 m (constate 11/10 et 18/10).
import json,re,math,sys,statistics as st,collections
rib=[]
for m in re.finditer(r'\{\s*s_km:\s*([\d.]+),\s*lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)\s*\}', open("S:/Dev/LIM2/src/lib/ligne050_ribbon_dense.ts",encoding="utf-8").read()):
    rib.append((float(m.group(1)),float(m.group(2)),float(m.group(3))))
def xy(lat,lon,lat0): return ((lon)*111320*math.cos(math.radians(lat0)), lat*110540)
def fixes(path):
    out=[]
    for ln in open(path,encoding="utf-8"):
        if '"gps:position"' not in ln: continue
        p=json.loads(ln)["payload"]
        if (p.get("accuracy") or 99)>8 or p.get("nearestIdx") is None or not p.get("onLine") or p.get("pk") is None: continue
        i=p["nearestIdx"]
        if i<1 or i>=len(rib)-1: continue
        s,lat,lon=rib[i]; _,la0,lo0=rib[i-1]; _,la1,lo1=rib[i+1]
        ax,ay=xy(la0,lo0,lat); bx,by=xy(la1,lo1,lat); fx,fy=xy(p["lat"],p["lon"],lat); px,py=xy(lat,lon,lat)
        dx,dy=bx-ax,by-ay; n=math.hypot(dx,dy)
        if n==0: continue
        out.append((s,p["pk"],(dx*(fy-py)-dy*(fx-px))/n))
    return out
# sections par pk reseau (sens NS) ; (label, pkmin, pkmax, reseau)
SEC=[("Perpignan gare -> Limite Rac (RFN 467,7-468,1)",468.1,467.66,"RFN"),
     ("Limite Rac -> Limite LGV (RFN 468,1-470,4)",470.4,468.1,"RFN"),
     ("Limite LGV -> saut de mouton (LFP 0-12,9)",12.92,0.0,"LFP"),
     ("Saut de mouton -> Tresserres nord (LFP 12,9-14,6)",14.608,12.92,"LFP"),
     ("Tresserres -> tunnel Perthus (LFP 16,3-17,2)",17.2,16.297,"LFP"),
     ("Sortie Perthus -> Jonquera nord (LFP 25,6-28,9)",28.911,25.589,"LFP"),
     ("Jonquera sud -> limite ADIF (LFP 29,7-44,4)",44.4,29.735,"LFP"),
     ("Limite ADIF -> Figueres (752,4-749,6)",752.4,749.6,"ADIF"),
     ("Figueres -> Pontos (749,6-738,1)",749.6,738.1,"ADIF"),
     ("Pontos -> Girona (738,1-714,7)",738.1,714.7,"ADIF"),
     ("Girona -> Vilobi (714,7-703,5)",714.7,703.5,"ADIF"),
     ("Vilobi -> Riells (703,5-678,1)",703.5,678.1,"ADIF"),
     ("Riells -> Llinars (678,1-662,5)",678.1,662.5,"ADIF"),
     ("Llinars -> Mollet ag. 644 (662,5-644,3)",662.5,644.3,"ADIF"),
     ("Mollet ag. 644 -> Sagrera (644,3-627,7)",644.3,627.7,"ADIF")]
def net(pk): return "ADIF" if pk>=600 else ("RFN" if pk>=200 else "LFP")
usage="python -I -X utf8 scripts/voie_sections.py nom=<journal.log> [nom2=<journal2.log> ...]"
if len(sys.argv)<2: sys.exit(usage)
logs=[(a.split("=")[0],a.split("=")[1]) for a in sys.argv[1:]]
data={name:fixes(path) for name,path in logs}
print(f"{'section':50s}"+"".join(f"{n:>22s}" for n,_ in logs))
for lab,hi,lo,rs in SEC:
    line=f"{lab:50s}"
    for name,_ in logs:
        v=[c for s,pk,c in data[name] if net(pk)==rs and lo<=pk<=hi]
        line+=f"{st.median(v):+6.1f} m (n={len(v):3d})" .rjust(22) if len(v)>=5 else f"- (n={len(v)})".rjust(22)
    print(line)
