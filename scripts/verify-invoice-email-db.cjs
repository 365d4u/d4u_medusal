// Real PostgreSQL outbox and audit checks; transaction always rolls back and
// injected delivery never contacts SMTP or any external recipient.
require('dotenv').config({path:'../../.env',quiet:true})
const assert=require('assert/strict'),{Client}=require('pg'),{randomUUID}=require('crypto')
const {database}=require('./src/modules/payment-shared/security'),{enqueueInvoiceEmail,drainInvoiceEmails}=require('./src/lib/invoice-email')
;(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();const pool=database(process.env.DATABASE_URL),saved=pool.query;pool.query=db.query.bind(db)
try{
 await db.query('BEGIN');process.env.INVOICE_EMAIL_ENABLED='true'
 const suffix=randomUUID(),number='987654322',order='order_mail_'+suffix,collection='paycol_mail_'+suffix
 await db.query('INSERT INTO "order"(id,display_id,currency_code,status) VALUES($1,$2,\'usd\',\'pending\')',[order,Number(number)])
 await db.query("INSERT INTO payment_collection(id,currency_code,amount,raw_amount,status) VALUES($1,'usd',1,'{\"value\":\"1\",\"precision\":20}','not_paid')",[collection])
 const record={order_id:order,display_id:Number(number),payment_collection_id:collection,amount:1,currency_code:'usd',email:'recipient@example.invalid',invoice_email_recipient:'recipient@example.invalid',invoice_email_enabled:true,note:'different@example.invalid\nCustom details'}
 const invoice={display_id:Number(number),amount:1,payment_url:process.env.STOREFRONT_URL+'/payit/'+number+'/mo_abc1234',items:[{title:'Fixture',quantity:1}],customer_note:record.note}
 await db.query('INSERT INTO d4u_content_record(id,key,payload) VALUES($1,$2,$3)',['mailfixture_'+suffix,'invoice:'+number,JSON.stringify(record)])
 await enqueueInvoiceEmail({...record,invoice_email_recipient:''},invoice)
 assert.equal((await db.query("SELECT count(*) FROM d4u_content_record WHERE key LIKE 'invoice-mail:%' AND payload->>'invoice_number'=$1",[number])).rows[0].count,'0','Note email must not enqueue')
 await enqueueInvoiceEmail(record,invoice);await enqueueInvoiceEmail(record,invoice)
 const ready=()=>db.query("UPDATE d4u_content_record SET payload=payload||jsonb_build_object('next_at',now()-interval '1 minute') WHERE key LIKE 'invoice-mail:%' AND payload->>'invoice_number'=$1",[number])
 await ready()
 assert.equal((await db.query("SELECT count(*) FROM d4u_content_record WHERE key LIKE 'invoice-mail:%' AND payload->>'invoice_number'=$1",[number])).rows[0].count,'2')
 const sent=[]
 await drainInvoiceEmails(async()=>{throw Object.assign(Error('fixture failure'),{code:'ETIMEDOUT'})},number)
 const failed=await db.query("SELECT payload FROM d4u_content_record WHERE key LIKE 'invoice-mail:%' AND payload->>'invoice_number'=$1 AND payload->>'channel'='customer'",[number]);assert.equal(failed.rows[0].payload.state,'retry')
 await db.query("UPDATE d4u_content_record SET payload=payload||jsonb_build_object('next_at',now()-interval '1 minute') WHERE key LIKE 'invoice-mail:%' AND payload->>'invoice_number'=$1",[number])
 const deliver=async value=>{assert.equal(value.invoice_number,number);sent.push(value.channel+':'+value.recipient)}
 await drainInvoiceEmails(deliver,number);assert.deepEqual(sent,['customer:recipient@example.invalid','admin_copy:zsc@365d4u.com'])
 await enqueueInvoiceEmail(record,{...invoice,customer_note:'Note changed only'});await drainInvoiceEmails(deliver,number);assert.equal(sent.length,2)
 const second={...record,email:'new@example.invalid',invoice_email_recipient:'new@example.invalid'}
 await db.query('UPDATE d4u_content_record SET payload=$2 WHERE key=$1',['invoice:'+number,JSON.stringify(second)])
 await enqueueInvoiceEmail(second,invoice);await ready();await drainInvoiceEmails(deliver,number);assert.equal(sent.length,4)
 const third={...second,email:'late@example.invalid',invoice_email_recipient:'late@example.invalid'}
 await db.query('UPDATE d4u_content_record SET payload=$2 WHERE key=$1',['invoice:'+number,JSON.stringify(third)])
 await enqueueInvoiceEmail(third,invoice);await ready();await db.query('UPDATE payment_collection SET captured_amount=1 WHERE id=$1',[collection]);await drainInvoiceEmails(deliver,number);assert.equal(sent.length,4,'Paid invoice must not send a new payment request')
 const events=await db.query("SELECT after_value FROM d4u_invoice_audit WHERE invoice_number=$1 AND source='invoice_email'",[number]);assert.ok(events.rows.some(r=>r.after_value?.state==='sent'));assert.ok(events.rows.some(r=>r.after_value?.state==='retry'));assert.doesNotMatch(JSON.stringify(events.rows),/Complete your purchase|\/payit\//)
 console.log(JSON.stringify({email_field_only:true,note_never_triggers_mail:true,one_task_per_recipient_channel:true,retry_after_failure:true,copy_only_after_customer:true,note_edit_does_not_resend:true,new_email_gets_invoice:true,paid_invoice_suppressed:true,delivery_history:true,no_external_email_sent:true,rolled_back:true}))
}finally{pool.query=saved;await db.query('ROLLBACK');await db.end();await pool.end()}})().catch(e=>{console.error(e.message);process.exit(1)})
