const {chromium,request}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict'),{randomUUID}=require('crypto');
(async()=>{
 const base='https://testmedusa.365d4u.com',admin=JSON.parse(fs.readFileSync('.private/admin-access.json')),ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
 assert.equal((await ctx.get('/api/staff/invoices')).status(),401);
 const login=await ctx.post('/api/staff/login',{data:{email:admin.email,password:admin.password}});assert.equal(login.status(),200,await login.text());
 const fixture='.private/invoice-sample-request.json';let body;if(fs.existsSync(fixture))body=JSON.parse(fs.readFileSync(fixture));else{body={request_id:randomUUID(),items:[{title:'$1.00 fee',quantity:1,unit_price:'1.00'}],note:'付款页面样式验收示例，待付款。'};fs.writeFileSync(fixture,JSON.stringify(body));}
 const responses=await Promise.all([ctx.post('/api/staff/invoices',{data:body}),ctx.post('/api/staff/invoices',{data:body})]);const invoices=[];
 for(const r of responses){const d=await r.json();assert.equal(r.status(),201,JSON.stringify(d));invoices.push(d.invoice);}
 assert.equal(invoices[0].id,invoices[1].id);const invoice=invoices[0];assert.ok(invoice.display_id>=200000);assert.equal(invoice.amount,1);fs.writeFileSync('.private/invoice-sample.json',JSON.stringify(invoice,null,2));
 const key=new URL(invoice.payment_url).pathname.split('/').at(-1);assert.equal((await ctx.get('/api/invoices/'+invoice.display_id+'?key='+'a'.repeat(64))).status(),404);
 const noKey=await ctx.get('/api/invoices/'+invoice.display_id);assert.equal(noKey.status(),404);
 const data=await (await ctx.get('/api/invoices/'+invoice.display_id+'?key='+key)).json();assert.equal(data.invoice.note,undefined);
 const changed=await ctx.post('/api/staff/invoices',{data:{...body,items:[{title:'Changed',unit_price:'2.00',quantity:1}]}});assert.equal(changed.status(),400);
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({storageState:await ctx.storageState(),viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(invoice.payment_url,{waitUntil:'domcontentloaded'});await page.locator('.base_delivey_top_img img').evaluateAll(async images=>await Promise.all(images.map(i=>i.decode().catch(()=>{}))));await page.screenshot({path:'.private/invoice-desktop.png',fullPage:true});
 assert.equal(await page.locator('.order_h4').textContent(),'Order Number : '+invoice.display_id);assert.equal(await page.locator('#order_review .invoice-line').count(),1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.private/invoice-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.goto(base+'/invoices/new/',{waitUntil:'domcontentloaded'});await page.locator('#workspace').waitFor({state:'visible'});await page.screenshot({path:'.private/invoice-builder-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({sample_order:invoice.display_id,concurrent_create_idempotent:true,anonymous_staff_denied:true,invalid_payment_keys_denied:true,changed_idempotency_request_denied:true,private_notes_hidden:true,desktop_mobile_rendered:true,errors}));
 await browser.close();await ctx.dispose();
})().catch(e=>{console.error(e.message);process.exit(1)});
