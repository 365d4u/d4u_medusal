"""Deploy the admin migration to TEST; back up code and database first."""
import runpy,tarfile,time
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1];REMOTE='/var/www/d4u_medusa'
def main():
 d=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=d['connect']();s=c.open_sftp();runtime=REMOTE+'/apps/backend/.medusa/server'
 paths=['apps/backend/src','apps/backend/.medusa/server/src','apps/backend/.medusa/server/public/admin','apps/backend/package.json','apps/backend/package-lock.json','apps/backend/assets/fonts','apps/storefront/src','apps/storefront/public/assets/storefront.js','apps/storefront/public/assets/invoice-payment.js','apps/storefront/public/assets/product-reviews.js']
 archive=ROOT/'.private/admin-management-release.tar.gz';backup=REMOTE+'/shared/backups/admin-management-'+time.strftime('%Y%m%d-%H%M%S')
 with tarfile.open(archive,'w:gz') as tar:
  for path in paths:tar.add(ROOT/path,arcname=path)
 helper=runtime+'/admin-management-maintenance.cjs';input_file=REMOTE+'/shared/admin-source-import.json'
 try:
  d['run'](c,'mkdir -p '+backup+' && chmod 700 '+backup+' && cd '+REMOTE+' && tar -czf '+backup+'/code.tar.gz apps/backend/src apps/backend/.medusa/server/src apps/backend/.medusa/server/public/admin apps/backend/package.json apps/backend/package-lock.json apps/storefront/src apps/storefront/public/assets')
  with s.open(helper,'w') as f:f.write("const cp=require('child_process');const r=cp.spawnSync('pg_dump',['--dbname='+process.env.DATABASE_URL,'--format=custom','--file='+"+repr(backup+'/database.dump')+"],{encoding:'utf8'});if(r.status)process.exit(1);console.log('Database backup complete')")
  print(d['run'](c,'cd '+runtime+' && node --env-file=../../.env admin-management-maintenance.cjs').strip());s.remove(helper)
  s.put(str(archive),REMOTE+'/admin-management-release.tar.gz');d['run'](c,'cd '+REMOTE+' && tar -xzf admin-management-release.tar.gz')
  print(d['run'](c,'cd '+REMOTE+'/apps/backend && npm install --no-audit --no-fund > '+backup+'/npm-install.log 2>&1 && echo Dependencies-installed').strip())
  s.put(str(ROOT/'scripts/migrate-admin-source.cjs'),helper);s.put(str(ROOT/'.private/admin-source-import.json'),input_file);s.chmod(input_file,0o600)
  print(d['run'](c,'cd '+runtime+' && node --env-file=../../.env admin-management-maintenance.cjs '+input_file).strip());s.remove(helper);s.remove(input_file)
  d['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
  for _ in range(25):
   try:
    if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
   except requests.RequestException:pass
   time.sleep(2)
  else:raise RuntimeError('Health check failed')
  print('Admin management deployed to TEST; backup: '+backup)
 finally:
  for file in [helper,input_file]:
   try:s.remove(file)
   except FileNotFoundError:pass
  s.close();c.close()
if __name__=='__main__':main()
