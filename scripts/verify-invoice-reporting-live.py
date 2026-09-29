"""Temporary, explicitly labelled non-administrator fixture; never a real user's identity."""
import json,runpy,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=deploy['connect']();s=c.open_sftp()
remote='/var/www/d4u_medusa/apps/backend/.medusa/server';helper=remote+'/invoice-reporting-fixture.cjs'
fixture=ROOT/'.private/invoice-reporting-fixture.json';data=None
setup=r"""require('dotenv').config({path:'../../.env',quiet:true});const fs=require('fs'),{randomUUID,createHmac}=require('crypto'),jwt=require('jsonwebtoken'),{database}=require('./src/modules/payment-shared/security'),access=require('./src/lib/staff-access'),{feishuIdentity}=require('./src/lib/feishu-access');(async()=>{const user={tenant_key:process.env.FEISHU_TENANT_KEY,open_id:'ou_invoice_report_fixture_'+randomUUID(),name:'Invoice report verification'};const identity=feishuIdentity(user);await access.writeAccessRecord('feishu-seen:'+identity,{identity,user});await access.ensureFeishuStaff(user);const p=await access.currentFeishuPermissions(user);const g=await access.currentStaffGrant(p.admin_id);if(g.super_admin)throw Error('Fixture must not be administrator');const common={auth_provider:'feishu',auth_identity_id:'invoice-report-fixture',user_metadata:{feishu:user}};const sign=body=>jwt.sign(body,process.env.JWT_SECRET,{expiresIn:'10m'});const token=sign({...common,actor_id:identity,actor_type:'invoice_staff'}),admin_token=sign({...common,actor_id:p.admin_id,actor_type:'user',app_metadata:{user_id:p.admin_id}});const secret=require('dotenv').parse(fs.readFileSync('../../../storefront/.env')).COOKIE_SECRET;const body=Buffer.from(token).toString('base64url');console.log(JSON.stringify({identity,user_id:p.admin_id,admin_token,cookie:body+'.'+createHmac('sha256',secret).update(body).digest('hex')}));process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});"""
try:
 with s.open(helper,'w') as f:f.write(setup)
 data=json.loads(deploy['run'](c,'cd '+remote+' && node invoice-reporting-fixture.cjs').strip().splitlines()[-1]);fixture.write_text(json.dumps(data),encoding='utf-8')
 subprocess.run(['node','scripts/verify-invoice-reporting-live.cjs'],cwd=ROOT,check=True)
finally:
 if data:
  cleanup="require('dotenv').config({path:'../../.env',quiet:true});const {Client}=require('pg'),input="+json.dumps({'identity':data['identity'],'user_id':data['user_id']})+";"+r"""(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();await db.query('BEGIN');await db.query('DELETE FROM d4u_content_record WHERE key=ANY($1)',[['feishu-seen:'+input.identity,'feishu-binding:'+input.identity,'staff:'+input.user_id]]);await db.query('DELETE FROM "user" WHERE id=$1 AND email=$2',[input.user_id,input.identity+'@staff.invalid']);await db.query('COMMIT');await db.end();console.log('Temporary staff fixture removed')})().catch(e=>{console.error(e.message);process.exit(1)})"""
  with s.open(helper,'w') as f:f.write(cleanup)
  print(deploy['run'](c,'cd '+remote+' && node invoice-reporting-fixture.cjs').strip())
  fixture.unlink(missing_ok=True)
 s.remove(helper);s.close();c.close()
