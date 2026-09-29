"""Deploy this parity release to the test site only, preserving environment and other features."""
import hashlib,json,runpy,shlex,tarfile,time
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'
BACKEND=['lib/catalog-pricing.ts','lib/catalog-checkout.ts','api/store/legacy/route.ts','api/store/carts/[id]/refresh/route.ts','modules/paypal/service.ts','modules/oceanpayment/service.ts','subscribers/catalog-sales.ts','scripts/import-storefront-parity.ts']
def main():
    d=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));c=d['connect']();s=c.open_sftp()
    files=[Path('apps/backend/src')/p for p in BACKEND]+[Path('apps/backend/.medusa/server/src')/p.replace('.ts','.js') for p in BACKEND]
    files += [Path('apps/storefront/src')/p for p in ['server.mjs','views.mjs','product-view.mjs']]
    files += [Path('apps/storefront/public/assets')/p for p in ['storefront.css','storefront-parity.css','storefront.js','fonts']]
    files += [Path('apps/storefront/templates')]
    archive=ROOT/'.private/storefront-parity/release.tar.gz'
    with tarfile.open(archive,'w:gz') as tar:
        for f in files:tar.add(ROOT/f,arcname=f.as_posix())
    backup=REMOTE+'/shared/backups/storefront-parity-'+time.strftime('%Y%m%d-%H%M%S')
    stopped=False
    try:
        env=s.open(REMOTE+'/apps/backend/.env').read().decode()
        config={k:v.strip('"\'') for line in env.splitlines() if '=' in line and not line.startswith('#') for k,v in [line.split('=',1)]}
        if config.get('BUSINESS_ENVIRONMENT')!='test' or config.get('STOREFRONT_URL')!='https://testmedusa.365d4u.com':raise RuntimeError('Test environment mismatch')
        existing=[]
        for f in files:
            try:s.stat(REMOTE+'/'+f.as_posix());existing.append(f.as_posix())
            except FileNotFoundError:pass
        d['run'](c,'mkdir -p '+backup+' && chmod 700 '+backup+' && cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz '+' '.join(shlex.quote(p) for p in existing))
        d['run'](c,'systemctl stop d4u-medusa-storefront d4u-medusa-backend');stopped=True
        d['run'](c,'runuser -u postgres -- pg_dump -Fc d4u_medusa > '+backup+'/database.dump && chmod 600 '+backup+'/database.dump')
        s.put(str(archive),REMOTE+'/storefront-parity-release.tar.gz')
        s.put(str(ROOT/'.private/storefront-parity/import.json'),REMOTE+'/shared/storefront-parity-import.json');s.chmod(REMOTE+'/shared/storefront-parity-import.json',0o600)
        d['run'](c,'cd '+REMOTE+' && tar -xzf storefront-parity-release.tar.gz')
        # The CLI receives configuration from the existing backend .env without logging it.
        command='cd '+REMOTE+'/apps/backend && STOREFRONT_PARITY_FILE='+REMOTE+'/shared/storefront-parity-import.json npx medusa exec ./src/scripts/import-storefront-parity.ts'
        result=d['run'](c,command);print(result[-1600:])
        for f in files:
            if (ROOT/f).is_dir():continue
            if hashlib.sha256(s.open(REMOTE+'/'+f.as_posix()).read()).digest()!=hashlib.sha256((ROOT/f).read_bytes()).digest():raise RuntimeError('Release hash mismatch: '+str(f))
        d['run'](c,'systemctl restart d4u-medusa-backend d4u-medusa-storefront');stopped=False
        for _ in range(25):
            try:
                if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
            except requests.RequestException:pass
            time.sleep(2)
        else:raise RuntimeError('Health check failed')
        report={'environment':'test','backup':backup,'health':200,'production_changed':False,'wordpress_changed':False}
        (ROOT/'.private/storefront-parity/deployment.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
    finally:
        if stopped:d['run'](c,'systemctl start d4u-medusa-backend d4u-medusa-storefront')
        s.close();c.close()
if __name__=='__main__':main()
