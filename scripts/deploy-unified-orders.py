"""Publish the unified Orders screen and navigation to TEST; no data migrations."""
import runpy,tarfile,time
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1];REMOTE='/var/www/d4u_medusa'
d=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=d['connect']();s=c.open_sftp()
paths=['apps/backend/src','apps/backend/.medusa/server/src','apps/backend/.medusa/server/public/admin','apps/storefront/src/feishu-login.mjs']
archive=ROOT/'.private/unified-orders.tar.gz';backup=REMOTE+'/shared/backups/unified-orders-'+time.strftime('%Y%m%d-%H%M%S')
try:
 with tarfile.open(archive,'w:gz') as tar:
  for path in paths:tar.add(ROOT/path,arcname=path)
 d['run'](c,'mkdir -p '+backup+' && chmod 700 '+backup+' && cd '+REMOTE+' && tar -czf '+backup+'/code.tar.gz '+' '.join(paths))
 print('Existing code backed up',flush=True)
 s.put(str(archive),REMOTE+'/unified-orders.tar.gz');d['run'](c,'cd '+REMOTE+' && tar -xzf unified-orders.tar.gz')
 d['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
 for _ in range(25):
  try:
   if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
  except requests.RequestException:pass
  time.sleep(2)
 else:raise RuntimeError('Health check failed')
 print('Unified Orders deployed to TEST; backup: '+backup,flush=True)
finally:s.close();c.close()
