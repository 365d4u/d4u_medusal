const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const base='https://testmedusa.365d4u.com',browser=await chromium.launch({headless:true});
 const list=await (await fetch(base+'/custom-api.php?action=products&per_page=1')).json();
 const routes=['/','/full-custom/','/semi-custom/','/ready-to-ship/','/list/','/customer-says/','/my-account/',list.products[0].url],report=[];
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 for(const [i,route] of routes.entries()){
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+route,{waitUntil:'domcontentloaded'});await page.waitForTimeout(2200);
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+4&&getComputedStyle(e).position!=='fixed').slice(0,5).map(e=>({tag:e.tagName,class:e.className}))}));
  report.push({route,...dimensions,errors});if(i===0||i===routes.length-1)await page.screenshot({path:'.private/mobile-'+(i===0?'home':'product')+'.png'});
  await page.close();
 }
 fs.writeFileSync('.private/mobile-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
