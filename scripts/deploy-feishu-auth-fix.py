"""Publish only the Feishu authentication code to the test environment."""
import runpy,time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'
def main():
    deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'))
    client=deploy['connect']();sftp=client.open_sftp()
    files=['apps/backend/src/modules/feishu-auth/service.ts','apps/backend/.medusa/server/src/modules/feishu-auth/service.js','apps/storefront/src/feishu-login.mjs']
    backup=REMOTE+'/shared/backups/feishu-auth-'+time.strftime('%Y%m%d-%H%M%S')
    try:
        deploy['run'](client,'mkdir -p '+backup+' && cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz '+' '.join(files))
        for file in files:sftp.put(str(ROOT/file),REMOTE+'/'+file)
        deploy['run'](client,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for attempt in range(30):
            try:
                if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
            except requests.RequestException:pass
            time.sleep(2)
        else:raise RuntimeError('Backend health check failed')
        print('Authentication update deployed; backup: '+backup)
    finally:sftp.close();client.close()
if __name__=='__main__':main()
