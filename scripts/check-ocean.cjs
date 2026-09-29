const {chromium}=require('playwright'),fs=require('fs');
(async()=>{
 const base='https://testmedusa.365d4u.com',browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const api=async(url,data)=>{const r=await context.request[data===undefined?'get':'post'](base+url,{headers:{Origin:base},...(data===undefined?{}:{data})});const d=await r.json();if(!r.ok())throw new Error(url+' '+r.status()+': '+d.message);return d};
 const list=await api('/custom-api.php?action=products&per_page=30');let variant;
 for(const item of list.products){const {product}=await api('/api/products/'+item.url.split('/').filter(Boolean).at(-1));variant=product.variants.find(v=>v.calculated_price?.calculated_amount>0&&!v.manage_inventory&&!v.metadata?.requires_quote&&v.metadata?.source_stock_status!=='outofstock');if(variant)break}
 const {cart}=await api('/api/cart/items',{variant_id:variant.id,quantity:1});await api('/api/cart/address',{email:'sandbox-test@example.com',first_name:'Sandbox',last_name:'Test',address_1:'1 Main Street',city:'San Jose',province:'CA',postal_code:'95131',country_code:'us',phone:'2025550100'});
 await page.goto(base+'/checkout/',{waitUntil:'domcontentloaded'});await page.locator('[name=country_code]').selectOption('us');await page.getByRole('button',{name:'Continue to delivery'}).click();
 try{await page.locator('[name=shipping]').first().check({timeout:15000})}catch(e){await page.screenshot({path:'.private/ocean-check.png'});console.log(JSON.stringify({message:await page.locator('#checkout-message').allTextContents(),invalid:await page.locator('#checkout-address :invalid').evaluateAll(list=>list.map(e=>({name:e.name,message:e.validationMessage}))),errors}));throw e}
 await page.getByRole('button',{name:'Credit or debit card',exact:true}).click();
 const iframe=page.frameLocator('#oceanpayment-iframe-card');await iframe.locator('input:visible').first().waitFor({state:'visible',timeout:30000});
 const inputs=await iframe.locator('input').evaluateAll(list=>list.map(e=>({type:e.type,id:e.id,name:e.name,placeholder:e.placeholder})));console.log(JSON.stringify({iframe_ready:true,inputs,errors}));
 if(process.env.OCEAN_PAY==='true'){
  await iframe.locator('[name=card_name]').fill('Sandbox Test');
  await iframe.locator('[name=card_number_temp]').fill('4111111111111111');
  await iframe.locator('[name=card_date]').fill('11/30');
  await iframe.locator('[name=card_secureCode]').fill('123');
  await page.getByRole('button',{name:'Pay securely',exact:true}).click();await page.waitForTimeout(10000);
  if(new URL(page.url()).pathname==='/paymentpages/web/testbank.html'){
   fs.writeFileSync('.private/ocean-3ds.html',await page.content());
   await page.locator('input:visible').first().pressSequentially(process.env.OCEAN_DECLINE==='true'?'000000':'111111',{delay:100});
   await page.getByText('确认',{exact:true}).click();await page.waitForURL(base+'/**',{timeout:45000});
   await page.waitForTimeout(6000);
  }
  fs.writeFileSync('.private/ocean-return-url.txt',page.url());
  const status=await page.locator('#payment-status,#checkout-message').allTextContents();console.log(JSON.stringify({path:new URL(page.url()).pathname,status,errors}));
  const complete=await context.request.post(base+'/api/cart/complete',{headers:{Origin:base},data:{}});const result=await complete.json();
  fs.writeFileSync(process.env.OCEAN_DECLINE==='true'?'.private/ocean-decline-result.json':'.private/ocean-result.json',JSON.stringify({cart_id:cart.id,http_status:complete.status(),result},null,2));
  console.log(JSON.stringify({completion_status:complete.status(),type:result.type,order_id:result.order?.id,error:result.error?.message||result.message}));
  if(process.env.OCEAN_DECLINE!=='true'&&result.type!=='order')throw new Error('Oceanpayment did not complete the order');
  if(process.env.OCEAN_DECLINE==='true'&&result.type==='order')throw new Error('Declined payment must not create an order');
 }
 await page.screenshot({path:'.private/ocean-check.png'});await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
