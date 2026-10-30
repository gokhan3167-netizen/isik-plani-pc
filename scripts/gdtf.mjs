// GDTF Share'deki GDTF dosyalarını (izinle) indirip programın içine gömer.
// Kullanım: GDTF_USER=... GDTF_PASS=... node scripts/gdtf.mjs   (Node.js 18+; ek paket gerekmez)
// Çıktı: www/vendor/gdtf-library.js (programa gömülü)  +  gdtf-kutuphane.json (diğer cihazlara yüklemek için)
// Okunan dosyaların özeti gdtf-cache/ klasöründe saklanır; sonraki derlemelerde yalnızca yeni/değişen revizyonlar indirilir.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import zlib from 'zlib';
import { createHash } from 'crypto';

const API = process.env.GDTF_API || 'https://gdtf-share.com/apis/public/';
const USER = process.env.GDTF_USER, PASS = process.env.GDTF_PASS;
const ONLY_MANUF = process.env.GDTF_ONLY_MANUF === '1';     // 1 ise yalnızca üreticinin yüklediği dosyalar
const outDir = existsSync('www') ? 'www/vendor' : 'vendor', CACHE = 'gdtf-cache';

// ---- kanal anlamları (programdakiyle aynı) ----
function gdtfAttrToken(a){ a=String(a||'');
  if(/^Dimmer$/i.test(a)) return 'D'; if(/^Pan$/i.test(a)) return 'P'; if(/^Tilt$/i.test(a)) return 'T';
  let m=a.match(/^ColorAdd_(\w+)/); if(m) return ({R:'R',G:'G',B:'B',W:'W',WW:'W',CW:'W',RY:'A',GY:'L',UV:'UV',C:'C',M:'M',Y:'Y'})[m[1]]||'x';
  m=a.match(/^ColorSub_(\w)/); if(m) return ({C:'C',M:'M',Y:'Y'})[m[1]]||'x';
  if(/^CT[OCB]/i.test(a)) return 'CTO'; if(/^Color\d/.test(a)) return 'CW'; if(/^Zoom/.test(a)) return 'Z'; if(/^Focus/.test(a)) return 'F'; if(/^(Shutter|Strobe)/.test(a)) return 'S';
  if(/^Frost/.test(a)) return 'FR'; if(/^Gobo\d+(Pos)?(Rotate|WheelSpin|WheelAudio)|^Gobo\d+PosRotate/.test(a)) return 'GR'; if(/^Gobo/.test(a)) return 'GB'; if(/^Iris/.test(a)) return 'I'; if(/^Prism/.test(a)) return 'PR';
  if(/^Effects/.test(a)) return 'FX'; if(/^(Haze|Fog)/.test(a)) return 'H'; if(/^Fan/.test(a)) return 'FN'; if(/Speed|Time/.test(a)) return 'SP'; if(/^(Control|Reset|Lamp|Function|Fixture)/.test(a)) return 'CT';
  return 'x'; }
function guessType(s){ s=s.toLowerCase();
  if(/strobe|atomic|jdc/.test(s)) return 'strobe'; if(/haz|fog|smoke/.test(s)) return 'hazer'; if(/blinder|molefay/.test(s)) return 'blinder'; if(/\bbar\b|batten|strip/.test(s)) return 'bar';
  if(/beam|sharpy/.test(s)) return 'beam'; if(/wash|aura|spiider/.test(s)) return 'wash'; if(/fresnel/.test(s)) return 'fresnel'; if(/\bpc\b/.test(s)) return 'pc';
  if(/profile|ellipsoidal|source four|leko/.test(s)) return 'profile'; if(/\bpar\b/.test(s)) return 'par'; if(/spot|moving|head/.test(s)) return 'spot'; return 'par'; }
// ---- küçük ZIP ve XML okuyucular ----
function readZip(buf){ let e=buf.length-22; while(e>=0&&buf.readUInt32LE(e)!==0x06054b50) e--; if(e<0) throw new Error('zip');
  const count=buf.readUInt16LE(e+10); let p=buf.readUInt32LE(e+16); const files=new Map();
  for(let i=0;i<count;i++){ if(buf.readUInt32LE(p)!==0x02014b50) break; const method=buf.readUInt16LE(p+10), csize=buf.readUInt32LE(p+20), nlen=buf.readUInt16LE(p+28), xlen=buf.readUInt16LE(p+30), clen=buf.readUInt16LE(p+32), off=buf.readUInt32LE(p+42);
    files.set(buf.toString('utf8',p+46,p+46+nlen),{method,csize,off}); p+=46+nlen+xlen+clen; }
  const read=n=>{ const f=files.get(n); if(!f) return null; const ln=buf.readUInt16LE(f.off+26), lx=buf.readUInt16LE(f.off+28), d=buf.subarray(f.off+30+ln+lx,f.off+30+ln+lx+f.csize); return f.method===8?zlib.inflateRawSync(d):Buffer.from(d); };
  return {files,read}; }
const dec=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function parseXML(s){ const root={tag:'#',a:{},c:[]}, st=[root], re=/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g; let m;
  while((m=re.exec(s))){ if(!m[2]) continue; const [,cl,tag,at,self]=m; if(cl){ while(st.length>1&&st.pop().tag!==tag); continue; }
    const a={}; at.replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,(_,k,v1,v2)=>{ a[k]=dec(v1!=null?v1:v2); return ''; });
    const n={tag,a,c:[]}; st[st.length-1].c.push(n); if(!self) st.push(n); }
  return root; }
const all=(n,t,o=[])=>{ for(const c of n.c){ if(c.tag===t) o.push(c); all(c,t,o); } return o; };
// CIE xyY → sRGB hex
function cie(s){ const [x,y,Y]=String(s||'').split(',').map(Number); if(!(y>0)) return null; const X=x*(Y||100)/y, Z=(1-x-y)*(Y||100)/y, YY=Y||100;
  let r=3.2406*X-1.5372*YY-.4986*Z, g=-.9689*X+1.8758*YY+.0415*Z, b=.0557*X-.204*YY+1.057*Z; const mx=Math.max(r,g,b); if(!(mx>0)) return null; [r,g,b]=[r,g,b].map(v=>Math.max(0,v/mx));
  const gm=v=>v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055; return [r,g,b].map(v=>Math.round(gm(v)*255).toString(16).padStart(2,'0')).join(''); }
const dmxv=(s,bytes)=>{ const m=String(s||'0/1').match(/^(\d+)(?:\/(\d+))?/); if(!m) return 0; let v=+m[1], b=+(m[2]||1); while(b<bytes){ v*=256; b++; } while(b>bytes){ v=Math.floor(v/256); b--; } return v; };
function parseGDTF(buf){
  const z=readZip(buf), x=z.read('description.xml'); if(!x) return null; const doc=parseXML(x.toString('utf8')), ft=all(doc,'FixtureType')[0]; if(!ft) return null;
  const model=ft.a.LongName||ft.a.Name, brand=ft.a.Manufacturer||''; if(!model) return null;
  const wheels={}, wslots={}; all(ft,'Wheel').forEach(w=>{ const sl=w.c.filter(c=>c.tag==='Slot'); wheels[w.a.Name]=sl.map(s=>s.a.Color?cie(s.a.Color):'ffffff'); wslots[w.a.Name]=sl; });
  let pr=null, tr=null;
  const modes=all(ft,'DMXMode').map(md=>{ let mx=0; const tk={}; let cw=null, gb=null, stb=null;
    for(const ch of all(md,'DMXChannel')){ const off=ch.a.Offset; if(!off||off==='None') continue; const lc=all(ch,'LogicalChannel')[0], at=lc?lc.a.Attribute:'', base=gdtfAttrToken(at), offs=off.split(',').map(Number);
      offs.forEach((n,i)=>{ if(n>0){ if(n>mx) mx=n; tk[n]=i===0?base:(base==='x'?'x':base+(i+1)); } });
      const cf=lc?all(lc,'ChannelFunction'):[];
      if(base==='P'&&pr==null&&cf[0]){ const a=+cf[0].a.PhysicalFrom, b=+cf[0].a.PhysicalTo; if(isFinite(a)&&isFinite(b)&&Math.abs(b-a)>=90) pr=Math.abs(b-a); }
      if(base==='T'&&tr==null&&cf[0]){ const a=+cf[0].a.PhysicalFrom, b=+cf[0].a.PhysicalTo; if(isFinite(a)&&isFinite(b)&&Math.abs(b-a)>=45) tr=Math.abs(b-a); }
      if(base==='CW'&&!cw){ const bytes=offs.filter(n=>n>0).length, tab=[], fns=cf.filter(f=>f.a.Wheel&&wheels[f.a.Wheel]);
        for(const f of fns){ const sl=wheels[f.a.Wheel], sets=f.c.filter(c=>c.tag==='ChannelSet');
          sets.forEach((s,i)=>{ const k=+s.a.WheelSlotIndex; if(!(k>=1)||!sl[k-1]) return; const a=dmxv(s.a.DMXFrom,bytes), nx=sets[i+1]?dmxv(sets[i+1].a.DMXFrom,bytes)-1:a+Math.pow(256,bytes)/64; tab.push([a,Math.max(a,nx),sl[k-1]]); }); if(tab.length) break; }
        if(tab.length) cw=tab; }
      if(base==='GB'&&!gb){ const bytes=offs.filter(n=>n>0).length, tab=[];
        for(const f of cf.filter(f=>f.a.Wheel&&wslots[f.a.Wheel])){ const sl=wslots[f.a.Wheel], sets=f.c.filter(c=>c.tag==='ChannelSet');
          sets.forEach((st,i)=>{ const k=+st.a.WheelSlotIndex; if(!(k>=1)||!sl[k-1]) return; const a=dmxv(st.a.DMXFrom,bytes), nx=sets[i+1]?dmxv(sets[i+1].a.DMXFrom,bytes)-1:a+Math.pow(256,bytes)/64; const open=/open/i.test(sl[k-1].a.Name||'')||!sl[k-1].a.MediaFileName; tab.push([a,Math.max(a,nx),open?0:k]); }); if(tab.length) break; }
        if(tab.length) gb=tab; }
      if(base==='S'&&!stb){ const bytes=offs.filter(n=>n>0).length; cf.forEach((f,i)=>{ if(stb||!/Strobe|Pulse/i.test(f.a.Attribute||f.a.Name||'')) return; const a=dmxv(f.a.DMXFrom,bytes), b=cf[i+1]?dmxv(cf[i+1].a.DMXFrom,bytes)-1:Math.pow(256,bytes)-1; stb=[a,b]; }); } }
    const r=[md.a.Name||'Mod',mx,[...Array(mx)].map((_,i)=>tk[i+1]||'x').join(',')]; const ex={}; if(cw) ex.cw=cw; if(gb) ex.gb=gb; if(stb) ex.st=stb; if(Object.keys(ex).length) r.push(ex); return r; }).filter(m=>m[1]>0);
  if(!modes.length) return null;
  const e={b:brand,m:model,t:guessType(model+' '+(ft.a.Description||'')),modes};
  if(pr) e.pr=pr; if(tr) e.tr=tr;
  const beam=all(ft,'Beam')[0]; if(beam&&+beam.a.BeamAngle>0) e.ba=+beam.a.BeamAngle;
  const models=all(ft,'Model'), g0=all(ft,'Geometries')[0], first=g0&&g0.c.find(c=>c.a.Model), mdl=(first&&models.find(m=>m.a.Name===first.a.Model))||models[0];
  if(mdl&&+mdl.a.Length>.04&&+mdl.a.Width>.04) e.sz=[+mdl.a.Length,+mdl.a.Width,+mdl.a.Height||0];
  return e;
}
// ---- Orijinal cihaz özellikleri (profil): GDTF ve OFL'den kanal fonksiyonları, tekerler, fiziksel değerler ----
// Profil: {v:1, ph:{ba,fa,lm,k,z:[min,max]}, w:[{n,k,s:[[ad,renk,resim,faset]]}], t:[[giriş…]], m:{mod:[[ofsetler,nitelik,grup,varsayılan,tablo,ad]]}}
// Giriş: [dmxBaş, dmxSon, etiket, tür, fiz1, fiz2, teker, yuva, modeMaster]
const FXP_GRP={D:'Yoğunluk',P:'Konum',C:'Renk',G:'Gobo',B:'Işın',F:'Fokus',X:'Kontrol'};
function fxpCie(s){ const [x,y,Y]=String(s||'').split(',').map(Number); if(!(y>0)) return null; const YY=Y||100, X=x*YY/y, Z=(1-x-y)*YY/y;
  let r=3.2406*X-1.5372*YY-.4986*Z, g=-.9689*X+1.8758*YY+.0415*Z, b=.0557*X-.204*YY+1.057*Z; const mx=Math.max(r,g,b); if(!(mx>0)) return null; [r,g,b]=[r,g,b].map(v=>Math.max(0,v/mx));
  const gm=v=>v<=.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-.055; return [r,g,b].map(v=>Math.round(gm(v)*255).toString(16).padStart(2,'0')).join(''); }
function fxpDmx(s,bytes){ const m=String(s==null?'0/1':s).match(/^(\d+)(?:\/(\d+))?/); if(!m) return 0; let v=+m[1], b=+(m[2]||1); while(b<bytes){ v=v*256; b++; } while(b>bytes){ v=Math.floor(v/256); b--; } return v; }
function fxpKind(A){ A=String(A||'');
  if(/^Dimmer$/.test(A)) return 'D'; if(/^Pan$/.test(A)) return 'P'; if(/^Tilt$/.test(A)) return 'T';
  let m=A.match(/^ColorAdd_(R|G|B|W|WW|CW|RY|GY|UV)$/); if(m) return ({R:'R',G:'G',B:'B',W:'W',WW:'W',CW:'W',RY:'A',GY:'L',UV:'UV'})[m[1]];
  m=A.match(/^ColorSub_(C|M|Y)$/); if(m) return m[1]; if(/^(CTO|CTC|CTB)$/.test(A)) return 'CT'; if(/^HSB_Hue/.test(A)) return 'HU'; if(/^HSB_Saturation/.test(A)) return 'SA';
  if(/^(Color|Gobo|Prism|AnimationWheel)\d+(WheelIndex)?$/.test(A)) return /^Prism/.test(A)?'PS':'S';
  if(/^(Color|Gobo|AnimationWheel)\d+(WheelShake|Shake|SelectShake)$/.test(A)) return 'SS';
  if(/^(Color|Gobo|AnimationWheel|Prism)\d+(SelectSpin)$/.test(A)) return 'SR';
  if(/^(Color|Gobo|AnimationWheel)\d+(WheelSpin|WheelRandom|WheelAudio)$/.test(A)) return 'WR';
  if(/^(Gobo|AnimationWheel)\d+Pos$/.test(A)) return 'GI'; if(/^(Gobo|AnimationWheel)\d+(PosRotate|PosShake|PosSwing)$/.test(A)) return 'GR';
  if(/^Prism\d+Pos$/.test(A)) return 'PI'; if(/^Prism\d+PosRotate$/.test(A)) return 'PRR';
  if(/^Zoom$/.test(A)) return 'Z'; if(/^Focus\d*$/.test(A)) return 'F'; if(/^Iris$/.test(A)) return 'I'; if(/^Frost\d*$/.test(A)) return 'FR';
  if(/^Shutter\d+$/.test(A)) return 'SH'; if(/^Shutter\d+Strobe|^StrobeFrequency|^StrobeRate/.test(A)) return 'ST';
  if(/^NoFeature$/.test(A)) return 'N'; if(/Macro/.test(A)) return 'FX';
  if(/Speed|Time$|Rate$/.test(A)) return 'SP'; if(/^(Effects|Iris.|Frost.|Animation|Media|Video)/.test(A)) return 'FX';
  if(/Control|Reset|Lamp|Fixture|Display|Fan|Function|DMXInput|Curve|Mode|Blackout|Calibration|Maintenance|Power/.test(A)) return 'CTL';
  return 'N'; }
function fxpGroup(A){ A=String(A||'');
  if(/^(Dimmer|Shutter|Strobe|Intensity)/.test(A)) return 'D'; if(/^(Pan|Tilt|Position|XYZ|Rot_)/.test(A)) return 'P';
  if(/^(Color|CTO|CTC|CTB|HSB|CIE|Tint|CRI)/.test(A)) return 'C'; if(/^(Gobo|Animation|Media)/.test(A)) return 'G';
  if(/^(Zoom|Focus)/.test(A)) return 'F'; if(/^(Iris|Prism|Frost|Beam|Blade|Effects)/.test(A)) return 'B'; return 'X'; }
const FXP_NORM={D:1,F:1,FR:1,I:1,R:1,G:1,B:1,W:1,A:1,UV:1,L:1,C:1,M:1,Y:1,SA:1};
const FXP_PHYS={D:1,P:1,T:1,Z:1,F:1,FR:1,I:1,CT:1,ST:1,GR:1,GI:1,WR:1,PRR:1,PI:1,SP:1,R:1,G:1,B:1,W:1,A:1,UV:1,L:1,C:1,M:1,Y:1,HU:1,SA:1};
function fxpTable(T,TI,fns){ const key=JSON.stringify(fns); let ti=TI.get(key); if(ti==null){ ti=T.length; T.push(fns); TI.set(key,ti); } return ti; }
// GDTF: ft = {tag,a,c} ağacındaki FixtureType düğümü. Dönüş: {p:profil, media:[[teker,yuva,dosya]]}
function fxpFromGDTF(ft){
  const kids=(n,t)=>n.c.filter(c=>c.tag===t), all=(n,t,o=[])=>{ for(const c of n.c){ if(c.tag===t) o.push(c); all(c,t,o); } return o; };
  const W=[], WI={}, media=[];
  all(ft,'Wheel').forEach(w=>{ const wi=W.length; let hasImg=false; const sl=kids(w,'Slot').map((s,k)=>{ const col=s.a.Color?fxpCie(s.a.Color):''; if(s.a.MediaFileName){ media.push([wi,k,s.a.MediaFileName]); hasImg=true; } return [s.a.Name||'',col&&col!=='ffffff'?col:'','',kids(s,'Facet').length]; });
    const n=w.a.Name||('Wheel'+wi), k=/^colou?r/i.test(n)?'c':/^gobo/i.test(n)?'g':/^prism/i.test(n)?'p':/^anim/i.test(n)?'a':sl.some(s=>s[3])?'p':hasImg?'g':'c'; WI[n]=wi; W.push({n,k,s:sl}); });
  const ph={}, bm=all(ft,'Beam')[0];
  if(bm){ if(+bm.a.BeamAngle>0) ph.ba=+bm.a.BeamAngle; if(+bm.a.FieldAngle>0) ph.fa=+bm.a.FieldAngle; if(+bm.a.LuminousFlux>0) ph.lm=Math.round(+bm.a.LuminousFlux); if(+bm.a.ColorTemperature>0) ph.k=Math.round(+bm.a.ColorTemperature); if(bm.a.LampType) ph.lt=bm.a.LampType; if(bm.a.BeamType) ph.bt=bm.a.BeamType; }
  const wheelOf=A=>{ const m=String(A||'').match(/^(Color|Gobo|Prism|AnimationWheel)(\d+)/); if(!m) return -1; const nm=m[1]==='AnimationWheel'?'Animation':m[1]; return WI[m[1]+m[2]]!=null?WI[m[1]+m[2]]:WI[nm+m[2]]!=null?WI[nm+m[2]]:WI[nm]!=null?WI[nm]:-1; };
  const T=[], TI=new Map(), M={}; let zmin=1e9, zmax=-1e9;
  for(const md of all(ft,'DMXMode')){
    const raw=[];
    for(const ch of all(md,'DMXChannel')){ const off=ch.a.Offset; if(!off||off==='None') continue; const offs=off.split(',').map(v=>parseInt(v,10)).filter(n=>n>0); if(!offs.length) continue;
      const by=offs.length, MX=Math.pow(256,by)-1, lcs=kids(ch,'LogicalChannel'); if(!lcs.length) continue; const LA=lcs[0].a.Attribute||'';
      const fl=[]; lcs.forEach(l=>kids(l,'ChannelFunction').forEach(f=>fl.push(f)));
      raw.push({ch,offs,by,MX,LA,fl,name:ch.a.Name||((ch.a.Geometry||'')+'_'+LA)}); }
    // ModeMaster bir kanal fonksiyonunu gösteriyorsa, o fonksiyonun DMX aralıklarını bul
    const fnRanges=(chName,fnName)=>{ const r=raw.find(x=>x.name===chName); if(!r) return null; const out=[];
      r.fl.forEach((f,i)=>{ if((f.a.Name||f.a.Attribute)!==fnName) return; const a=fxpDmx(f.a.DMXFrom,r.by); let b=r.MX; for(let j=i+1;j<r.fl.length;j++){ const n=fxpDmx(r.fl[j].a.DMXFrom,r.by); if(n>a&&!r.fl[j].a.ModeMaster){ b=n-1; break; } } out.push(a,b); }); return out.length?out:null; };
    const chans=[];
    for(const R of raw){ const {offs,by,MX,LA,fl}=R, fns=[];
      fl.forEach((fn,i)=>{ const from=fxpDmx(fn.a.DMXFrom,by), mkey=(fn.a.ModeMaster||'')+'|'+(fn.a.ModeFrom||'')+'|'+(fn.a.ModeTo||'');
        let to=MX; for(let j=i+1;j<fl.length;j++){ const g=fl[j], gk=(g.a.ModeMaster||'')+'|'+(g.a.ModeFrom||'')+'|'+(g.a.ModeTo||''), n=fxpDmx(g.a.DMXFrom,by); if(gk===mkey&&n>from){ to=n-1; break; } }
        if(to<from) return;
        const A=fn.a.Attribute||LA; let kd=fxpKind(A); const wn=fn.a.Wheel; let wi=wn!=null&&WI[wn]!=null?WI[wn]:-1; if(wi<0&&/^(S|SS|SR|WR|PS|GI|GR)$/.test(kd)) wi=wheelOf(A);
        if(kd==='PS') kd=wi>=0?'S':'PR';
        let pf=fn.a.PhysicalFrom!=null&&fn.a.PhysicalFrom!==''?+fn.a.PhysicalFrom:0, pt=fn.a.PhysicalTo!=null&&fn.a.PhysicalTo!==''?+fn.a.PhysicalTo:1; if(!isFinite(pf)) pf=0; if(!isFinite(pt)) pt=1;
        const nm=Math.max(Math.abs(pf),Math.abs(pt)); if(FXP_NORM[kd]&&nm>1.0001){ pf/=nm; pt/=nm; }
        if(kd==='Z'){ zmin=Math.min(zmin,pf,pt); zmax=Math.max(zmax,pf,pt); }
        let mm=null; if(fn.a.ModeMaster){ const parts=fn.a.ModeMaster.split('.'); if(parts.length>=3){ const rg=fnRanges(parts[0],parts[parts.length-1]); if(rg) mm=[parts[0]].concat(rg); }
          else { const r=raw.find(x=>x.name===parts[0]); if(r) mm=[parts[0],fxpDmx(fn.a.ModeFrom,r.by),fxpDmx(fn.a.ModeTo,r.by)]; } }
        const lab0=fn.a.Name||A, sets=kids(fn,'ChannelSet'), mid=(a,b)=>to>from?(a-from)/(to-from):0, ip=(x)=>Math.round((pf+(pt-pf)*x)*1000)/1000;
        const push=(a,b,lab,spf,spt,slot)=>{ let k=kd; if(k==='SH') k=/clos|off|blackout|black/i.test(lab)?'X':'O'; const e=[a,b,lab||lab0,k,spf,spt,wi,slot]; if(mm) e.push(mm); fns.push(e); };
        if(sets.length){ const first=fxpDmx(sets[0].a.DMXFrom,by); if(first>from) push(from,first-1,lab0,ip(0),ip(mid(first-1)),0);
          sets.forEach((s,j)=>{ const a=fxpDmx(s.a.DMXFrom,by); if(a<from||a>to) return; let b=j+1<sets.length?fxpDmx(sets[j+1].a.DMXFrom,by)-1:to; b=Math.min(b,to); if(b<a) return;
            let spf=ip(mid(a)), spt=ip(mid(b)); if(FXP_PHYS[kd]&&s.a.PhysicalFrom!=null&&s.a.PhysicalFrom!==''&&!/^(S|SS)$/.test(kd)){ spf=+s.a.PhysicalFrom; spt=s.a.PhysicalTo!=null?+s.a.PhysicalTo:spf; if(FXP_NORM[kd]&&nm>1.0001){ spf/=nm; spt/=nm; } }
            push(a,b,s.a.Name||lab0,spf,spt,+s.a.WheelSlotIndex||0); }); }
        else push(from,to,lab0,ip(0),ip(1),0); });
      if(!fns.length) continue; if(fns.length>200) fns.length=200;
      const df=R.ch.a.Default!=null?R.ch.a.Default:(fl[0]&&fl[0].a.Default); chans.push([offs,LA,fxpGroup(LA),fxpDmx(df||'0/1',by),fxpTable(T,TI,fns),R.name]); }
    if(chans.length) M[md.a.Name||('Mod '+(Object.keys(M).length+1))]=chans; }
  if(zmin<=zmax) ph.z=[Math.round(zmin*10)/10,Math.round(zmax*10)/10];
  return {p:{v:1,ph,w:W,t:T,m:M},media};
}
// ---- OFL ----
function fxpNum(s,re){ const m=String(s==null?'':s).match(re); return m?+m[1]:null; }
function fxpOflSpeed(s){ if(s==null) return null; s=String(s); const hz=fxpNum(s,/(-?[\d.]+)\s*Hz/i); if(hz!=null) return hz; const rpm=fxpNum(s,/(-?[\d.]+)\s*rpm/i); if(rpm!=null) return rpm*(/CCW/.test(s)?-1:1);
  const pc=fxpNum(s,/(-?[\d.]+)\s*%/); const base=pc!=null?pc/100:/stop/i.test(s)?0:/slow/i.test(s)?.1:/fast/i.test(s)?1:null; if(base==null) return null; return base*(/CCW/.test(s)?-1:1); }
function fxpFromOFL(j){
  const av=j.availableChannels||{}, lens=(j.physical&&j.physical.lens&&j.physical.lens.degreesMinMax)||null, bulb=(j.physical&&j.physical.bulb)||{};
  const W=[], WI={}, refs=[], cnt={c:0,g:0,p:0,a:0}, WA={};
  for(const [wn,wh] of Object.entries(j.wheels||{})){ const sl=(wh&&wh.slots)||[], types=sl.map(s=>s&&s.type);
    const k=/colou?r/i.test(wn)?'c':/gobo/i.test(wn)?'g':/prism/i.test(wn)?'p':/anim/i.test(wn)?'a':types.includes('Gobo')?'g':types.includes('Prism')?'p':types.includes('AnimationGoboStart')?'a':'c';
    const wi=W.length; cnt[k]++; WA[wn]=({c:'Color',g:'Gobo',p:'Prism',a:'AnimationWheel'})[k]+cnt[k];
    W.push({n:wn,k,s:sl.map((s,ix)=>{ s=s||{}; const res=typeof s.resource==='string'?s.resource:(s.resource&&s.resource.key)||''; if(res) refs.push([wi,ix,res]);
      const nm=s.name||(s.type==='Open'?'Open':s.type==='Closed'?'Closed':s.type==='Color'?'':((s.type||'Slot')+' '+(ix+1))); return [nm,Array.isArray(s.colors)&&s.colors[0]?String(s.colors[0]).replace('#','').toLowerCase().slice(0,6):'','',s.type==='Prism'?(s.facets||3):0]; })}); WI[wn]=wi; }
  const fineOf={}; for(const [n,c] of Object.entries(av)) (c&&c.fineChannelAliases||[]).forEach((a,i)=>{ fineOf[a]={n,i}; });
  const ang=(s,def)=>{ if(s==null) return def; if(/wide/i.test(s)) return lens?lens[1]:40; if(/narrow/i.test(s)) return lens?lens[0]:10; const d=fxpNum(s,/(-?[\d.]+)\s*deg/); if(d!=null) return d; const p=fxpNum(s,/(-?[\d.]+)\s*%/); if(p!=null&&lens) return lens[0]+(lens[1]-lens[0])*p/100; return def; };
  const pct=(s,map,def)=>{ if(s==null) return def; for(const [re,v] of map) if(re.test(s)) return v; const p=fxpNum(s,/(-?[\d.]+)\s*%/); return p!=null?p/100:def; };
  const kel=s=>{ if(s==null) return null; const k=fxpNum(s,/([\d.]+)\s*K/); if(k!=null) return k; return /warm|CTO/i.test(s)?3200:/cold|CTB/i.test(s)?8000:/default/i.test(s)?(bulb.colorTemperature||6500):null; };
  const T=[], TI=new Map(), M={};
  const capOf=c=>c?(c.capability?[Object.assign({dmxRange:[0,255]},c.capability)]:(c.capabilities||[])):[];
  const attrOf=(nm,caps)=>{ const c=caps.find(x=>x&&x.type&&x.type!=='NoFunction')||caps[0]||{}, t=c.type, wn=c.wheel||nm, wa=WA[wn]||WA[Object.keys(WA).find(k=>k===nm)||'']||null;
    switch(t){ case 'Intensity': return 'Dimmer'; case 'Pan': return 'Pan'; case 'Tilt': return 'Tilt';
      case 'ColorIntensity': return ({Red:'ColorAdd_R',Green:'ColorAdd_G',Blue:'ColorAdd_B',White:'ColorAdd_W','Warm White':'ColorAdd_WW','Cold White':'ColorAdd_CW',Amber:'ColorAdd_RY',UV:'ColorAdd_UV',Lime:'ColorAdd_GY',Cyan:'ColorSub_C',Magenta:'ColorSub_M',Yellow:'ColorSub_Y',Indigo:'ColorAdd_B'})[c.color]||nm;
      case 'ColorPreset': return 'ColorMacro1'; case 'ColorTemperature': return 'CTO'; case 'Zoom': case 'BeamAngle': return 'Zoom'; case 'Focus': return 'Focus1'; case 'Iris': return 'Iris'; case 'Frost': return 'Frost1';
      case 'Prism': return 'Prism1'; case 'PrismRotation': return 'Prism1PosRotate'; case 'ShutterStrobe': return 'Shutter1'; case 'StrobeSpeed': return 'Shutter1Strobe';
      case 'WheelSlot': case 'WheelShake': return wa||nm; case 'WheelSlotRotation': return wa?wa+'PosRotate':nm; case 'WheelRotation': return wa?wa+'WheelSpin':nm;
      case 'PanTiltSpeed': case 'Speed': return 'PositionMSpeed'; case 'Maintenance': return 'Control1'; case 'Effect': return 'Effects1'; default: return nm; } };
  // Anahtarlı kanallar (switchChannels): bir kanalın değeri başka kanalın anlamını değiştirir
  const SW={}; for(const [cn,ch] of Object.entries(av)) for(const c of capOf(ch)) if(c&&c.switchChannels) for(const [sn,tn] of Object.entries(c.switchChannels)){ const o=(SW[sn]=SW[sn]||{}); (o[tn]=o[tn]||{m:cn,r:[]}).r.push(c.dmxRange[0],c.dmxRange[1]); }
  const buildFns=(ch,nm,by,mm,fns)=>{ const res=({'8bit':1,'16bit':2,'24bit':3})[ch.dmxValueResolution]||1, sc=v=>by>=res?v*Math.pow(256,by-res):Math.floor(v/Math.pow(256,res-by)), sce=v=>by>=res?(v+1)*Math.pow(256,by-res)-1:Math.floor(v/Math.pow(256,res-by)), caps=capOf(ch);
      for(const c of caps){ if(!c||!Array.isArray(c.dmxRange)) continue; const a=sc(c.dmxRange[0]), b=sce(c.dmxRange[1]), t=c.type, wi=c.wheel!=null&&WI[c.wheel]!=null?WI[c.wheel]:(WI[nm]!=null?WI[nm]:-1);
        let k='N', p1=0, p2=1, slot=0, lab='';
        const se=(x,y,f)=>{ const v1=f(c[x+'Start']!=null?c[x+'Start']:c[x]), v2=f(c[x+'End']!=null?c[x+'End']:c[x]); return [v1,v2!=null?v2:v1]; };
        switch(t){
          case 'Intensity': k='D'; [p1,p2]=se('brightness',0,s=>pct(s,[[/^off$/i,0],[/dark/i,.01],[/bright/i,1]],null)); if(p1==null){p1=0;p2=1;} lab='Dimmer'; break;
          case 'Pan': case 'Tilt': k=t==='Pan'?'P':'T'; [p1,p2]=se('angle',0,s=>fxpNum(s,/(-?[\d.]+)\s*deg/)); if(p1==null){ p1=0; p2=t==='Pan'?540:270; } lab=t; break;
          case 'ColorIntensity': k=({Red:'R',Green:'G',Blue:'B',White:'W','Warm White':'W','Cold White':'W',Amber:'A',UV:'UV',Lime:'L',Cyan:'C',Magenta:'M',Yellow:'Y',Indigo:'B'})[c.color]||'N'; [p1,p2]=se('brightness',0,s=>pct(s,[[/^off$/i,0],[/dark/i,.01],[/bright/i,1]],null)); if(p1==null){p1=0;p2=1;} lab=c.color||nm; break;
          case 'ColorPreset': k='CP'; p1=Array.isArray(c.colors)&&c.colors[0]?String(c.colors[0]).replace('#','').toLowerCase().slice(0,6):''; p2=0; lab=c.comment||c.colorsStart&&'Renk geçişi'||'Renk'; break;
          case 'ColorTemperature': k='CT'; [p1,p2]=se('colorTemperature',0,kel); if(p1==null){p1=bulb.colorTemperature||6500;p2=3200;} lab='CTO '+Math.round(p1)+(p2!==p1?'…'+Math.round(p2):'')+' K'; break;
          case 'WheelSlot': case 'WheelShake': { k=t==='WheelSlot'?'S':'SS'; const sn=c.slotNumberStart!=null?c.slotNumberStart:c.slotNumber; slot=sn!=null?Math.floor(sn):0; p1=sn||0; p2=c.slotNumberEnd!=null?c.slotNumberEnd:p1;
            const W0=W[wi], S0=W0&&W0.s[slot-1]; lab=(S0&&S0[0])||(W0?W0.n+' '+slot:'Yuva '+slot); if(sn!=null&&sn%1) lab+=' (yarım)'; if(t==='WheelShake') lab+=' sallama'; if(W0&&W0.k==='p'&&S0&&slot>1) k=k; break; }
          case 'WheelSlotRotation': case 'WheelRotation': if(c.angleStart!=null||c.angle!=null){ k='GI'; [p1,p2]=se('angle',0,s=>fxpNum(s,/(-?[\d.]+)\s*deg/)); if(p1==null){p1=0;p2=360;} lab='İndeks'; } else { k=t==='WheelRotation'?'WR':'GR'; [p1,p2]=se('speed',0,fxpOflSpeed); if(p1==null){p1=0;p2=0;} lab=t==='WheelRotation'?'Teker dönüşü':'Dönüş'; } break;
          case 'Zoom': case 'BeamAngle': k='Z'; [p1,p2]=se('angle',0,s=>ang(s,null)); if(p1==null){ p1=lens?lens[1]:40; p2=lens?lens[0]:10; } lab='Zoom'; break;
          case 'Focus': k='F'; [p1,p2]=se('distance',0,s=>pct(s,[[/near/i,0],[/far/i,1]],null)); if(p1==null){p1=0;p2=1;} lab='Fokus'; break;
          case 'Iris': k='I'; [p1,p2]=se('openPercent',0,s=>pct(s,[[/open/i,1],[/closed/i,0]],null)); if(p1==null){p1=1;p2=0;} lab='İris'; break;
          case 'Frost': k='FR'; [p1,p2]=se('frostIntensity',0,s=>pct(s,[[/off/i,0],[/low/i,.25],[/high/i,1]],null)); if(p1==null){p1=0;p2=1;} lab='Frost'; break;
          case 'Prism': { k='PR'; const fm=String(c.comment||'').match(/(\d+)\s*-?\s*facet/i); p1=fm?+fm[1]:3; const sp=fxpOflSpeed(c.speedStart!=null?c.speedStart:c.speed); p2=sp||0; lab=(c.comment||'Prizma'); break; }
          case 'PrismRotation': k=c.angleStart!=null||c.angle!=null?'PI':'PRR'; [p1,p2]=k==='PI'?se('angle',0,s=>fxpNum(s,/(-?[\d.]+)\s*deg/)):se('speed',0,fxpOflSpeed); if(p1==null){p1=0;p2=0;} lab='Prizma dönüşü'; break;
          case 'ShutterStrobe': { const ef=c.shutterEffect||''; if(ef==='Open'){ k='O'; lab='Açık'; } else if(ef==='Closed'){ k='X'; lab='Kapalı'; } else { k='ST'; [p1,p2]=se('speed',0,fxpOflSpeed); if(p1==null){p1=1;p2=20;} if(p1<=1&&p2<=1&&!/Hz/i.test(String(c.speedStart||c.speed||''))){ p1=1+p1*19; p2=1+p2*19; } lab=({Strobe:'Strobe',Pulse:'Pulse',RampUp:'Rampa yukarı',RampDown:'Rampa aşağı',RampUpDown:'Rampa',Lightning:'Şimşek',Spikes:'Spikes',Burst:'Patlama'})[ef]||ef||'Strobe'; if(c.randomTiming) lab+=' rastgele'; } break; }
          case 'StrobeSpeed': k='ST'; [p1,p2]=se('speed',0,fxpOflSpeed); if(p1==null){p1=1;p2=20;} lab='Strobe hızı'; break;
          case 'NoFunction': k='N'; lab='—'; break;
          case 'Maintenance': k='CTL'; lab=c.comment||'Bakım'; break;
          case 'Speed': case 'PanTiltSpeed': case 'EffectSpeed': case 'Time': k='SP'; lab=c.comment||(t==='PanTiltSpeed'?'Pan/Tilt hızı':'Hız'); break;
          default: k=/Effect|Fog|Sound|Rotation|Blade/.test(t||'')?'FX':'N'; lab=c.effectName||c.comment||t||nm;
        }
        if(c.comment&&(k==='N'||k==='CTL')) lab=c.comment; else if(c.comment&&!/^(CP|ST|O|X|PR)$/.test(k)&&lab&&!lab.includes(c.comment)) lab+=' – '+c.comment;
        if(typeof p1==='number') p1=Math.round(p1*1000)/1000; if(typeof p2==='number') p2=Math.round(p2*1000)/1000;
        const e=[a,b,lab,k,p1,p2,wi,slot]; if(mm) e.push(mm); fns.push(e); }
    return sc; };
  for(const mode of (j.modes||[])){ const list=mode.channels||[], chans=[], used=new Set();
    const bytesOf=n=>1+((av[n]&&av[n].fineChannelAliases)||[]).filter(fa=>list.includes(fa)).length;
    list.forEach((nm,ix)=>{ if(typeof nm!=='string'||fineOf[nm]) return; let ch=av[nm]; const offs=[ix+1], fns=[]; let A, dv=0;
      if(ch){ (ch.fineChannelAliases||[]).forEach(fa=>{ const k=list.indexOf(fa); if(k>=0) offs.push(k+1); }); A=attrOf(nm,capOf(ch)); const sc=buildFns(ch,nm,offs.length,null,fns);
        dv=ch.defaultValue!=null?(typeof ch.defaultValue==='number'?sc(ch.defaultValue):Math.round((parseFloat(ch.defaultValue)||0)/100*(Math.pow(256,offs.length)-1))):null; }
      else if(SW[nm]){ const tg=Object.entries(SW[nm]); if(tg.some(([tn])=>fineOf[tn])) return;
        const fineT=new Set(tg.flatMap(([tn])=>(av[tn]&&av[tn].fineChannelAliases)||[])); list.forEach((x,k)=>{ if(typeof x==='string'&&SW[x]&&Object.keys(SW[x]).some(t=>fineT.has(t))) offs.push(k+1); });
        for(const [tn,inf] of tg){ const tch=av[tn]; if(!tch) continue; if(!A) A=attrOf(tn,capOf(tch)); const mb=bytesOf(inf.m), mr=[]; for(let q=0;q<inf.r.length;q+=2) mr.push(inf.r[q]*Math.pow(256,mb-1),(inf.r[q+1]+1)*Math.pow(256,mb-1)-1);
          buildFns(tch,tn,offs.length,[inf.m].concat(mr),fns); } }
      else return;
      if(used.has(A)) A=A+'_'+nm; used.add(A);
      if(!fns.length) return;
      // Pan/Tilt: ortası 0° olsun (−270…+270 gibi)
      const pk=fns.filter(e=>e[3]==='P'||e[3]==='T'); if(pk.length){ const lo=Math.min(...pk.map(e=>Math.min(e[4],e[5]))), hi=Math.max(...pk.map(e=>Math.max(e[4],e[5]))), m=(lo+hi)/2; pk.forEach(e=>{ e[4]-=m; e[5]-=m; }); }
      if(dv==null) dv=fns.find(e=>e[3]==='O')?fns.find(e=>e[3]==='O')[0]:0;
      chans.push([offs,A,fxpGroup(A),dv,fxpTable(T,TI,fns),nm]); });
    if(chans.length) M[String(mode.name||mode.shortName||'Mod')]=chans; }
  const ph={}; if(lens){ ph.z=[lens[0],lens[1]]; ph.ba=Math.round((lens[0]+lens[1])/2*10)/10; } if(bulb.lumens) ph.lm=bulb.lumens; if(bulb.colorTemperature) ph.k=bulb.colorTemperature; if(bulb.type) ph.lt=bulb.type;
  return {p:{v:1,ph,w:W,t:T,m:M},refs};
}

// Cihazın türü (planda ve kütüphanede doğru simge): ada değil cihazın gerçek özelliklerine bakar
function fxpType(p,name){ const n=String(name||'').toLowerCase(), A=new Set(), K=new Set();
  for(const ch of Object.values((p&&p.m)||{})) for(const c of ch){ A.add(c[1]); for(const e of (p.t[c[4]]||[])) K.add(e[3]); }
  const has=re=>{ for(const a of A) if(re.test(a)) return true; return false; }, W=(p&&p.w)||[], ph=(p&&p.ph)||{}, bt=String(ph.bt||'').toLowerCase();
  const gobo=W.some(w=>w.k==='g'&&w.s.length>1)||has(/^Gobo\d/), mix=has(/^ColorAdd_|^ColorSub_|^HSB_/), zmax=ph.z?Math.max(ph.z[0],ph.z[1]):(ph.ba||0);
  if(has(/^(Fog|Haze)/)||/\b(hazer|haze|fog|smoke|fazer)\b/.test(n)) return 'hazer';
  if(has(/^Pan$/)&&has(/^Tilt$/)){ if(/\bbeam\b|sharpy/.test(n)) return 'beam'; if(/\bwash\b|aura|spiider|\bbee ?eye\b/.test(n)) return 'wash'; if(/\bspot\b|profile/.test(n)) return 'spot';
    if(gobo) return zmax&&zmax<=8?'beam':'spot'; return 'wash'; }
  if(/blinder|molefay/.test(n)) return 'blinder';
  if(/follow ?spot|takip/.test(n)) return 'follow';
  if(/strobe|atomic|\bjdc\b/.test(n)) return 'strobe';
  if(/\bbar\b|batten|strip|tube|linear/.test(n)) return 'bar';
  if(/fresnel/.test(n)||bt==='fresnel') return 'fresnel';
  if(/\bpc\b/.test(n)||bt==='pc') return 'pc';
  if(has(/^Blade/)||/profile|ellipsoidal|leko|source ?four|\bers\b|zoomspot/.test(n)) return 'profile';
  if(!mix&&K.has('ST')&&!K.has('D')) return 'strobe';
  return 'par'; }

// ---- Orijinal özellik paketleri (vendor/fx/*.js): sıkıştırılmış, ihtiyaç anında yüklenir ----
function fxpHash(s){ let h=0x811c9dc5; s=String(s); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h>>>0; }
function fxpWriteShards(dir,groups){ mkdirSync(dir,{recursive:true}); let n=0, bytes=0;
  for(const [id,obj] of Object.entries(groups)){ const b64=zlib.gzipSync(Buffer.from(JSON.stringify(obj)),{level:9}).toString('base64'); const txt=`FXP_SHARD(${JSON.stringify(id)},"${b64}");\n`; writeFileSync(`${dir}/${id}.js`,txt); n++; bytes+=txt.length; }
  return {n,bytes}; }
let SHARP; async function goboImg(buf,svg){ if(SHARP===undefined){ try{ SHARP=(await import('sharp')).default; }catch(_){ SHARP=null; } }
  try{ if(SHARP){ const out=await SHARP(buf,{density:svg?96:72}).flatten({background:'#000'}).resize(64,64,{fit:'contain',background:'#000'}).grayscale().png({palette:true,colours:16,compressionLevel:9}).toBuffer(); return 'data:image/png;base64,'+out.toString('base64'); } }catch(_){ }
  if(!svg&&buf.length<9000) return 'data:image/png;base64,'+buf.toString('base64'); if(svg&&buf.length<9000) return 'data:image/svg+xml;base64,'+buf.toString('base64'); return null; }
const FX_DETAIL = process.env.FX_DETAIL !== '0';

async function gdtfDetail(buf){ const z=readZip(buf), x=z.read('description.xml'); if(!x) return null; const ft=all(parseXML(x.toString('utf8')),'FixtureType')[0]; if(!ft) return null;
  const {p,media}=fxpFromGDTF(ft), imgs={};
  for(const [wi,k,mf] of media){ const nm=[`wheels/${mf}.png`,`wheels/${mf}`,`wheels/${mf}.svg`,`wheels/${mf}.jpg`].find(n=>z.files.has(n)); if(!nm) continue;
    let b=null; try{ b=z.read(nm); }catch(_){ } if(!b) continue; const im=await goboImg(b,/\.svg$/i.test(nm)); if(!im) continue;
    const h=createHash('sha1').update(im).digest('hex').slice(0,14); imgs[h]=im; if(p.w[wi]&&p.w[wi].s[k]) p.w[wi].s[k][2]='h:'+h; }
  let th=null; const tn=['thumbnail.png','thumbnail.svg'].find(n=>z.files.has(n)); if(tn&&FX_DETAIL){ try{ th=await thumbImg(z.read(tn),/svg$/.test(tn)); }catch(_){ } }
  return {p,imgs,th}; }
async function thumbImg(buf,svg){ if(SHARP===undefined) await goboImg(Buffer.alloc(0)); if(!SHARP) return null;
  try{ const out=await SHARP(buf,{density:svg?96:72}).resize(48,48,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png({palette:true,colours:48,compressionLevel:9}).toBuffer(); return 'data:image/png;base64,'+out.toString('base64'); }catch(_){ return null; } }
// ---- GDTF Share API (çerezli oturum) ----
let cookie='';
async function api(path,opt={}){ const h=Object.assign({},opt.headers||{}); if(cookie) h.Cookie=cookie; const r=await fetch(API+path,Object.assign({},opt,{headers:h}));
  const sc=typeof r.headers.getSetCookie==='function'?r.headers.getSetCookie():(r.headers.get('set-cookie')?[r.headers.get('set-cookie')]:[]); if(sc.length) cookie=sc.map(c=>c.split(';')[0]).join('; '); return r; }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  if(process.env.GDTF_TEST_DIR){ const fs=await import('fs'); const out=[], P={}, I={}; for(const fn of fs.readdirSync(process.env.GDTF_TEST_DIR).filter(n=>/\.gdtf$/i.test(n))){ const buf=fs.readFileSync(process.env.GDTF_TEST_DIR+'/'+fn), rid='t'+fxpHash(fn); const e=parseGDTF(buf); if(!e) continue; e.rid=rid; const d=await gdtfDetail(buf); if(d){ e.t=fxpType(d.p,e.m); if(d.th){ const h=createHash('sha1').update(d.th).digest('hex').slice(0,14); (I['i'+(parseInt(h.slice(0,4),16)%64)]=I['i'+(parseInt(h.slice(0,4),16)%64)]||{})[h]=d.th; e.th='h:'+h; } e.fp='g:'+rid; (P['g'+(fxpHash(rid)%64)]=P['g'+(fxpHash(rid)%64)]||{})[rid]=d.p; for(const [h,im] of Object.entries(d.imgs)) (I['i'+(parseInt(h.slice(0,4),16)%64)]=I['i'+(parseInt(h.slice(0,4),16)%64)]||{})[h]=im; } out.push(e); }
    mkdirSync(outDir,{recursive:true}); writeFileSync(outDir+'/gdtf-library.js','window.GDTF_LIB='+JSON.stringify({v:1,date:'test',lib:out})+';\n'); console.log(fxpWriteShards(outDir+'/fx',P),fxpWriteShards(outDir+'/fx',I),out.length); process.exit(0); }
  if(!USER||!PASS){ console.log('GDTF_USER / GDTF_PASS tanımlı değil; GDTF kütüphanesi atlandı.'); process.exit(0); }
  const lr=await api('login.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:USER,password:PASS})}); const lj=await lr.json().catch(()=>({}));
  if(!lj.result) throw new Error('giriş olmadı: '+(lj.error||lr.status));
  const lst=await (await api('getList.php')).json(); if(!lst.result) throw new Error('liste alınamadı');
  // her cihaz tipi (uuid) için tek dosya: üretici yüklemesi önce, sonra en yeni
  const best=new Map(); for(const it of lst.list||[]){ if(ONLY_MANUF&&it.uploader!=='Manuf.') continue; const k=it.uuid||(it.manufacturer+'|'+it.fixture), o=best.get(k);
    const sc=x=>(x.uploader==='Manuf.'?1e12:0)+(+x.lastModified||0); if(!o||sc(it)>sc(o)) best.set(k,it); }
  const items=[...best.values()]; mkdirSync(CACHE,{recursive:true}); console.log(`${items.length} cihaz tipi bulundu`);
  const out=[]; let dl=0, bad=0, i=0;
  // Önbellekte dosyanın kendisi değil, okunmuş küçük özeti (rid.json) saklanır: gigabaytlarca 3D model taşımaya gerek yok
  // Önbellek (v2): okunmuş özet + orijinal özellik profili + küçültülmüş gobo resimleri (dosyanın kendisi değil)
  const C2=CACHE+'/v2'; mkdirSync(C2,{recursive:true}); const PROF={}, IMGS={};
  const keep=(it,d)=>{ const e=d&&d.e; if(!e||!e.m){ bad++; return; } if(!e.b) e.b=it.manufacturer||''; e.rid=it.rid;
    if(d.p){ try{ e.t=fxpType(d.p,e.m); }catch(_){ } }
    if(FX_DETAIL&&d.th){ const h=createHash('sha1').update(d.th).digest('hex').slice(0,14), iid='i'+(parseInt(h.slice(0,4),16)%64); (IMGS[iid]=IMGS[iid]||{})[h]=d.th; e.th='h:'+h; }
    if(FX_DETAIL&&d.p){ e.fp='g:'+it.rid; const sid='g'+(fxpHash(it.rid)%64); (PROF[sid]=PROF[sid]||{})[it.rid]=d.p; for(const [h,im] of Object.entries(d.imgs||{})){ const iid='i'+(parseInt(h.slice(0,4),16)%64); (IMGS[iid]=IMGS[iid]||{})[h]=im; } }
    out.push(e); };
  async function worker(){ while(i<items.length){ const it=items[i++], fp=`${C2}/${it.rid}.json`;
      if(existsSync(fp)){ try{ keep(it,JSON.parse(readFileSync(fp,'utf8'))); continue; }catch(_){ } }
      let buf=null; for(let t=0;t<3&&!buf;t++){ try{ const r=await api('downloadFile.php?rid='+it.rid); const b=Buffer.from(await r.arrayBuffer()); if(r.ok&&b[0]===0x50&&b[1]===0x4B) buf=b; else await sleep(800); }catch(_){ await sleep(1500); } }
      await sleep(150); if(!buf){ bad++; continue; } dl++;
      let d={e:null}; try{ d.e=parseGDTF(buf); }catch(_){ }
      if(d.e){ try{ const x=await gdtfDetail(buf); if(x){ d.p=x.p; d.imgs=x.imgs; d.th=x.th; } }catch(_){ } }
      try{ writeFileSync(fp,JSON.stringify(d)); }catch(_){}
      keep(it,d); } }
  await Promise.all([worker(),worker(),worker()]);
  out.sort((a,b)=>a.b.localeCompare(b.b)||a.m.localeCompare(b.m)); const date=new Date().toISOString().slice(0,10);
  mkdirSync(outDir,{recursive:true});
  if(FX_DETAIL){ const a=fxpWriteShards(outDir+'/fx',PROF), b=fxpWriteShards(outDir+'/fx',IMGS); console.log(`Orijinal özellikler: ${Object.values(PROF).reduce((n,o)=>n+Object.keys(o).length,0)} cihaz, ${Object.values(IMGS).reduce((n,o)=>n+Object.keys(o).length,0)} gobo resmi (${Math.round((a.bytes+b.bytes)/1048576)} MB)`); }
  writeFileSync(outDir+'/gdtf-library.js','/* Kaynak: GDTF Share (gdtf-share.com) — izinle — '+date+' */\nwindow.GDTF_LIB='+JSON.stringify({v:1,date,lib:out})+';\n');
  writeFileSync('gdtf-kutuphane.json',JSON.stringify({kind:'isik-plani-kutuphane',source:'GDTF Share (gdtf-share.com)',date,count:out.length,lib:out.map(e=>{ const r=Object.assign({},e); delete r.fp; delete r.th; return r; })}));
  console.log(`${out.length} cihaz kaydedildi (${dl} yeni indirme, ${bad} okunamadı): ${outDir}/gdtf-library.js ve gdtf-kutuphane.json`);
}catch(e){ console.warn('GDTF kütüphanesi oluşturulamadı ('+e.message+'). Program diğer kütüphanelerle çalışmaya devam eder.'); process.exit(0); }
