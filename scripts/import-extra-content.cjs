const fs=require('fs'),{Pool}=require('../apps/backend/node_modules/pg');
(async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 const names=['feishu_daily_shipments','waterfall_ads'];
 for(const name of names){
  const payload=JSON.parse(fs.readFileSync(`.private/${name}.json`,'utf8'));
  if(name==='feishu_daily_shipments')for(const item of payload.data?.data?.items||[]){
   // The source public endpoint includes customer emails. Only migrate display-safe fields.
   for(const [key,value] of Object.entries(item.fields||{}))if(JSON.stringify(value).includes('mailto:')||key==='邮箱')delete item.fields[key];
  }
  await pool.query(`INSERT INTO d4u_content_record(id,key,payload,created_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT (key) WHERE deleted_at IS NULL DO UPDATE SET payload=excluded.payload,updated_at=now()`,['extra_'+name,name,JSON.stringify(payload)]);
 }
 await pool.end();console.log('Imported additional display content without customer emails');
})().catch(e=>{console.error(e.message);process.exit(1)});
