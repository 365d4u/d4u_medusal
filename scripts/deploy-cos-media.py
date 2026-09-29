"""Configure Tencent COS and deploy media uploads to TEST only."""
import json,runpy,tarfile,time
from pathlib import Path
from urllib.parse import urlsplit
import requests
ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'

def main():
 d=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=d['connect']();s=c.open_sftp()
 sources=['lib/cos-media.ts','modules/cos-file/index.ts','modules/cos-file/service.ts','api/store/review-media/route.ts','api/store/feedback/route.ts','api/middlewares.ts']
 files=[Path('apps/backend/src')/p for p in sources]+[Path('apps/backend/.medusa/server/src')/p.replace('.ts','.js') for p in sources]
 files += [Path(p) for p in ['apps/backend/medusa-config.ts','apps/backend/.medusa/server/medusa-config.js','apps/storefront/src/server.mjs','apps/storefront/src/review-media.mjs','scripts/migrate-review-media-cos.cjs']]
 archive=ROOT/'.private/cos-media-release.tar.gz'
 with tarfile.open(archive,'w:gz') as tar:
  for p in files:tar.add(ROOT/p,arcname=p.as_posix())
 backup=REMOTE+'/shared/backups/cos-media-'+time.strftime('%Y%m%d-%H%M%S')
 helper=REMOTE+'/apps/backend/.medusa/server/cos-media-deploy.cjs'
 try:
  d['run'](c,'mkdir -p '+backup+' && chmod 700 '+backup+' && cp '+REMOTE+'/apps/backend/.env '+backup+'/backend.env && cp '+REMOTE+'/apps/storefront/.env '+backup+'/storefront.env && cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz apps/backend/medusa-config.ts apps/backend/.medusa/server/medusa-config.js apps/backend/src apps/backend/.medusa/server/src apps/storefront/src shared/review-media')
  code="require('dotenv').config({path:'../../.env',quiet:true});const cp=require('child_process');const r=cp.spawnSync('pg_dump',['--dbname='+process.env.DATABASE_URL,'--format=custom','--file='+"+json.dumps(backup+'/database.dump')+"],{encoding:'utf8'});if(r.status)process.exit(1);console.log('Database backup complete')"
  with s.open(helper,'w') as f:f.write(code)
  print(d['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node cos-media-deploy.cjs').strip());s.remove(helper)
  s.put(str(archive),REMOTE+'/cos-media-release.tar.gz');d['run'](c,'cd '+REMOTE+' && tar -xzf cos-media-release.tar.gz')
  cfg=json.loads((ROOT/'.private/cos-source.json').read_text(encoding='utf-8'));u=urlsplit(cfg['upload_url_path'])
  values={'COS_SECRET_ID':cfg['secret_id'],'COS_SECRET_KEY':cfg['secret_key'],'COS_BUCKET':cfg['bucket'],'COS_REGION':cfg['region'],'COS_PUBLIC_URL':u.scheme+'://'+u.netloc,'COS_PREFIX':u.path.strip('/')+'/medusa/test/'}
  for app,updates in [('backend',values),('storefront',{'COS_MEDIA_BASE_URL':values['COS_PUBLIC_URL']+'/'+values['COS_PREFIX']})]:
   target=REMOTE+'/apps/'+app+'/.env'
   with s.open(target) as f:lines=f.read().decode().splitlines()
   lines=[l for l in lines if l.split('=',1)[0] not in [*updates,'REVIEW_MEDIA_DIR']]
   with s.open(target,'w') as f:f.write('\n'.join(lines+[k+'='+json.dumps(v) for k,v in updates.items()])+'\n')
   s.chmod(target,0o600)
  s.put(str(ROOT/'scripts/migrate-review-media-cos.cjs'),helper)
  print(d['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node cos-media-deploy.cjs').strip());s.remove(helper)
  d['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
  for _ in range(30):
   try:
    if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
   except requests.RequestException:pass
   time.sleep(2)
  else:raise RuntimeError('Backend health check failed')
  print('COS media deployed to testmedusa.365d4u.com; backup: '+backup)
 finally:s.close();c.close()
if __name__=='__main__':main()
