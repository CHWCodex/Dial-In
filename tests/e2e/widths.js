const { BASE_URL } = require('./_guard');   // refuses to run against the live site or database
const {chromium}=require('playwright');const fs=require('fs');const OUT=process.argv[2];fs.mkdirSync(OUT,{recursive:true});
const CHECK=()=>{const W=innerWidth,out=[];if(document.documentElement.scrollWidth>W+1)out.push('sideways scroll '+document.documentElement.scrollWidth);
 const vis=el=>{const cs=getComputedStyle(el);return cs.display!=='none'&&cs.visibility!=='hidden'&&!el.closest('dialog:not([open]),.snow,[hidden],details:not([open])>.fold-b,.sr-only')};
 for(const el of document.querySelectorAll('#app *, .tabbar *, .topbar *')){if(!vis(el))continue;const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
  if(r.right>W+2&&!el.closest('.tabs'))out.push('off edge: '+(el.className||el.tagName)+' "'+(el.innerText||'').slice(0,24)+'"');}
 const t=[...document.querySelectorAll('#app button:not(.link), .navtab')].filter(e=>vis(e)&&e.offsetParent).filter(e=>{const r=e.getBoundingClientRect();return r.height<40||r.width<40});
 if(t.length)out.push('small tap targets: '+t.slice(0,4).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,14)+' '+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)).join(', '));
 return [...new Set(out)].slice(0,6)};
(async()=>{const b=await chromium.launch();
for(const [w,h] of [[320,568],[360,740],[375,667],[390,844],[414,896],[430,932],[768,1024],[1024,768],[1440,900],[1920,1080]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1,isMobile:w<700,hasTouch:w<700});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.route(/supabase\.co|cloudflareinsights/,r=>r.abort());await p.goto('' + BASE_URL + '');await p.waitForTimeout(1200);
 const res=[];
 const first=await p.evaluate(()=>{const b=document.querySelector('.dc-go');const r=b.getBoundingClientRect();return {playBottom:Math.round(r.bottom),vh:innerHeight,tabTop:Math.round(document.querySelector('.tabbar').getBoundingClientRect().top)}});
 res.push(`Play button bottom ${first.playBottom}px, bottom bar starts ${first.tabTop}px → ${first.playBottom<=first.tabTop?'visible without scrolling':'NEEDS SCROLL'}`);
 for(const v of ['home','modes','board','settings','stats','facthome','battle','endless','archive','play','results','fcplay']){await p.evaluate(v=>{document.querySelectorAll("dialog[open]").forEach(d=>d.close());if(v==="play"){S.player.name=S.player.name||"Tester";startDaily();}else if(v==="results"){const d=getDay(App.today,true);d.answers=d.ids.map(()=>({g:5,s:200}));d.done=true;d.pin={done:true,bonus:0};save();go("results");}else if(v==="fcplay"){try{go("facthome");document.querySelector("[data-act^=fc]")?.click()}catch(e){}}else go(v);scrollTo(0,0)},v);await p.waitForTimeout(300);
   if(v==='settings')await p.evaluate(()=>document.querySelectorAll('details.fold').forEach(d=>d.open=true));
   const c=await p.evaluate(CHECK);if(c.length)res.push(v+': '+c.join(' ; '));
   if(['home','settings','play','results'].includes(v))await p.screenshot({path:`${OUT}/w${w}-${v}.png`,fullPage:v==='settings'});}
 console.log(`== ${w}px`);console.log(res.join('\n'));if(errs.length)console.log('ERRORS',errs);await ctx.close();}
await b.close()})();
