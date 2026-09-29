// Application regression test in an isolated headless browser; never authorizes payment.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
 const browser=await chromium.launch({headless:true});
 const origin=process.env.PARITY_ORIGIN||'https://testmedusa.365d4u.com';
 const dir=path.resolve('.private/storefront-parity');fs.mkdirSync(dir,{recursive:true});
 const report=[];
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message)});
  page.on('response',r=>{if(r.status()>=400&&/woff|\.css/.test(r.url()))errors.push(r.status()+' '+r.url())});
  await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.says-list .review-card').first().waitFor({timeout:45000});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(dir,`home-${width}.png`),fullPage:true});
  report.push({width,page:'home',...await page.evaluate(()=>({font:getComputedStyle(document.body).fontFamily,fonts:[...document.fonts].filter(f=>f.family.includes('DM')).map(f=>({weight:f.weight,status:f.status})),overflow:document.documentElement.scrollWidth>innerWidth,fresh:[...document.querySelectorAll('#new-products-container a,.fresh-drops a')].map(a=>a.textContent.trim()),reviews:[...document.querySelectorAll('.says-list .review-card')].slice(0,2).map(x=>({width:x.offsetWidth,height:x.offsetHeight,media:x.querySelector('img,video')?.tagName}))})),errors:[...errors]});
  const fontOk=await page.evaluate(()=>[...document.fonts].filter(f=>f.family.includes('DM')&&['400','500','600','700'].includes(f.weight)&&f.style==='normal').every(f=>f.status!=='error'));
  assert.ok(fontOk,'DM Sans must load');
  const fresh=await page.request.get(origin+'/custom-api.php?action=products_by_date&context=d365_home_fresh_drops');
  const freshProducts=(await fresh.json()).data.products;assert.equal(freshProducts.length,12);assert.ok(freshProducts.every(p=>!p.is_ready_to_ship));
  await page.goto(origin+'/product/1-5-inch-iced-hamsa-hand-pendant/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#product-form').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.match(await page.locator('h1').innerText(),/Hamsa/);assert.match(await page.locator('#variant-price').innerText(),/159/);assert.match(await page.locator('#variant-price del').innerText(),/799/);
  for(const select of await page.locator('#product-form select').all()){
   const values=await select.locator('option').evaluateAll(options=>options.map(o=>o.value));
   await select.selectOption(values.includes('brassmoissanites')?'brassmoissanites':values.includes('full-payment')?'full-payment':values.includes('14k-gold-color')?'14k-gold-color':values.find(Boolean));
  }
  assert.match(await page.locator('#variant-price').innerText(),/159/);
  await page.locator('[data-product-tab="shipping"]').click();assert.ok(await page.locator('#panel-shipping').isVisible());
  await page.locator('#gallery-main').evaluate(img=>img.decode());
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(dir,`product-${width}.png`),fullPage:true});
  report.push({width,page:'product',text:await page.locator('.d4u-product-info').innerText(),errors:[...errors]});
  await page.locator('#add-to-bag').evaluate(el=>el.scrollIntoView({block:'center'}));await page.locator('#add-to-bag').click();await page.locator('#d4u-cart-drawer[open]').waitFor();
  assert.match(await page.locator('#d4u-cart-drawer').innerText(),/159/);
  await page.locator('#d4u-cart-drawer .d4u-button').click();await page.locator('#payment-options button').first().waitFor();
  assert.ok(await page.locator('.d4u-checkout-item img').count());assert.match(await page.locator('.d4u-checkout-items').innerText(),/full payment/i);
  assert.ok(await page.locator('[data-provider="pp_paypal_paypal"]').isVisible());assert.ok(await page.locator('[data-provider="pp_oceanpayment-applepay_oceanpayment"]').isVisible());
  const fields={email:'parity-check@example.invalid',first_name:'Parity',last_name:'Check',address_1:'123 Test Street',city:'Los Angeles',province:'CA',postal_code:'90001',phone:'+12025550199'};
  for(const [name,value] of Object.entries(fields))await page.locator(`#checkout-address [name="${name}"]`).fill(value);
  await page.locator('#checkout-address [name="country_code"]').selectOption('us');await page.locator('#checkout-address button').click();
  await page.waitForFunction(()=>!document.querySelector('[data-provider="pp_paypal_paypal"]')?.disabled,{},{timeout:45000});
  assert.ok(await page.locator('#shipping-options input:checked').count());
  assert.equal(await page.locator('[data-line-total]').first().innerText(),'$159.00');
  const overflowing=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>({tag:e.tagName,css:e.className,right:e.getBoundingClientRect().right})));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Checkout ${width}px must fit the viewport: ${JSON.stringify(overflowing)}`);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(dir,`checkout-${width}.png`),fullPage:true});
  report.push({width,page:'checkout',total:await page.locator('#checkout-total').innerText(),paymentMethods:await page.locator('#payment-options').innerText(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors:[...errors]});
  await page.goto(origin+'/cart/',{waitUntil:'domcontentloaded'});
  const colors=await page.locator('a.d4u-button').first().evaluate(el=>({text:el.textContent,color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.notEqual(colors.color,colors.background);assert.match(colors.text,/Proceed to checkout/);
  report.push({width,page:'cart',colors});
  await page.close();
 }
 fs.writeFileSync(path.join(dir,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 await browser.close();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
