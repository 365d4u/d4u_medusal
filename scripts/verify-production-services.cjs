// Read-only connectivity checks. Never emits a business notification or charge.
const fs=require('fs'),assert=require('node:assert/strict'),root='/data/d4u_medusal';
const {Client}=require(root+'/apps/backend/node_modules/pg');
(async()=>{
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const report={};
 try{
  report.native_orders=(await db.query('SELECT count(*)::int n FROM "order" WHERE deleted_at IS NULL')).rows[0].n;
  report.notification_tasks=(await db.query("SELECT count(*)::int n FROM d4u_content_record WHERE key LIKE 'paid-notification:%' AND deleted_at IS NULL")).rows[0].n;
  const sequence=(await db.query("SELECT pg_get_serial_sequence('\"order\"','display_id') seq")).rows[0].seq;assert.match(sequence,/^[a-z_]+\.[a-z_]+$/);
  const seq=(await db.query('SELECT last_value,is_called FROM '+sequence)).rows[0];report.next_order_number=Number(seq.last_value)+(seq.is_called?1:0);
  report.providers=(await db.query('SELECT id FROM payment_provider WHERE is_enabled=true')).rows.map(r=>r.id);
  assert.ok(!report.providers.some(p=>p.includes('applepay')));
 }finally{await db.end()}
 const mail=require(root+'/apps/backend/node_modules/nodemailer').createTransport({host:process.env.PAID_SMTP_HOST,port:Number(process.env.PAID_SMTP_PORT||465),secure:process.env.PAID_SMTP_SECURE!=='false',requireTLS:true,auth:{user:process.env.PAID_SMTP_USER,pass:process.env.PAID_SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000});
 try{report.smtp_authentication=await mail.verify()}finally{mail.close()}
 const queue=new URL('/api/queues/%2F/order_paid',process.env.PAID_RABBIT_PUBLISH_URL);
 const response=await fetch(queue,{headers:{Authorization:'Basic '+Buffer.from(process.env.PAID_RABBIT_USER+':'+process.env.PAID_RABBIT_PASSWORD).toString('base64')},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);const result=await response.json();assert.equal(result.name,'order_paid');report.production_queue_exists=true;
 fs.writeFileSync(root+'/shared/production-readiness-verification.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.message);process.exit(1)});
