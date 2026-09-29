const fs=require('fs'),assert=require('node:assert/strict');
const {Client}=require('../apps/backend/node_modules/pg');
const env=Object.fromEntries(fs.readFileSync('apps/backend/.env','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
(async()=>{
 const base='https://testmedusa.365d4u.com',admin=JSON.parse(fs.readFileSync('.private/admin-access.json'));
 const login=await fetch(base+'/auth/user/emailpass',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:admin.email,password:admin.password})});const {token}=await login.json();assert.ok(token);
 const readOrder=async id=>(await (await fetch(base+'/admin/orders/'+id+'?fields=*payment_collections,*payment_collections.payments,*payment_collections.payments.captures',{headers:{Authorization:'Bearer '+token}})).json()).order;
 const result=JSON.parse(fs.readFileSync('.private/ocean-result.json')),id=result.result.order.id,order=await readOrder(id);
 assert.equal(order.payment_status,'captured');const payment=order.payment_collections[0].payments[0],session=payment.data.binding.session_id;
 const db=new Client({connectionString:env.DATABASE_URL});await db.connect();
 const {rows}=await db.query('SELECT payload FROM d4u_content_record WHERE key=$1 AND deleted_at IS NULL',['ocean-receipt:'+session]);await db.end();
 assert.equal(rows[0].payload.payment_status,'1');
 const post=payload=>fetch(base+'/webhooks/oceanpayment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 for(let i=0;i<2;i++){const response=await post(rows[0].payload);assert.equal(response.status,200);assert.equal(await response.text(),'receive-ok');}
 const rejected=await post({...rows[0].payload,order_amount:'0.01'});assert.equal(rejected.status,400);
 const updated=await readOrder(id),collection=updated.payment_collections[0];
 assert.equal(collection.payments.flatMap(p=>p.captures).length,1);assert.equal(collection.captured_amount,collection.amount);
 const report={order_id:id,display_id:updated.display_id,payment_status:updated.payment_status,amount:collection.amount,captured_amount:collection.captured_amount,duplicate_callbacks:2,captures:1,tampered_callback_rejected:true};
 fs.writeFileSync('.private/ocean-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
