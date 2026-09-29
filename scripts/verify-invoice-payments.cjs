const fs=require('fs'),assert=require('node:assert/strict'),{Client}=require('../apps/backend/node_modules/pg');
const env=Object.fromEntries(fs.readFileSync('apps/backend/.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
(async()=>{const base='https://testmedusa.365d4u.com',admin=JSON.parse(fs.readFileSync('.private/admin-access.json')),login=await fetch(base+'/auth/user/emailpass',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:admin.email,password:admin.password})}),{token}=await login.json();assert.ok(token);const db=new Client({connectionString:env.DATABASE_URL});await db.connect();const report=[];
 for(const method of ['ocean','paypal']){
  const invoice=JSON.parse(fs.readFileSync('.private/invoice-'+method+(process.env.INVOICE_TEST_TAG?'-'+process.env.INVOICE_TEST_TAG:'')+'-test.json')),get=async()=>(await(await fetch(base+'/admin/orders/'+invoice.id+'?fields=*payment_collections,*payment_collections.payments,*payment_collections.payments.captures',{headers:{Authorization:'Bearer '+token}})).json()).order;
  let order=await get();assert.equal(order.payment_status,'captured');assert.equal(order.payment_collections[0].amount,1);
  if(method==='ocean'){
   const session=order.payment_collections[0].payments[0].data.binding.session_id,receipt=(await db.query('SELECT payload FROM d4u_content_record WHERE key=$1',['ocean-receipt:'+session])).rows[0].payload;
   for(let i=0;i<2;i++){const r=await fetch(base+'/webhooks/oceanpayment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(receipt)});assert.equal(r.status,200);assert.equal(await r.text(),'receive-ok')}
   const tampered=await fetch(base+'/webhooks/oceanpayment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...receipt,order_amount:'0.01'})});assert.equal(tampered.status,400);order=await get();
  }
  const captures=order.payment_collections.flatMap(c=>c.payments.flatMap(p=>p.captures));assert.equal(captures.length,1);assert.equal(captures[0].amount,1);
  const tx=(await db.query('SELECT amount,reference,reference_id FROM order_transaction WHERE order_id=$1 AND deleted_at IS NULL',[order.id])).rows;assert.equal(tx.length,1);assert.equal(Number(tx[0].amount),1);
  report.push({method,display_id:order.display_id,payment_status:order.payment_status,captured_amount:1,captures:1,order_transactions:1,...(method==='ocean'?{duplicate_callbacks:2,tampered_callback_rejected:true}:{})});
 }
 await db.end();fs.writeFileSync('.private/invoice-payment-reconciliation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
