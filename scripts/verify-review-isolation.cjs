// Run against TEST. All fixture changes, including audit rows, are rolled back.
const assert=require('assert/strict'),{randomUUID}=require('crypto');
const {managementDb,contentRecord,publicReviews}=require('./src/lib/store-management');
const route=require('./src/api/admin/store-management/[section]/route');
(async()=>{
 const pool=managementDb(),client=await pool.connect(),query=pool.query,connect=pool.connect;
 await client.query('BEGIN');
 pool.query=(...args)=>client.query(...args);
 pool.connect=async()=>({query:(sql,args)=>client.query(sql==='BEGIN'?'SAVEPOINT verification_edit':sql==='COMMIT'?'RELEASE SAVEPOINT verification_edit':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT verification_edit':sql,args),release(){}});
 const id='verification-'+randomUUID(),product=(await client.query(`SELECT id,metadata FROM product WHERE deleted_at IS NULL AND status='published' LIMIT 1`)).rows[0],productId=String(product.metadata?.legacy?.id||product.id);
 const post=async(section,review)=>{let output;await route.POST({params:{section},body:{review,revision:(await contentRecord(section))?.revision||0},auth_context:{actor_id:'review-isolation-verification'}},{json:x=>(output=x)});return output};
 try{
  const beforeSite=(await publicReviews()).length,beforeProduct=(await publicReviews('product-reviews')).length;
  await post('reviews',{id,reviewer_name:'Isolation test',content:'Store fixture, rolled back',rating:5,status:'approved',email:'store@verification.invalid',media:[]});
  assert.equal((await publicReviews()).length,beforeSite+1);assert.equal((await publicReviews('product-reviews')).length,beforeProduct);
  await post('product-reviews',{id,reviewer_name:'Isolation test',content:'Product fixture, rolled back',product_id:product.id,status:'approved',email:'product@verification.invalid',media:[]});
  assert.equal((await publicReviews('product-reviews')).length,beforeProduct+1);
  assert.equal((await contentRecord('review-private:reviews:'+id)).email,'store@verification.invalid');
  assert.equal((await contentRecord('review-private:product-reviews:'+id)).email,'product@verification.invalid');
  await post('product-reviews',{id:id+'-reply',reviewer_name:'Reply test',content:'Reply fixture, rolled back',product_id:productId,parent_id:id,status:'approved',media:[]});
  await post('product-reviews',{id,reviewer_name:'Isolation test',content:'Product fixture, rolled back',product_id:productId,status:'trash',media:[]});
  assert.equal((await publicReviews()).length,beforeSite+1);
  assert.equal((await publicReviews('product-reviews')).some(r=>r.id===id),false);
  await assert.rejects(()=>route.POST({params:{section:'product-reviews'},body:{action:'import',kind:'store-reviews',reviews:[]},auth_context:{actor_id:'review-isolation-verification'}},{json(){}}),/other review type/);
  await assert.rejects(()=>post('product-reviews',{id:id+'-bad',reviewer_name:'Bad reply',content:'Invalid parent',product_id:productId,parent_id:'missing',status:'approved',media:[]}),/existing comment/);
  console.log(JSON.stringify({independent_counts:true,independent_moderation:true,same_id_private_email_isolated:true,reply_preserved:true,wrong_import_rejected:true,invalid_parent_rejected:true}));
 }finally{pool.query=query;pool.connect=connect;await client.query('ROLLBACK');client.release();await pool.end();console.log('All verification fixtures and audit rows rolled back; no email sent');}
})().catch(e=>{console.error(e.message);process.exit(1)});
