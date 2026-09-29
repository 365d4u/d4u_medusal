const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
 const base=process.env.CHECK_URL||'http://localhost:8100';
 const browser=await chromium.launch({headless:true});
 const paths=Object.keys(JSON.parse(fs.readFileSync('apps/storefront/templates/routes.json','utf8')));
 const results=[];
 async function worker(){for(let route;route=paths.shift();){const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],failures=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(base))failures.push({status:r.status(),url:r.url().slice(base.length)})});
   try{const response=await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(2200);results.push({route,status:response.status(),errors,failures,products:await page.locator('a[href*="/product/"]').count()});}
   catch(e){results.push({route,error:e.message})}finally{await page.close()}
 }}
 await Promise.all([worker(),worker(),worker()]);await browser.close();fs.writeFileSync('.private/page-check.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({checked:results.length,issues:results.filter(r=>r.error||r.errors?.length||r.failures?.length)}));
})().catch(e=>{console.error(e);process.exit(1)});
