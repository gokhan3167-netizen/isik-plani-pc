// Open Fixture Library'nin TAMAMINI kanal haritalarıyla indirip programın içine gömer (internetsiz kullanım için).
// Kullanım:  node fixtures.mjs        (Node.js 18 veya üstü; başka hiçbir şey gerekmez)
// Çıktı: www/vendor/ofl-library.js  (www klasörü yoksa vendor/ofl-library.js)
// Kaynak: Open Fixture Library — https://open-fixture-library.org
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import zlib from 'zlib';

const URL = process.env.OFL_ZIP_URL || 'https://codeload.github.com/OpenLightingProject/open-fixture-library/zip/refs/heads/master';
const outDir = existsSync('www') ? 'www/vendor' : 'vendor';

// ---- Kanal haritası: ortak kod (program ve fixtures.mjs aynı mantığı kullanır) ----
const CH_NAMES={D:'Dimmer',P:'Pan',T:'Tilt',R:'Kırmızı',G:'Yeşil',B:'Mavi',W:'Beyaz',A:'Amber',UV:'UV',L:'Lime',C:'Cyan',M:'Magenta',Y:'Sarı',CTO:'Renk sıcaklığı',CW:'Renk tekeri',Z:'Zoom',F:'Fokus',S:'Shutter / strobe',GB:'Gobo',GR:'Gobo dönüş',I:'İris',PR:'Prizma',FX:'Efekt',H:'Sis / haze',FN:'Fan',SP:'Hız',CT:'Kontrol',x:'Diğer'};
function chNameGuess(n){ n=String(n||'').toLowerCase();
  if(/fine|ince|16 ?bit|lsb/.test(n)){ const b=chNameGuess(n.replace(/fine|ince|16 ?bit|lsb/g,'')); return b==='x'?'x':b+'2'; }
  if(/^(master )?(dimmer|intensity|parlaklık)/.test(n)) return 'D'; if(/^pan\b/.test(n)) return 'P'; if(/^tilt\b/.test(n)) return 'T';
  if(/^red|kırmızı/.test(n)) return 'R'; if(/^green|yeşil/.test(n)) return 'G'; if(/^blue|mavi/.test(n)) return 'B'; if(/white|beyaz/.test(n)) return 'W';
  if(/amber/.test(n)) return 'A'; if(/\buv\b/.test(n)) return 'UV'; if(/lime/.test(n)) return 'L'; if(/^cyan/.test(n)) return 'C'; if(/^magenta/.test(n)) return 'M'; if(/^yellow/.test(n)) return 'Y';
  if(/\bcto\b|\bctc\b|\bctb\b|colou?r temp/.test(n)) return 'CTO'; if(/colou?r ?wheel|colou?r$|renk/.test(n)) return 'CW';
  if(/zoom/.test(n)) return 'Z'; if(/focus/.test(n)) return 'F'; if(/shutter|strobe/.test(n)) return 'S'; if(/gobo.*(rot|index|spin)/.test(n)) return 'GR'; if(/gobo/.test(n)) return 'GB';
  if(/iris/.test(n)) return 'I'; if(/prism/.test(n)) return 'PR'; if(/fog|haze|output/.test(n)) return 'H'; if(/\bfan\b/.test(n)) return 'FN'; if(/effect|macro|fx/.test(n)) return 'FX'; if(/speed/.test(n)) return 'SP'; if(/control|reset|lamp|function/.test(n)) return 'CT';
  return 'x'; }
function oflCapToken(cap,name){
  const t=cap&&cap.type, w=(cap&&cap.wheel)||name||'';
  switch(t){
    case 'Intensity': return 'D'; case 'Pan': return 'P'; case 'Tilt': return 'T';
    case 'ColorIntensity': return ({Red:'R',Green:'G',Blue:'B',White:'W','Warm White':'W','Cold White':'W',Amber:'A',UV:'UV',Lime:'L',Cyan:'C',Magenta:'M',Yellow:'Y',Indigo:'B'})[cap.color]||'x';
    case 'ColorPreset': return 'CW'; case 'ColorTemperature': return 'CTO'; case 'Zoom': return 'Z'; case 'Focus': return 'F';
    case 'ShutterStrobe': case 'StrobeSpeed': case 'StrobeDuration': return 'S';
    case 'WheelSlot': case 'WheelShake': case 'WheelRotation': case 'WheelSlotRotation': return /gobo/i.test(w)?((t==='WheelRotation'||t==='WheelSlotRotation')?'GR':'GB'):/prism/i.test(w)?'PR':'CW';
    case 'Iris': case 'IrisEffect': return 'I'; case 'Prism': case 'PrismRotation': return 'PR';
    case 'Fog': case 'FogOutput': case 'FogType': return 'H'; case 'Effect': case 'EffectSpeed': case 'EffectDuration': case 'EffectParameter': case 'SoundSensitivity': return 'FX';
    case 'Speed': case 'PanTiltSpeed': return 'SP'; case 'Maintenance': return 'CT';
    default: return chNameGuess(name);
  } }
function oflModeTokens(j,mode){
  const av=j.availableChannels||{}, fine={};
  for(const [nm,ch] of Object.entries(av)) (ch&&ch.fineChannelAliases||[]).forEach((a,i)=>{ fine[a]={b:nm,i}; });
  const tok=nm=>{ if(fine[nm]){ const b=tok(fine[nm].b); return b==='x'?'x':b.replace(/\d$/,'')+(fine[nm].i+2); }
    const ch=av[nm]; if(!ch) return chNameGuess(nm);
    const caps=ch.capability?[ch.capability]:(ch.capabilities||[]), cap=caps.find(c=>c&&c.type&&c.type!=='NoFunction')||caps[0];
    return oflCapToken(cap,nm); };
  return (mode.channels||[]).map(c=>c==null?'x':typeof c==='string'?tok(c):'x');
}
function gdtfAttrToken(a){ a=String(a||'');
  if(/^Dimmer$/i.test(a)) return 'D'; if(/^Pan$/i.test(a)) return 'P'; if(/^Tilt$/i.test(a)) return 'T';
  let m=a.match(/^ColorAdd_(\w+)/); if(m) return ({R:'R',G:'G',B:'B',W:'W',WW:'W',CW:'W',RY:'A',GY:'L',UV:'UV',C:'C',M:'M',Y:'Y'})[m[1]]||'x';
  m=a.match(/^ColorSub_(\w)/); if(m) return ({C:'C',M:'M',Y:'Y'})[m[1]]||'x';
  if(/^CT[OCB]/i.test(a)) return 'CTO'; if(/^Color\d/.test(a)) return 'CW'; if(/^Zoom/.test(a)) return 'Z'; if(/^Focus/.test(a)) return 'F'; if(/^(Shutter|Strobe)/.test(a)) return 'S';
  if(/^Gobo\d+(Pos)?(Rotate|WheelSpin|WheelAudio)|^Gobo\d+PosRotate/.test(a)) return 'GR'; if(/^Gobo/.test(a)) return 'GB'; if(/^Iris/.test(a)) return 'I'; if(/^Prism/.test(a)) return 'PR';
  if(/^Effects/.test(a)) return 'FX'; if(/^(Haze|Fog)/.test(a)) return 'H'; if(/^Fan/.test(a)) return 'FN'; if(/Speed|Time/.test(a)) return 'SP'; if(/^(Control|Reset|Lamp|Function|Fixture)/.test(a)) return 'CT';
  return 'x'; }
// OFL: pan/tilt aralığı, shutter kapalı değeri, renk tekeri renkleri
function oflDeg(s){ const m=String(s==null?'':s).match(/(-?\d+(?:\.\d+)?)\s*deg/); return m?+m[1]:null; }
function oflExtras(j,mode){
  const av=j.availableChannels||{}, chs=(mode.channels||[]).filter(c=>typeof c==='string'), fineOf={};
  for(const [n,c] of Object.entries(av)) (c&&c.fineChannelAliases||[]).forEach(a=>{ fineOf[a]=n; });
  const capsOf=n=>{ const c=av[n]; return c?(c.capability?[c.capability]:(c.capabilities||[])):[]; };
  let pr=null, tr=null, sc=null, cw=null;
  for(const n of chs){ if(fineOf[n]) continue; const caps=capsOf(n);
    for(const cap of caps){ if(!cap) continue;
      if(cap.type==='Pan'&&pr==null){ const a=oflDeg(cap.angleStart), b=oflDeg(cap.angleEnd); if(a!=null&&b!=null&&Math.abs(b-a)>=90) pr=Math.abs(b-a); }
      if(cap.type==='Tilt'&&tr==null){ const a=oflDeg(cap.angleStart), b=oflDeg(cap.angleEnd); if(a!=null&&b!=null&&Math.abs(b-a)>=45) tr=Math.abs(b-a); } }
    if(sc==null){ const cl=caps.find(c=>c&&c.type==='ShutterStrobe'&&c.shutterEffect==='Closed'&&Array.isArray(c.dmxRange)&&c.dmxRange[0]===0); if(cl) sc=cl.dmxRange[1]; }
    if(cw==null){ const ws=caps.filter(c=>c&&c.type==='WheelSlot'&&Array.isArray(c.dmxRange)); if(ws.length){ const wn=ws[0].wheel||n, wh=(j.wheels||{})[wn];
      if(wh&&Array.isArray(wh.slots)&&/colou?r/i.test(wn+' '+n)){ const fine=chs.some(x=>fineOf[x]===n), tab=[];
        for(const c of ws){ const k=c.slotNumber; if(!Number.isInteger(k)) continue; const sl=wh.slots[k-1]; if(!sl) continue;
          const hex=sl.type==='Open'?'ffffff':(Array.isArray(sl.colors)&&sl.colors[0]?String(sl.colors[0]).replace('#','').toLowerCase().slice(0,6):null); if(!hex||!/^[0-9a-f]{6}$/.test(hex)) continue;
          let [a,b]=c.dmxRange; if(fine){ a=a*256; b=b*256+255; } tab.push([a,b,hex]); }
        if(tab.length) cw=tab; } } }
  }
  const ex={}; if(sc!=null) ex.sc=sc; if(cw) ex.cw=cw; return {pr,tr,ex};
}
function oflBeam(j){ const l=j.physical&&j.physical.lens, d=l&&l.degreesMinMax; return Array.isArray(d)&&d.length===2&&d[1]>0?Math.round((d[0]+d[1])/2*10)/10:null; }

function guessType(s) {
  s = s.toLowerCase();
  if (/strobe|atomic|jdc/.test(s)) return 'strobe';
  if (/haz|fog|smoke/.test(s)) return 'hazer';
  if (/\bbar\b|batten|strip/.test(s)) return 'bar';
  if (/beam|sharpy/.test(s)) return 'beam';
  if (/wash|aura|spiider/.test(s)) return 'wash';
  if (/\bpar\b/.test(s)) return 'par';
  if (/fresnel/.test(s)) return 'fresnel';
  return 'spot';
}
function catType(c, name) {
  c = (c || '').toLowerCase();
  if (/strobe/.test(c)) return 'strobe';
  if (/haz|smoke|fog/.test(c)) return 'hazer';
  if (/blinder/.test(c)) return 'blinder';
  if (/bar/.test(c)) return 'bar';
  if (/color changer/.test(c)) return /bar|batten|strip/i.test(name) ? 'bar' : 'par';
  if (/dimmer/.test(c)) return 'profile';
  return guessType(name);
}
// Küçük ZIP okuyucu (ek paket gerektirmez)
function readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP okunamadı');
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  const read = name => {
    const f = files.get(name); const ln = buf.readUInt16LE(f.off + 26), lx = buf.readUInt16LE(f.off + 28);
    const data = buf.subarray(f.off + 30 + ln + lx, f.off + 30 + ln + lx + f.csize);
    return (f.method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  };
  return { files, read };
}
try {
  console.log('Open Fixture Library indiriliyor…');
  const res = await fetch(URL); if (!res.ok) throw new Error('HTTP ' + res.status);
  const zip = readZip(Buffer.from(await res.arrayBuffer()));
  const manName = [...zip.files.keys()].find(n => /(^|\/)fixtures\/manufacturers\.json$/.test(n));
  if (!manName) throw new Error('manufacturers.json bulunamadı');
  const base = manName.replace(/manufacturers\.json$/, '');
  const man = JSON.parse(zip.read(manName));
  const out = [];
  for (const name of zip.files.keys()) {
    if (!name.startsWith(base) || !name.endsWith('.json')) continue;
    const rel = name.slice(base.length).split('/'); if (rel.length !== 2) continue;
    let j; try { j = JSON.parse(zip.read(name)); } catch { continue; }
    if (!j || j.redirectTo || !j.name || !Array.isArray(j.modes)) continue;
    let pr = null, tr = null;
    const modes = j.modes.filter(m => Array.isArray(m.channels) && m.channels.length).map(m => {
      const x = oflExtras(j, m); pr = pr || x.pr; tr = tr || x.tr;
      const md = [String(m.name || m.shortName || 'Mod'), m.channels.length, oflModeTokens(j, m).join(',')];
      if (Object.keys(x.ex).length) md.push(x.ex); return md; });
    if (!modes.length) continue;
    const ph = j.physical || {}, e = { b: (man[rel[0]] && man[rel[0]].name) || rel[0], m: j.name, t: catType((j.categories || [])[0], j.name), modes };
    if (pr) e.pr = pr; if (tr) e.tr = tr; const ba = oflBeam(j); if (ba) e.ba = ba;
    if (Array.isArray(ph.dimensions)) e.dims = ph.dimensions; if (ph.power) e.w = ph.power; if (ph.weight) e.kg = ph.weight;
    out.push(e);
  }
  out.sort((a, b) => a.b.localeCompare(b.b) || a.m.localeCompare(b.m));
  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + '/ofl-library.js', '/* Kaynak: Open Fixture Library (open-fixture-library.org), MIT lisansı — ' + date + ' */\nwindow.OFL_LIB=' + JSON.stringify({ v: 2, date, lib: out }) + ';\n');
  // Her cihaza (telefon/tarayıcı dahil) yüklenebilen ayrı kütüphane dosyası
  writeFileSync('ofl-kutuphane.json', JSON.stringify({ kind: 'isik-plani-kutuphane', source: 'Open Fixture Library (open-fixture-library.org, MIT)', date, count: out.length,
    lib: out.map(e => { const r = { b: e.b, m: e.m, t: e.t, modes: e.modes }; if (e.pr) r.pr = e.pr; if (e.tr) r.tr = e.tr; if (e.ba) r.ba = e.ba; if (Array.isArray(e.dims) && e.dims.length >= 3) r.sz = [e.dims[0] / 1000, e.dims[2] / 1000, e.dims[1] / 1000]; return r; }) }));
  console.log(`${out.length} cihaz kaydedildi: ${outDir}/ofl-library.js ve ofl-kutuphane.json`);
} catch (e) {
  console.warn('Cihaz kütüphanesi indirilemedi (' + e.message + '). Program yerleşik kütüphaneyle çalışmaya devam eder.');
  process.exit(0);
}
