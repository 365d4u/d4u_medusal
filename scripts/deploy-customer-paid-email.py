"""Narrow TEST release: customer payment email + default invoice create page.

Requires DEPLOY_SSH_PASSWORD, preserves existing activation time on repeat runs.
No data import, historical email backfill, or production/WordPress changes.
"""
import hashlib,json,runpy,shlex,tarfile,time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'

def main():
    deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'))
    backend=['lib/customer-paid-email.ts','lib/paid-notifications.ts','lib/email-management.ts','lib/invoice-reporting.ts','api/admin/email-management/route.ts']
    files=[Path('apps/backend/src')/p for p in backend]+[Path('apps/backend/.medusa/server/src')/p.replace('.ts','.js') for p in backend]
    files += [Path('apps/backend/src/admin/routes/email-log/page.tsx'),Path('apps/storefront/public/assets/invoice-builder.js'),Path('apps/backend/.medusa/server/public/admin')]
    archive=ROOT/'.private/customer-paid-email-release.tar.gz'
    with tarfile.open(archive,'w:gz') as tar:
        for path in files:tar.add(ROOT/path,arcname=path.as_posix())
    c=deploy['connect']();s=c.open_sftp();stopped=False
    backup=REMOTE+'/shared/backups/customer-paid-email-'+time.strftime('%Y%m%d-%H%M%S')
    try:
        env=s.open(REMOTE+'/apps/backend/.env').read().decode()
        config={k:v.strip('"\'') for line in env.splitlines() if '=' in line and not line.startswith('#') for k,v in [line.split('=',1)]}
        if config.get('BUSINESS_ENVIRONMENT')!='test' or config.get('STOREFRONT_URL')!='https://testmedusa.365d4u.com':raise RuntimeError('Test environment mismatch')
        if config.get('PAID_NOTIFICATIONS_ENABLED')!='true':raise RuntimeError('Existing paid notifications must already be enabled')
        s.stat(REMOTE+'/apps/backend/assets/fonts/NotoSansCJKsc-Regular.otf')
        existing=[]
        for p in files:
            try:s.stat(REMOTE+'/'+p.as_posix());existing.append(p.as_posix())
            except FileNotFoundError:pass
        deploy['run'](c,'mkdir -p '+backup+' && chmod 700 '+backup+' && cp '+REMOTE+'/apps/backend/.env '+backup+'/backend.env && chmod 600 '+backup+'/backend.env && cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz '+' '.join(shlex.quote(p) for p in existing))
        s.put(str(archive),REMOTE+'/customer-paid-email-release.tar.gz')
        deploy['run'](c,'systemctl stop d4u-medusa-backend');stopped=True
        deploy['run'](c,'cd '+REMOTE+' && tar -xzf customer-paid-email-release.tar.gz')
        activation=config.get('CUSTOMER_PAID_EMAIL_START_AT') or deploy['run'](c,"date -u +%Y-%m-%dT%H:%M:%SZ").strip()
        lines=[line for line in env.splitlines() if not line.startswith('CUSTOMER_PAID_EMAIL_START_AT=')]
        with s.open(REMOTE+'/apps/backend/.env','w') as f:f.write('\n'.join(lines+['CUSTOMER_PAID_EMAIL_START_AT='+activation])+'\n')
        s.chmod(REMOTE+'/apps/backend/.env',0o600)
        for p in files:
            if (ROOT/p).is_dir():continue
            if hashlib.sha256(s.open(REMOTE+'/'+p.as_posix()).read()).digest()!=hashlib.sha256((ROOT/p).read_bytes()).digest():raise RuntimeError('Upload hash mismatch: '+str(p))
        deploy['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for _ in range(30):
            try:
                if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
            except requests.RequestException:pass
            time.sleep(2)
        else:raise RuntimeError('Test backend health check failed')
        stopped=False
        report={'environment':'test','origin':'https://testmedusa.365d4u.com','backup':backup,'customer_email_start_at':activation,'file_hashes_verified':True,'health':200,'production_changed':False}
        (ROOT/'.private/customer-paid-email-deployment.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
    except Exception:
        if stopped:
            deploy['run'](c,'cd '+REMOTE+' && tar -xzf '+backup+'/files.tar.gz && cp '+backup+'/backend.env apps/backend/.env && systemctl restart d4u-medusa-backend d4u-medusa-storefront')
            print('Restored previous test release and environment from '+backup)
        raise
    finally:s.close();c.close()

if __name__=='__main__':main()
