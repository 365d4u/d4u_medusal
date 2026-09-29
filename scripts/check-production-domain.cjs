// Read-only publication check: authenticates staff but creates no orders/payments.
const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const base='https://medusa.365d4u.com',credentials=JSON.parse(fs.readFileSync('.private/production-deployment.json'));
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:375,height:667}});
 const report={domain:base},oldDomainRequests=[];
 context.on('request',request=>{if(new URL(request.url()).hostname==='www.custom365d.com')oldDomainRequests.push(new URL(request.url()).pathname)});
 try{
  const redirect=await context.request.get('http://medusa.365d4u.com/invoices/new/',{maxRedirects:0});assert.equal(redirect.status(),301);assert.equal(redirect.headers().location,base+'/invoices/new/');report.http_redirect=true;
  for(const path of ['/','/health','/app/','/invoices/new/'])assert.equal((await context.request.get(base+path)).status(),200,path);
  const config=await (await context.request.get(base+'/api/config')).json();assert.equal(config.checkout_enabled,true);assert.equal(config.applepay_enabled,false);assert.equal(config.ocean_sandbox,false);assert.equal(config.payment_policy.ocean.threshold,1000);assert.ok(config.paypal_client_id);report.production_payment_configuration=true;
  const login=await context.request.post(base+'/auth/user/emailpass',{headers:{Origin:base},data:{email:credentials.admin_email||'admin@365d4u.com',password:credentials.admin_password}});assert.equal(login.status(),200);assert.equal(login.headers()['access-control-allow-origin'],base);
  const invoicesResponse=await context.request.get(base+'/admin/invoices',{headers:{Authorization:'Bearer '+(await login.json()).token}});assert.equal(invoicesResponse.status(),200);
  const invoices=(await invoicesResponse.json()).invoices;assert.ok(Array.isArray(invoices));
  for(const invoice of invoices)if(invoice.payment_url)assert.equal(new URL(invoice.payment_url).origin,base);
  report.invoice_links_checked=invoices.filter(invoice=>invoice.payment_url).length;report.admin_login_and_cors=true;
  const page=await context.newPage();await page.goto(base+'/invoices/new/',{waitUntil:'domcontentloaded'});await page.locator('#login-panel').waitFor();
  await page.locator('input[name=email]').fill(credentials.admin_email||'admin@365d4u.com');await page.locator('input[name=password]').fill(credentials.admin_password);await page.locator('#staff-login button').click();await page.locator('#workspace').waitFor();
  assert.equal(await page.locator('#invoice-title').inputValue(),'Custom Piece');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.private/production-invoice-mobile.png'});
  await page.locator('[data-tab=list]').click();await page.locator('#list-panel').waitFor();assert.equal(await page.locator('th').allTextContents().then(t=>t.includes('Customer')),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);report.mobile_invoice_builder_and_list=true;
  await page.goto(base+'/app/',{waitUntil:'domcontentloaded'});await page.getByPlaceholder('Email', {exact:false}).waitFor({timeout:20000});report.admin_app_loaded=true;
  assert.deepEqual(oldDomainRequests,[]);report.no_custom_domain_browser_requests=true;
  fs.writeFileSync('.private/production-domain-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exit(1)});

