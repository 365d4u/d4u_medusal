// Run on the production host with Node --env-file=apps/backend/.env.
// Configures the private frontend key and verifies import counts; creates no orders.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root='/data/d4u_medusal',{Client}=require(path.join(root,'apps/backend/node_modules/pg'));
(async()=>{
 assert.ok(fs.existsSync(root+'/shared/bootstrap-complete'),'Bootstrap must finish first');
 const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
 const {rows:keys}=await db.query("SELECT token FROM api_key WHERE type='publishable' AND title='365D4U Storefront' AND deleted_at IS NULL AND revoked_at IS NULL");assert.equal(keys.length,1);
 const file=root+'/apps/storefront/.env';let env=fs.readFileSync(file,'utf8');env=env.replace(/^MEDUSA_PUBLISHABLE_KEY=.*$/m,'MEDUSA_PUBLISHABLE_KEY='+JSON.stringify(keys[0].token));fs.writeFileSync(file,env,{mode:0o600});
 const queries={products:"SELECT count(*)::int AS n FROM product WHERE deleted_at IS NULL",variants:"SELECT count(*)::int AS n FROM product_variant WHERE deleted_at IS NULL",customers:"SELECT count(*)::int AS n FROM customer WHERE deleted_at IS NULL",legacy_orders:"SELECT count(*)::int AS n FROM d4u_content_record WHERE key LIKE 'order:%' AND deleted_at IS NULL",wishlists:"SELECT count(*)::int AS n FROM d4u_content_record WHERE key LIKE 'wishlist:%' AND deleted_at IS NULL",native_orders:'SELECT count(*)::int AS n FROM "order" WHERE deleted_at IS NULL',notification_tasks:"SELECT count(*)::int AS n FROM d4u_content_record WHERE key LIKE 'paid-notification:%' AND deleted_at IS NULL"};const report={};
 for(const [name,query] of Object.entries(queries))report[name]=(await db.query(query)).rows[0].n;
 const source=JSON.parse(fs.readFileSync(root+'/shared/medusa-import.json'));
 const history=JSON.parse(fs.readFileSync(root+'/shared/history/orders.json'));
 assert.equal(report.products,source.products.length);assert.equal(report.legacy_orders,history.length);assert.equal(report.native_orders,0);assert.equal(report.notification_tasks,0);
 const sequence=(await db.query("SELECT pg_get_serial_sequence('\"order\"','display_id') AS seq")).rows[0].seq;assert.match(sequence,/^[a-z_]+\.[a-z_]+$/);
 const seq=(await db.query('SELECT last_value,is_called FROM '+sequence)).rows[0];assert.equal(Number(seq.last_value),200000);assert.equal(seq.is_called,false);report.next_order_number=200000;
 fs.writeFileSync(root+'/shared/deployment-verification.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));await db.end();
})().catch(error=>{console.error(error.message);process.exit(1)});
