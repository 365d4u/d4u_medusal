const {request}=require('playwright');const fs=require('fs');
(async()=>{
 const base=process.env.CHECK_URL||'https://testmedusa.365d4u.com';const ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}}),report=[];
 async function api(url,data){const r=await ctx[data===undefined?'get':'post'](url,data===undefined?{}:{data});const d=await r.json();report.push({url,status:r.status()});if(!r.ok())throw new Error(url+' '+r.status()+': '+(d.message||d.error));return d}
 const list=await api('/custom-api.php?action=products&per_page=30');let product,variant;
 for(const entry of list.products){const p=(await api('/api/products/'+entry.url.split('/').filter(Boolean).at(-1))).product;const v=p.variants.find(v=>v.calculated_price&&v.calculated_price.calculated_amount>0&&!v.manage_inventory&&!v.metadata?.requires_quote&&v.metadata?.source_stock_status!=='outofstock');if(v){product=p;variant=v;break}}
 if(!variant)throw new Error('No eligible test variant');
 await api('/api/cart/items',{variant_id:variant.id,quantity:1});
 await api('/api/cart/address',{email:'medusa-checkout-test@example.invalid',first_name:'Sandbox',last_name:'Test',address_1:'1 Main Street',city:'San Jose',province:'CA',postal_code:'95131',country_code:'us',phone:'2025550100'});
 const {shipping_options}=await api('/api/cart/shipping');if(!shipping_options.length)throw new Error('No US shipping option');
 await api('/api/cart/shipping',{option_id:shipping_options[0].id});
 for(const provider_id of ['pp_oceanpayment_oceanpayment','pp_paypal_paypal']){
  const result=await api('/api/cart/payment',{provider_id});const session=result.payment_collection.payment_sessions.find(s=>s.provider_id===provider_id);
  if(!session)throw new Error('Session missing');
  report.push({provider_id,status:session.status,has_redirect:!!session.data.approval_url,has_signed_fields:!!session.data.fields?.signValue});
 }
 const pending=await ctx.post('/api/cart/complete',{data:{}});const result=await pending.json();if(result.type==='order')throw new Error('Unpaid session created an order');report.push({unpaid_completion_rejected:true,status:pending.status()});
 fs.writeFileSync('.private/commerce-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await ctx.dispose();
})().catch(e=>{console.error(e.message);process.exit(1)});
