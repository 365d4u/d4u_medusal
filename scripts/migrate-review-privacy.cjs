// Split old private contact records into the two independent review namespaces.
const {Client}=require('pg'),{randomUUID}=require('crypto');
(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();try{
 await db.query('BEGIN');let count=0;
 for(const kind of ['reviews','product-reviews']){
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[kind]);
  const old=await db.query(`SELECT p.payload FROM d4u_content_record r CROSS JOIN LATERAL jsonb_array_elements(r.payload->'reviews') x JOIN d4u_content_record p ON p.key='review-private:'||(x->>'id') AND p.deleted_at IS NULL WHERE r.key=$1 AND r.deleted_at IS NULL`,[kind]);
  for(const r of old.rows){const result=await db.query(`INSERT INTO d4u_content_record(id,key,payload,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(key) WHERE deleted_at IS NULL DO NOTHING`,['review_private_'+randomUUID(),'review-private:'+kind+':'+r.payload.review_id,JSON.stringify(r.payload)]);count+=result.rowCount;}
 }
 await db.query('COMMIT');console.log(JSON.stringify({private_contacts_separated:count,notifications_sent:0}));
}catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}})().catch(e=>{console.error(e.message);process.exit(1)});
