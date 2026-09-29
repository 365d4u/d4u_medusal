const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const base='https://testmedusa.365d4u.com',buyer=JSON.parse(fs.readFileSync('.private/paypal-buyer.json'));
 const context=await chromium.launchPersistentContext('.private/paypal-browser',{headless:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 const api=async(url,body)=>{const r=await context.request[body===undefined?'get':'post'](base+url,{headers:{Origin:base},...(body===undefined?{}:{data:body})});const d=await r.json();if(!r.ok())throw new Error(url+' '+r.status()+': '+d.message);return d};
 const stage=process.env.PAYPAL_STAGE||'begin';
 if(stage==='begin'){
  const list=await api('/custom-api.php?action=products&per_page=30');let v;
  for(const entry of list.products){const {product}=await api('/api/products/'+entry.url.split('/').filter(Boolean).at(-1));v=product.variants.find(v=>v.calculated_price&&v.calculated_price.calculated_amount>0&&!v.manage_inventory&&!v.metadata?.requires_quote&&v.metadata?.source_stock_status!=='outofstock');if(v)break}
  await api('/api/cart/items',{variant_id:v.id,quantity:1});
  await api('/api/cart/address',{email:buyer.email,first_name:'Sandbox',last_name:'Test',address_1:'1 Main Street',city:'San Jose',province:'CA',postal_code:'95131',country_code:'us',phone:'2025550100'});
  const shipping=await api('/api/cart/shipping');await api('/api/cart/shipping',{option_id:shipping.shipping_options[0].id});
  const result=await api('/api/cart/payment',{provider_id:'pp_paypal_paypal'});
  const url=result.payment_collection.payment_sessions.find(s=>s.provider_id==='pp_paypal_paypal').data.approval_url;
  if(new URL(url).hostname!=='www.sandbox.paypal.com')throw new Error('Refusing a non-sandbox payment');
  await page.goto(url,{waitUntil:'domcontentloaded'});
 }else{
  const url=fs.readFileSync('.private/paypal-current-url.txt','utf8');await page.goto(url,{waitUntil:'domcontentloaded'});
 }
 await page.waitForTimeout(2000);
 if(['login','pay'].includes(stage)){
  const email=page.locator('input[type=email],input[name=login_email]').first();if(await email.isVisible()){await email.fill(buyer.email);const next=page.getByRole('button',{name:'Next',exact:true});if(await next.isVisible())await next.click();}
  const password=page.locator('input[type=password]').first();await password.waitFor({state:'visible',timeout:20000});await password.fill(buyer.password);await page.getByRole('button',{name:/^Log In$|^Log in$|^登录$/}).click();await page.waitForTimeout(6000);
 }
 if(['approve','pay'].includes(stage)){
  const button=page.getByRole('button',{name:/Complete Purchase|Pay Now|Agree.*Pay|Continue to Review Order/i}).first();await button.waitFor({state:'visible',timeout:20000});await button.click();await page.waitForTimeout(6000);
 }
 if(['complete','pay'].includes(stage)){
  const result=await api('/api/cart/complete',{});fs.writeFileSync('.private/paypal-result.json',JSON.stringify(result));console.log(JSON.stringify({type:result.type,order_id:result.order?.id,display_id:result.order?.display_id,status:result.order?.status,payment_status:result.order?.payment_status}));
 }
 fs.writeFileSync('.private/paypal-current-url.txt',page.url());await page.screenshot({path:'.private/paypal-check.png'});
 console.log(JSON.stringify({stage,host:new URL(page.url()).hostname,path:new URL(page.url()).pathname,buttons:await page.locator('button').allTextContents(),inputs:await page.locator('input').evaluateAll(list=>list.map(e=>({type:e.type,name:e.name,placeholder:e.placeholder})))}));
 await context.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
