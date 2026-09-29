// Creates test carts and unapproved sandbox sessions only. Never completes payment.
const {request}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const base='https://testmedusa.365d4u.com';
 const report=[];
 for(const mode of ['full-payment','deposit','over-quota']){
  const ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
  async function api(url,data){const r=await ctx[data===undefined?'get':'post'](url,data===undefined?{}:{data});const result=await r.json();if(!r.ok())throw Error(url+': '+r.status()+' '+(result.message||result.error));return result}
  assert.equal((await api('/api/config')).ocean_sandbox,true);
  const {product}=await api('/api/products/1-5-inch-iced-hamsa-hand-pendant');
  const variant=product.variants.find(v=>v.title.includes('brassmoissanites')&&v.title.includes(mode==='deposit'?'deposit':'full-payment')&&v.title.includes('14k-gold-color'));
  assert.ok(variant);
  const quantity=mode==='over-quota'?Number(product.metadata.legacy.seckill.total)+1:1;
  const {cart:initial}=await api('/api/cart/items',{variant_id:variant.id,quantity});
  assert.equal(Number(initial.items[0].unit_price),mode==='deposit'?100:159);
  await api('/api/cart/address',{email:'parity-check@example.invalid',first_name:'Parity',last_name:'Check',address_1:'123 Test Street',city:'Los Angeles',province:'CA',postal_code:'90001',country_code:'us',phone:'+12025550199'});
  const {shipping_options}=await api('/api/cart/shipping');assert.ok(shipping_options.length);
  const {cart}=await api('/api/cart/shipping',{option_id:shipping_options[0].id});
  if(mode==='over-quota'){
   const r=await ctx.post('/api/cart/payment',{data:{provider_id:'pp_paypal_paypal'}});
   const error=await r.json();assert.equal(r.status(),400);assert.match(error.message,/remaining special offer/i);
   report.push({mode,quantity,rejected_before_provider:true});
  }else{
   for(const provider_id of ['pp_paypal_paypal','pp_oceanpayment_oceanpayment','pp_oceanpayment-applepay_oceanpayment']){
    const data=await api('/api/cart/payment',{provider_id});
    const session=data.payment_collection.payment_sessions.find(p=>p.provider_id===provider_id);
    assert.equal(session.status,'pending');
    if(provider_id.includes('paypal')){assert.equal(new URL(session.data.approval_url).hostname,'www.sandbox.paypal.com');assert.equal(Number(session.data.binding.amount),Number(cart.total))}
    else {assert.equal(session.data.sandbox,true);assert.equal(Number(session.data.fields.order_amount),Number(cart.total));assert.ok(session.data.fields.signValue)}
    report.push({mode,unit_price:cart.items[0].unit_price,quantity,provider_id,sandbox:true,amount:cart.total,status:session.status});
   }
  }
  await ctx.dispose();
 }
 fs.writeFileSync('.private/storefront-parity/catalog-checkout-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exit(1)});
