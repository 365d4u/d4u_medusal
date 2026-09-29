// Test maintenance import. Input contains private email addresses; never publish it.
const fs=require('fs'),{Client}=require('pg'),crypto=require('crypto');
(async()=>{
 const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtext('admin-source-import-v1'))")
  const marker=await db.query("SELECT id FROM d4u_content_record WHERE key='migration:admin-source-v1' AND deleted_at IS NULL");if(marker.rows.length){await db.query('ROLLBACK');console.log('Admin source import already applied');return}
  const save=async(key,payload)=>db.query(`INSERT INTO d4u_content_record(id,key,payload,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(key) WHERE deleted_at IS NULL DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,['import_'+crypto.randomUUID(),key,JSON.stringify(payload)])
  await db.query("SELECT pg_advisory_xact_lock(hashtext('product-reviews'))")
  const old=(await db.query("SELECT payload FROM d4u_content_record WHERE key='product-reviews' AND deleted_at IS NULL")).rows[0]?.payload||{reviews:[]},ids=new Set(old.reviews.map(r=>String(r.id)))
  await save('product-reviews',{...old,reviews:[...old.reviews,...source.product_reviews.filter(r=>!ids.has(String(r.id)))],revision:Number(old.revision||0)+1})
  for(const r of [...source.private_reviews,...source.store_private])await db.query(`INSERT INTO d4u_content_record(id,key,payload,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(key) WHERE deleted_at IS NULL DO NOTHING`,['review_private_'+crypto.randomUUID(),'review-private:'+r.review_id,JSON.stringify({review_id:r.review_id,email:r.email})])
  const patches=new Map();const patch=(id,value)=>patches.set(String(id),{...patches.get(String(id)),...value})
  for(const r of source.payment_dates){const date=new Date(String(r.value).replace(' ','T').replace(/Z$/,'')+'Z');if(!Number.isFinite(date.getTime()))throw Error('Invalid source payment date');patch(r.id,{payment_date:date.toISOString()})}
  for(const r of source.delivery)patch(r.id,{delivery_no:r.value})
  for(const r of source.order_meta){if(r.key==='is_respond_order'&&r.value==='1')patch(r.id,{origin:'Respond'});else if(r.key==='_wc_order_attribution_source_type'&&patches.get(String(r.id))?.origin!=='Respond')patch(r.id,{origin:r.value});else if(r.key==='_no_ocean_limit')patch(r.id,{no_ocean_limit:r.value==='yes'});else if(r.key==='cdNo')patch(r.id,{cd_no:r.value})}
  const rows=[...patches].map(([id,patch])=>({id,patch}));let count=0;
  for(let i=0;i<rows.length;i+=500){const r=await db.query(`UPDATE d4u_content_record r SET payload=r.payload||x.patch,updated_at=now() FROM jsonb_to_recordset($1::jsonb) AS x(id text,patch jsonb) WHERE r.key='order:'||x.id AND r.deleted_at IS NULL`,[JSON.stringify(rows.slice(i,i+500))]);count+=r.rowCount}
  const products=new Map();for(const r of source.product_meta){const names={cdNo:'cd_no',_personal_summary:'personal_summary',_checkout_summary:'checkout_summary',_myshop_semi_full_payment_only:'full_payment_only',_myshop_show_on_checkout:'show_on_checkout'},key=names[r.key];if(key)products.set(String(r.id),{...products.get(String(r.id)),[key]:['full_payment_only','show_on_checkout'].includes(key)?['yes','1'].includes(r.value):r.value})}
  for(const [id,patch] of products)await db.query(`UPDATE product SET metadata=jsonb_set(COALESCE(metadata,'{}'),'{legacy}',COALESCE(metadata->'legacy','{}')||$2::jsonb),updated_at=now() WHERE metadata->>'legacy_id'=$1 AND deleted_at IS NULL`,[id,JSON.stringify(patch)])
  await save('migration:admin-source-v1',{completed_at:new Date().toISOString(),product_comments:source.product_reviews.length,orders_enriched:count,no_notifications:true});await db.query('COMMIT');console.log(JSON.stringify({product_comments:source.product_reviews.length,orders_enriched:count,notifications_sent:0}))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
})().catch(e=>{console.error(e.code||e.name,e.message);process.exit(1)})
