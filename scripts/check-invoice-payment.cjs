const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const method=process.env.INVOICE_METHOD||'ocean',base='https://testmedusa.365d4u.com',admin=JSON.parse(fs.readFileSync('.private/admin-access.json')),buyer=JSON.parse(fs.readFileSync('.private/paypal-buyer.json'));
 const context=await chromium.launchPersistentContext('.private/invoice-'+method+'-browser',{headless:true,viewport:{width:1440,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(url,body)=>{const r=await context.request[body===undefined?'get':'post'](base+url,{headers:{Origin:base},...(body===undefined?{}:{data:body})});const d=await r.json();if(!r.ok())throw new Error(url.split('?')[0]+' '+r.status()+': '+d.message);return d;};
 await api('/api/staff/login',{email:admin.email,password:admin.password});
 const file='.private/invoice-'+method+(process.env.INVOICE_TEST_TAG?'-'+process.env.INVOICE_TEST_TAG:'')+'-test.json';let invoice;
 if(fs.existsSync(file))invoice=JSON.parse(fs.readFileSync(file));else{
  await page.goto(base+'/invoices/new/');await page.locator('#workspace').waitFor({state:'visible'});await page.locator('[name=title]').fill(method==='ocean'?'Credit card sandbox invoice':'PayPal sandbox invoice');await page.locator('[name=unit_price]').fill('1.00');await page.locator('#create-invoice').click();await page.locator('#created-invoice input').waitFor({state:'visible'});
  const url=await page.locator('#created-invoice input').inputValue(),number=new URL(url).pathname.split('/')[2];invoice=(await api('/api/staff/invoices?search='+number)).invoices[0];fs.writeFileSync(file,JSON.stringify(invoice,null,2));
 }
 const key=new URL(invoice.payment_url).pathname.split('/').at(-1),endpoint='/api/invoices/'+invoice.display_id;
 await page.goto(invoice.payment_url,{waitUntil:'domcontentloaded'});
 if(!(await page.locator('#invoice-paid').count())){
  await page.locator('#billing_email').fill(buyer.email);await page.locator('#shipping_first_name').fill('Sandbox');await page.locator('#shipping_last_name').fill('Test');await page.locator('#shipping_address_1').fill('1 Main Street');await page.locator('#shipping_country').selectOption('US',{force:true});await page.locator('#shipping_state').selectOption('CA',{force:true});await page.locator('#shipping_city').fill('San Jose');await page.locator('#shipping_postcode').fill('95131');await page.locator('#shipping_phone').fill('2025550100');
  if(method==='ocean'){
   await page.locator('#payment_method_oceancreditcardonepage').check();const frame=page.frameLocator('#oceanpayment-iframe-card');await frame.locator('[name=card_number_temp]').waitFor({state:'visible',timeout:30000});assert.equal(await frame.locator('[name=card_name]').isVisible(),false);await frame.locator('[name=card_number_temp]').fill('4111111111111111');await frame.locator('[name=card_date]').fill('11/30');await frame.locator('[name=card_secureCode]').fill('123');
  }
  // Let the provider's resize message settle after scrolling the iframe into view.
  await page.locator('#place_order').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await page.locator('#place_order').click();
  try{await page.waitForURL(url=>url.hostname!==new URL(base).hostname,{timeout:25000})}catch{await page.screenshot({path:'.private/invoice-card-payment-failure.png',fullPage:true});console.log(JSON.stringify({invalid:await page.locator('#order_review :invalid').evaluateAll(es=>es.map(e=>e.id)),loading:await page.locator('#invoice-card-loading').textContent(),button_disabled:await page.locator('#place_order').isDisabled()}));throw new Error('Payment did not redirect: '+await page.locator('#invoice-payment-status').textContent())}
  if(method==='ocean'){
   assert.equal(new URL(page.url()).hostname,'test-secure.oceanpayment.com');await page.locator('input:visible').first().pressSequentially('111111',{delay:100});await page.getByText('确认',{exact:true}).click();
  }else{
   assert.equal(new URL(page.url()).hostname,'www.sandbox.paypal.com');
   await page.waitForTimeout(2000);const email=page.locator('input[type=email],input[name=login_email]').first();if(await email.isVisible()){await email.fill(buyer.email);const next=page.getByRole('button',{name:'Next',exact:true});if(await next.isVisible())await next.click();}
   const password=page.locator('input[type=password]').first();await password.waitFor({state:'visible',timeout:15000}).catch(()=>{});if(await password.isVisible()){await password.fill(buyer.password);await page.getByRole('button',{name:/^Log In$|^Log in$|^登录$/}).click();}
   const approve=page.getByRole('button',{name:/Complete Purchase|Pay Now|Agree.*Pay|Continue to Review Order/i}).first();try{await approve.waitFor({state:'visible',timeout:30000});await approve.click()}catch(e){fs.writeFileSync('.private/invoice-paypal-current-url.txt',page.url());await page.screenshot({path:'.private/invoice-paypal-flow.png'});console.log(JSON.stringify({buttons:await page.locator('button').allTextContents(),path:new URL(page.url()).pathname}));throw e}
  }
  await page.waitForURL(invoice.payment_url+'**',{timeout:45000});await page.locator('#invoice-paid').waitFor({state:'visible',timeout:30000});
 }
 const result=await api(endpoint+'/complete?key='+key,{});assert.equal(result.invoice.status,'paid');assert.equal(result.invoice.id,invoice.id);
 await Promise.all([api(endpoint+'/complete?key='+key,{}),api(endpoint+'/complete?key='+key,{})]);
 const again=await context.request.post(base+endpoint+'/payment?key='+key,{headers:{Origin:base},data:{provider_id:'pp_paypal_paypal'}});assert.equal(again.status(),400);
 const after=(await api('/api/staff/invoices?search='+invoice.display_id)).invoices[0];assert.equal(after.status,'paid');await page.screenshot({path:'.private/invoice-'+method+'-paid.png',fullPage:true});fs.writeFileSync('.private/invoice-'+method+'-verification.json',JSON.stringify({order_id:invoice.id,display_id:invoice.display_id,same_order_paid:true,repeat_completion_idempotent:true,second_payment_denied:true,admin_status:'paid',errors},null,2));console.log(JSON.stringify({method,display_id:invoice.display_id,status:'paid',errors}));await context.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
