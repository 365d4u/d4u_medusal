"""Publish the Invoice reporting UI/API and additive audit schema to TEST only."""
import json,runpy,tarfile,time
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'
def main():
 deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=deploy['connect']();s=c.open_sftp()
 backend=['lib/invoices.ts','lib/invoice-reporting.ts','lib/invoice-note.ts','lib/invoice-email.ts','lib/invoice-email-template.ts','lib/staff-access.ts','jobs/invoice-email.ts','api/admin/invoices/route.ts','api/admin/invoices/[number]/route.ts','api/admin/invoices/[number]/history/route.ts','api/store/staff/invoices/[number]/route.ts','api/store/staff/invoices/[number]/history/route.ts']
 backend += ['api/middlewares.ts','lib/invoice-staff-activity.ts','lib/invoice-activity.ts','api/store/invoices/[number]/payment/route.ts','api/store/invoices/[number]/method/route.ts','api/store/invoices/[number]/complete/route.ts']
 files=[Path('apps/backend/src')/p for p in backend]+[Path('apps/backend/.medusa/server/src')/p.replace('.ts','.js') for p in backend]
 files += [Path('apps/storefront')/p for p in ['src/invoice-routes.mjs','templates/invoice-builder.html','public/assets/invoice-builder.js','public/assets/invoice-builder.css']]
 files += [Path('scripts/sql/invoice-audit.sql'),Path('scripts/sql/invoice-history-recovery.sql')]
 package=ROOT/'.private/invoice-reporting-release.tar.gz'
 with tarfile.open(package,'w:gz') as tar:
  for p in files:tar.add(ROOT/p,arcname=p.as_posix())
 backup=REMOTE+'/shared/backups/invoice-reporting-'+time.strftime('%Y%m%d-%H%M%S')
 helper=REMOTE+'/apps/backend/.medusa/server/invoice-reporting-deploy.cjs'
 try:
  deploy['run'](c,'mkdir -p '+backup+' && cp '+REMOTE+'/apps/backend/.env '+backup+'/backend.env && chmod 600 '+backup+'/backend.env && cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz apps/backend/src apps/backend/.medusa/server/src apps/storefront/src/invoice-routes.mjs apps/storefront/templates/invoice-builder.html apps/storefront/public/assets/invoice-builder.js apps/storefront/public/assets/invoice-builder.css')
  code="require('dotenv').config({path:'../../.env',quiet:true});const cp=require('child_process'),fs=require('fs');const target="+json.dumps(backup+'/database.dump')+";const r=cp.spawnSync('pg_dump',['--dbname='+process.env.DATABASE_URL,'--format=custom','--file='+target],{encoding:'utf8'});if(r.status!==0)throw Error('Database backup failed');fs.chmodSync(target,0o600);console.log('Database backup complete');"
  with s.open(helper,'w') as f:f.write(code)
  print(deploy['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node invoice-reporting-deploy.cjs').strip())
  s.remove(helper)
  s.put(str(package),REMOTE+'/invoice-reporting-release.tar.gz')
  deploy['run'](c,'cd '+REMOTE+' && tar -xzf invoice-reporting-release.tar.gz')
  code="require('dotenv').config({path:'../../.env',quiet:true});const fs=require('fs'),{Client}=require('pg');(async()=>{const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();try{await db.query(fs.readFileSync('../../../../scripts/sql/invoice-audit.sql','utf8'));await db.query(fs.readFileSync('../../../../scripts/sql/invoice-history-recovery.sql','utf8'));console.log('Audit schema and historical record recovery ready')}finally{await db.end()}})().catch(()=>{console.error('Audit schema installation failed');process.exit(1)})"
  with s.open(helper,'w') as f:f.write(code)
  print(deploy['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node invoice-reporting-deploy.cjs').strip())
  s.remove(helper)
  target=REMOTE+'/apps/backend/.env'
  with s.open(target) as f:env=f.read().decode()
  lines=[line for line in env.splitlines() if not line.startswith('INVOICE_EMAIL_ENABLED=')]
  with s.open(target,'w') as f:f.write('\n'.join(lines+['INVOICE_EMAIL_ENABLED=true'])+'\n')
  s.chmod(target,0o600)
  deploy['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
  for _ in range(30):
   try:
    if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
   except requests.RequestException:pass
   time.sleep(2)
  else:raise RuntimeError('Backend health check failed')
  print('Deployed to testmedusa.365d4u.com; backup: '+backup)
 finally:s.close();c.close()
if __name__=='__main__':main()
