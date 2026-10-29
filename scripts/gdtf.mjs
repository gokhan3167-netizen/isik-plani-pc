// GDTF Share'deki GDTF dosyalarını (izinle) indirip programın içine gömer.
// Kullanım: GDTF_USER=... GDTF_PASS=... node scripts/gdtf.mjs   (Node.js 18+; ek paket gerekmez)
// Çıktı: www/vendor/gdtf-library.js (programa gömülü)  +  gdtf-kutuphane.json (diğer cihazlara yüklemek için)
// Okunan dosyaların özeti gdtf-cache/ klasöründe saklanır; sonraki derlemelerde yalnızca yeni/değişen revizyonlar indirilir.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import zlib from 'zlib';

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
  if(/^Gobo\d+(Pos)?(Rotate|WheelSpin|WheelAudio)|^Gobo\d+PosRotate/.test(a)) return 'GR'; if(/^Gobo/.test(a)) return 'GB'; if(/^Iris/.test(a)) return 'I'; if(/^Prism/.test(a)) return 'PR';
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
  const wheels={}; all(ft,'Wheel').forEach(w=>{ wheels[w.a.Name]=w.c.filter(c=>c.tag==='Slot').map(s=>s.a.Color?cie(s.a.Color):'ffffff'); });
  let pr=null, tr=null;
  const modes=all(ft,'DMXMode').map(md=>{ let mx=0; const tk={}; let cw=null;
    for(const ch of all(md,'DMXChannel')){ const off=ch.a.Offset; if(!off||off==='None') continue; const lc=all(ch,'LogicalChannel')[0], at=lc?lc.a.Attribute:'', base=gdtfAttrToken(at), offs=off.split(',').map(Number);
      offs.forEach((n,i)=>{ if(n>0){ if(n>mx) mx=n; tk[n]=i===0?base:(base==='x'?'x':base+(i+1)); } });
      const cf=lc?all(lc,'ChannelFunction'):[];
      if(base==='P'&&pr==null&&cf[0]){ const a=+cf[0].a.PhysicalFrom, b=+cf[0].a.PhysicalTo; if(isFinite(a)&&isFinite(b)&&Math.abs(b-a)>=90) pr=Math.abs(b-a); }
      if(base==='T'&&tr==null&&cf[0]){ const a=+cf[0].a.PhysicalFrom, b=+cf[0].a.PhysicalTo; if(isFinite(a)&&isFinite(b)&&Math.abs(b-a)>=45) tr=Math.abs(b-a); }
      if(base==='CW'&&!cw){ const bytes=offs.filter(n=>n>0).length, tab=[], fns=cf.filter(f=>f.a.Wheel&&wheels[f.a.Wheel]);
        for(const f of fns){ const sl=wheels[f.a.Wheel], sets=f.c.filter(c=>c.tag==='ChannelSet');
          sets.forEach((s,i)=>{ const k=+s.a.WheelSlotIndex; if(!(k>=1)||!sl[k-1]) return; const a=dmxv(s.a.DMXFrom,bytes), nx=sets[i+1]?dmxv(sets[i+1].a.DMXFrom,bytes)-1:a+Math.pow(256,bytes)/64; tab.push([a,Math.max(a,nx),sl[k-1]]); }); if(tab.length) break; }
        if(tab.length) cw=tab; } }
    const r=[md.a.Name||'Mod',mx,[...Array(mx)].map((_,i)=>tk[i+1]||'x').join(',')]; if(cw) r.push({cw}); return r; }).filter(m=>m[1]>0);
  if(!modes.length) return null;
  const e={b:brand,m:model,t:guessType(model+' '+(ft.a.Description||'')),modes};
  if(pr) e.pr=pr; if(tr) e.tr=tr;
  const beam=all(ft,'Beam')[0]; if(beam&&+beam.a.BeamAngle>0) e.ba=+beam.a.BeamAngle;
  const models=all(ft,'Model'), g0=all(ft,'Geometries')[0], first=g0&&g0.c.find(c=>c.a.Model), mdl=(first&&models.find(m=>m.a.Name===first.a.Model))||models[0];
  if(mdl&&+mdl.a.Length>.04&&+mdl.a.Width>.04) e.sz=[+mdl.a.Length,+mdl.a.Width,+mdl.a.Height||0];
  return e;
}
// ---- GDTF Share API (çerezli oturum) ----
let cookie='';
async function api(path,opt={}){ const h=Object.assign({},opt.headers||{}); if(cookie) h.Cookie=cookie; const r=await fetch(API+path,Object.assign({},opt,{headers:h}));
  const sc=typeof r.headers.getSetCookie==='function'?r.headers.getSetCookie():(r.headers.get('set-cookie')?[r.headers.get('set-cookie')]:[]); if(sc.length) cookie=sc.map(c=>c.split(';')[0]).join('; '); return r; }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
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
  async function worker(){ while(i<items.length){ const it=items[i++], fp=`${CACHE}/${it.rid}.json`;
      if(existsSync(fp)){ try{ const e=JSON.parse(readFileSync(fp,'utf8')); if(e&&e.m) out.push(e); else bad++; continue; }catch(_){ } }
      let buf=null; for(let t=0;t<3&&!buf;t++){ try{ const r=await api('downloadFile.php?rid='+it.rid); const b=Buffer.from(await r.arrayBuffer()); if(r.ok&&b[0]===0x50&&b[1]===0x4B) buf=b; else await sleep(800); }catch(_){ await sleep(1500); } }
      await sleep(150); if(!buf){ bad++; continue; } dl++;
      let e=null; try{ e=parseGDTF(buf); }catch(_){ e=null; }
      if(e){ if(!e.b) e.b=it.manufacturer||''; e.rid=it.rid; out.push(e); } else bad++;
      try{ writeFileSync(fp,JSON.stringify(e||{})); }catch(_){} } }
  await Promise.all([worker(),worker(),worker()]);
  out.sort((a,b)=>a.b.localeCompare(b.b)||a.m.localeCompare(b.m)); const date=new Date().toISOString().slice(0,10);
  mkdirSync(outDir,{recursive:true});
  writeFileSync(outDir+'/gdtf-library.js','/* Kaynak: GDTF Share (gdtf-share.com) — izinle — '+date+' */\nwindow.GDTF_LIB='+JSON.stringify({v:1,date,lib:out})+';\n');
  writeFileSync('gdtf-kutuphane.json',JSON.stringify({kind:'isik-plani-kutuphane',source:'GDTF Share (gdtf-share.com)',date,count:out.length,lib:out}));
  console.log(`${out.length} cihaz kaydedildi (${dl} yeni indirme, ${bad} okunamadı): ${outDir}/gdtf-library.js ve gdtf-kutuphane.json`);
}catch(e){ console.warn('GDTF kütüphanesi oluşturulamadı ('+e.message+'). Program diğer kütüphanelerle çalışmaya devam eder.'); process.exit(0); }
