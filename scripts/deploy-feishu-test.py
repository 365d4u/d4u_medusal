"""Publish only SSO and invoice UI changes to the test host; preserve all payment settings."""
import json,os,runpy,secrets,tarfile,time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'

def main():
    cfg=json.loads((ROOT/'.private/feishu-test.json').read_text(encoding='utf8'))
    deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'))
    c=deploy['connect']();s=c.open_sftp()
    try:
        backend=['medusa-config.ts','src/api/middlewares.ts','src/lib/feishu-access.ts','src/lib/feishu-middleware.ts','src/modules/feishu-auth/index.ts','src/modules/feishu-auth/service.ts','src/api/store/staff/session/route.ts','src/api/store/staff/invoices/route.ts','src/admin/widgets/feishu-login.tsx']
        backend += ['src/lib/staff-access.ts','src/lib/staff-admin-vite.ts','src/modules/customer-emailpass/index.ts','src/api/admin/staff-access/route.ts','src/api/admin/staff-access/me/route.ts','src/scripts/initialize-staff-access.ts']
        files=[Path('apps/backend')/name for name in backend]
        files += list(Path('apps/backend/src/admin').rglob('*.tsx'))
        files += [Path('apps/backend/.medusa/server')/name.replace('.ts','.js') for name in backend if not name.endswith('.tsx')]
        files += list(Path('apps/backend/.medusa/server/public/admin').rglob('*'))
        files += [Path('apps/storefront')/name for name in ['src/feishu-login.mjs','src/server.mjs','src/invoice-routes.mjs','public/assets/invoice-builder.js','templates/invoice-builder.html']]
        package=ROOT/'.private/feishu-test-release.tar.gz'
        with tarfile.open(package,'w:gz') as tar:
            for file in files:
                if file.is_file():tar.add(file,arcname=file.as_posix())
        stamp=time.strftime('%Y%m%d-%H%M%S');backup=REMOTE+'/shared/backups/feishu-'+stamp
        deploy['run'](c,'mkdir -p '+backup+' && cp -a '+REMOTE+'/apps/backend/.env '+backup+'/backend.env && cp -a '+REMOTE+'/apps/storefront/.env '+backup+'/storefront.env && cp -a /etc/nginx/sites-available/testmedusa.365d4u.com.conf '+backup+'/nginx.conf')
        # Back up current files affected by this release, including existing Admin assets.
        paths=['apps/backend/medusa-config.ts','apps/backend/src','apps/backend/.medusa/server/medusa-config.js','apps/backend/.medusa/server/src','apps/backend/.medusa/server/public/admin','apps/storefront/src','apps/storefront/public/assets/invoice-builder.js','apps/storefront/templates/invoice-builder.html']
        deploy['run'](c,'cd '+REMOTE+' && tar -czf '+backup+'/files.tar.gz '+' '.join(paths))
        # Database backup precedes credential migration and permission bootstrap.
        bootstrap=json.loads((ROOT/'.private/admin-access.json').read_text(encoding='utf8'))
        helper="""require('dotenv').config({path:'../../.env'});
const fs=require('fs'),cp=require('child_process');
const backup=%s;
const dump=cp.spawnSync('pg_dump',['--dbname='+process.env.DATABASE_URL,'--format=custom','--file='+backup+'/database.dump'],{encoding:'utf8'});
if(dump.status!==0)throw new Error('Database backup failed; no access settings changed');
fs.chmodSync(backup+'/database.dump',0o600);
console.log('Database backup complete');
""" % json.dumps(backup)
        helper_path=REMOTE+'/apps/backend/.medusa/server/staff-backup.cjs'
        with s.open(helper_path,'w') as out:out.write(helper)
        deploy['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node staff-backup.cjs')
        s.remove(helper_path)
        s.put(str(package),REMOTE+'/feishu-test-release.tar.gz')
        deploy['run'](c,'cd '+REMOTE+' && tar -xzf feishu-test-release.tar.gz')
        helper="require('dotenv').config({path:'../../.env'});process.env.STAFF_BOOTSTRAP_EMAIL="+json.dumps(bootstrap['email'])+";require('./src/scripts/initialize-staff-access').default().then(()=>process.exit(0)).catch(()=>{console.error('Staff access bootstrap failed');process.exit(1)});"
        helper_path=REMOTE+'/apps/backend/.medusa/server/staff-bootstrap.cjs'
        with s.open(helper_path,'w') as out:out.write(helper)
        deploy['run'](c,'cd '+REMOTE+'/apps/backend/.medusa/server && node staff-bootstrap.cjs')
        s.remove(helper_path)
        cfg.setdefault('bridge_secret',secrets.token_hex(32))
        (ROOT/'.private/feishu-test.json').write_text(json.dumps(cfg),encoding='utf8')
        for app in ['backend','storefront']:
            target=REMOTE+'/apps/'+app+'/.env';old=s.open(target).read().decode()
            values={'FEISHU_ENABLED':'true','FEISHU_APP_ID':cfg['app_id'],'FEISHU_BRIDGE_SECRET':cfg['bridge_secret'],'STOREFRONT_URL':'https://testmedusa.365d4u.com'}
            if app=='backend':values.update(STAFF_ACCESS_ENABLED='true',FEISHU_DEFAULT_ROLE=cfg.get('default_role','assigned'),FEISHU_ADMIN_IDENTITIES=json.dumps(cfg.get('admin_identities',[])),FEISHU_APP_SECRET=cfg['app_secret'],FEISHU_TENANT_KEY=cfg.get('tenant_key',''),FEISHU_INVOICE_ACCESS=cfg.get('invoice_access','allowlist'),FEISHU_INVOICE_ALLOWLIST=json.dumps(cfg.get('invoice_allowlist',[])),FEISHU_ADMIN_BINDINGS=json.dumps(cfg.get('admin_bindings',{})))
            lines=[line for line in old.splitlines() if line.split('=',1)[0] not in values]
            # JSON escapes are not interpreted by dotenv for nested JSON values.
            def encode(value):
                value=str(value)
                return "'"+value+"'" if '"' in value else json.dumps(value)
            with s.open(target,'w') as out:out.write('\n'.join(lines+[key+'='+encode(value) for key,value in values.items()])+'\n')
            s.chmod(target,0o600)
        conf=runpy.run_path(str(ROOT/'scripts/configure-nginx.py'))['conf']
        with s.open('/etc/nginx/sites-available/testmedusa.365d4u.com.conf','w') as out:out.write(conf)
        deploy['run'](c,'nginx -t && systemctl reload nginx && systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for attempt in range(30):
            try:
                if requests.get('https://testmedusa.365d4u.com/health',timeout=5).status_code==200:break
            except requests.RequestException:pass
            time.sleep(2)
        else:raise RuntimeError('Test service did not become healthy')
        print(json.dumps({'deployed':'testmedusa.365d4u.com','app_id':cfg['app_id'],'tenant_configured':bool(cfg.get('tenant_key')),'invoice_access':cfg.get('invoice_access','allowlist'),'default_staff_role':cfg.get('default_role','assigned'),'administrator_identity_count':len(cfg.get('admin_identities',[])),'backup':backup}))
    finally:s.close();c.close()

if __name__=='__main__':main()
