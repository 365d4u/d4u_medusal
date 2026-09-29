"""Deploy only /var/www/d4u_medusa and its explicitly named test site/services.
Requires DEPLOY_SSH_PASSWORD. Local secret files are never packaged as public assets.
"""
import os,sys,tarfile,json,shlex,secrets
from pathlib import Path
import paramiko

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'
def connect():
    c=paramiko.SSHClient();c.load_system_host_keys();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('38.47.238.242',port=36524,username='root',password=os.environ['DEPLOY_SSH_PASSWORD'],timeout=30)
    c.get_transport().set_keepalive(30)
    return c
def run(c,command):
    _,out,err=c.exec_command(command,timeout=900)
    result=out.read().decode();error=err.read().decode()
    if out.channel.recv_exit_status():raise RuntimeError(error[-2000:]+result[-2000:])
    return result
def upload(c,include_build=False):
    package=ROOT/'.private/deploy.tar.gz'
    with tarfile.open(package,'w:gz') as tar:
        for app in ['backend','storefront']:
            for base,dirs,files in os.walk(ROOT/'apps'/app):
                dirs[:]=[d for d in dirs if d not in ['node_modules','.git','.next'] and (d!='.medusa' or include_build)]
                for name in files:
                    if name.startswith('.env') or name.endswith('.log'):continue
                    file=Path(base)/name
                    tar.add(file,arcname=str(file.relative_to(ROOT)).replace('\\','/'))
        if '--history' in sys.argv and (ROOT/'.private/history').exists():tar.add(ROOT/'.private/history',arcname='shared/history')
    s=c.open_sftp();s.put(str(package),REMOTE+'/deploy.tar.gz');s.close()
    run(c,f'cd {REMOTE} && tar -xzf deploy.tar.gz && chmod 700 shared/history')
def environments(c):
    saved=json.loads((ROOT/'.private/deployment.json').read_text())
    if 'redis_password' not in saved:
        saved['redis_password']=secrets.token_hex(32)
        (ROOT/'.private/deployment.json').write_text(json.dumps(saved))
    def parse(file):return dict(line.split('=',1) for line in file.read_text().splitlines() if '=' in line and not line.startswith('#'))
    backend=parse(ROOT/'apps/backend/.env')
    backend.update(NODE_ENV='production',HOST='127.0.0.1',PORT='9055',DATABASE_URL='postgres://d4u_medusa_app:'+saved['database_password']+'@127.0.0.1:5432/d4u_medusa',REDIS_URL='redis://:'+saved['redis_password']+'@127.0.0.1:6389/0',WORDPRESS_IMPORT_FILE=REMOTE+'/shared/medusa-import.json',WORDPRESS_HISTORY_DIR=REMOTE+'/shared/history',STORE_CORS='https://testmedusa.365d4u.com',ADMIN_CORS='https://testmedusa.365d4u.com',AUTH_CORS='https://testmedusa.365d4u.com',STOREFRONT_URL='https://testmedusa.365d4u.com',PUBLIC_BACKEND_URL='https://testmedusa.365d4u.com')
    frontend=parse(ROOT/'apps/storefront/.env')
    frontend.pop('REVIEW_MEDIA_DIR',None)
    frontend.update(NODE_ENV='production',PORT='8100',HOST='127.0.0.1',COOKIE_SECURE='true',MEDUSA_BACKEND_URL='http://127.0.0.1:9055',PAYPAL_CLIENT_ID=backend.get('PAYPAL_CLIENT_ID',''),OCEAN_ENVIRONMENT=backend.get('OCEAN_ENVIRONMENT','sandbox'),COS_MEDIA_BASE_URL=backend['COS_PUBLIC_URL'].rstrip('/')+'/'+backend['COS_PREFIX'])
    s=c.open_sftp()
    for name,data in [('backend',backend),('storefront',frontend)]:
        file=REMOTE+'/apps/'+name+'/.env'
        with s.file(file,'w') as f:f.write('\n'.join(k+'='+v for k,v in data.items())+'\n')
        s.chmod(file,0o600)
    s.close()

def infrastructure(c):
    saved=json.loads((ROOT/'.private/deployment.json').read_text())
    run(c,f'id d4umedusa >/dev/null 2>&1 || useradd --system --home {REMOTE} --shell /usr/sbin/nologin d4umedusa')
    run(c,f'mkdir -p {REMOTE}/shared/redis && chown d4umedusa:d4umedusa {REMOTE}/shared/redis')
    redis=f'bind 127.0.0.1\nport 6389\nprotected-mode yes\nrequirepass {saved["redis_password"]}\ndir {REMOTE}/shared/redis\nappendonly yes\nmaxmemory 192mb\nmaxmemory-policy noeviction\ndaemonize no\n'
    s=c.open_sftp()
    with s.file(REMOTE+'/shared/redis.conf','w') as f:f.write(redis)
    s.chmod(REMOTE+'/shared/redis.conf',0o600)
    definitions={
        'd4u-medusa-redis':('Dedicated Medusa Redis',REMOTE+'/shared','/usr/bin/redis-server '+REMOTE+'/shared/redis.conf',''),
        'd4u-medusa-backend':('365D4U Medusa Backend',REMOTE+'/apps/backend/.medusa/server','/usr/bin/node '+REMOTE+'/apps/backend/node_modules/@medusajs/cli/cli.js start --host 127.0.0.1 --port 9055',REMOTE+'/apps/backend/.env'),
        'd4u-medusa-storefront':('365D4U Storefront',REMOTE+'/apps/storefront','/usr/bin/node src/server.mjs',REMOTE+'/apps/storefront/.env'),
    }
    for name,(description,cwd,command,env) in definitions.items():
        service=f'[Unit]\nDescription={description}\nAfter=network.target postgresql.service d4u-medusa-redis.service\n\n[Service]\nType=simple\nUser=d4umedusa\nGroup=d4umedusa\nWorkingDirectory={cwd}\nExecStart={command}\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\n'
        if name=='d4u-medusa-redis':service=service.replace(' d4u-medusa-redis.service','')
        if env:service+=f'EnvironmentFile={env}\n'
        service+='\n[Install]\nWantedBy=multi-user.target\n'
        with s.file('/etc/systemd/system/'+name+'.service','w') as f:f.write(service)
    s.close()
    run(c,f'chown d4umedusa:d4umedusa {REMOTE}/shared/redis.conf && systemctl daemon-reload && systemctl enable --now d4u-medusa-redis')

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf8')
    c=connect()
    try:
        upload(c,'--build' in sys.argv);environments(c)
        infrastructure(c)
        print('Uploaded application and private configuration')
        if '--upload-only' in sys.argv:sys.exit(0)
        print(run(c,f'cd {REMOTE}/apps/backend && npm install --no-audit --no-fund > {REMOTE}/npm-install.log 2>&1 && nohup sh -c "npx medusa exec ./src/scripts/configure-store.ts && npx medusa exec ./src/scripts/import-history.ts" > {REMOTE}/import-history.log 2>&1 < /dev/null &'))
    finally:c.close()
