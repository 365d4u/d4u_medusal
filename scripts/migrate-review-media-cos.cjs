// Run in backend .medusa/server after installing COS config. Upload legacy
// review files, verify cloud bytes, then change references. Keep local backups.
require('dotenv').config({path:'../../.env',quiet:true})
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{Client}=require('pg')
const {S3FileService}=require('@medusajs/file-s3/dist/services/s3-file'),{PutObjectCommand,GetObjectCommand}=require('@aws-sdk/client-s3')
const {cosFileOptions}=require('./src/lib/cos-media'),config=cosFileOptions(),provider=new S3FileService({logger:{error:()=>{}}},config)
const dir=path.resolve('../../../../shared/review-media'),map=new Map(),digest=b=>crypto.createHash('sha256').update(b).digest('hex')
;(async()=>{
 for(const name of fs.existsSync(dir)?fs.readdirSync(dir):[]){
  if(!/^[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4)$/.test(name))continue
  const bytes=fs.readFileSync(path.join(dir,name)),key=config.prefix+'legacy-reviews/'+name,ext=path.extname(name).slice(1),mime=ext==='mp4'?'video/mp4':ext==='jpg'?'image/jpeg':'image/'+ext
  await provider.client_.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:bytes,ContentType:mime,CacheControl:'public, max-age=31536000'}))
  const stored=await provider.client_.send(new GetObjectCommand({Bucket:config.bucket,Key:key}))
  if(digest(Buffer.from(await stored.Body.transformToByteArray()))!==digest(bytes))throw Error('Cloud media checksum mismatch')
  map.set('/review-media/'+name,config.file_url+'/'+key)
 }
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect()
 try{
  await db.query('BEGIN');const {rows}=await db.query("SELECT id,payload FROM d4u_content_record WHERE key='reviews' AND deleted_at IS NULL FOR UPDATE")
  const replace=v=>typeof v==='string'?(map.get(v)||map.get(v.replace(process.env.STOREFRONT_URL,''))||v):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v
  for(const row of rows){const next=replace(row.payload);if(JSON.stringify(next)!==JSON.stringify(row.payload))await db.query('UPDATE d4u_content_record SET payload=$2,updated_at=now() WHERE id=$1',[row.id,JSON.stringify(next)])}
  await db.query('COMMIT');console.log(JSON.stringify({migrated_local_files:map.size,cloud_checksums_verified:true,local_backups_retained:true}))
 }catch(e){await db.query('ROLLBACK');throw e}finally{await db.end()}
})().catch(e=>{console.error('COS migration failed:',e.code||e.name);process.exit(1)})
