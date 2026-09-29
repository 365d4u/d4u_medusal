"""Stage the explicitly requested Medusa production host; never switches Nginx/DNS.

Secrets are read from .private/production-deployment.json, never packaged publicly.
The first deployment imports WordPress data into the previously verified empty DB.
Payment providers and paid notifications remain disabled until production cutover.
"""
import json, os, secrets, shlex, tarfile
from pathlib import Path
from urllib.parse import quote
import paramiko

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/data/d4u_medusal'
RUNTIME=REMOTE+'/shared/runtime/node-v22.22.2-linux-x64/bin'
REDIS=REMOTE+'/shared/runtime/redis-7.2.16/src/redis-server'

def connect():
    cfg=json.loads((ROOT/'.private/production-deployment.json').read_text(encoding='utf8'))
    client=paramiko.SSHClient();client.load_system_host_keys();client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(cfg['host'],port=cfg['port'],username=cfg['user'],password=cfg['password'],timeout=30)
    client.get_transport().set_keepalive(30)
    return client,cfg

def run(client,command):
    _,out,err=client.exec_command(command,timeout=900)
    text=out.read().decode();error=err.read().decode()
    if out.channel.recv_exit_status():raise RuntimeError((error+text)[-1500:])
    return text

def package():
    archive=ROOT/'.private/production-release.tar.gz'
    with tarfile.open(archive,'w:gz') as tar:
        for app in ['backend','storefront']:
            for base,dirs,files in os.walk(ROOT/'apps'/app):
                dirs[:]=[d for d in dirs if d not in ['node_modules','.git','.next']]
                for name in files:
                    if name.startswith('.env') or name.endswith('.log'):continue
                    file=Path(base)/name;tar.add(file,arcname=str(file.relative_to(ROOT)).replace('\\','/'))
        tar.add(ROOT/'.private/production-import/medusa-import.json',arcname='shared/medusa-import.json')
        tar.add(ROOT/'.private/production-import/history',arcname='shared/history')
    return archive

def main():
    client,cfg=connect()
    try:
        run(client,'test -x '+RUNTIME+'/node && test -x '+REDIS+' && test -d '+REMOTE)
        archive=package();sftp=client.open_sftp();sftp.put(str(archive),REMOTE+'/production-release.tar.gz');sftp.chmod(REMOTE+'/production-release.tar.gz',0o600);sftp.close()
        run(client,'cd '+REMOTE+' && tar -xzf production-release.tar.gz && chmod 700 shared/history')
        run(client,'id d4umedusa >/dev/null 2>&1 || useradd --system --home '+REMOTE+' --shell /usr/sbin/nologin d4umedusa')
        for name in ['jwt_secret','cookie_secret','redis_password','session_secret','admin_password']:
            cfg.setdefault(name,secrets.token_hex(24))
        (ROOT/'.private/production-deployment.json').write_text(json.dumps(cfg),encoding='utf8')
        database_url='postgres://'+quote(cfg['database_user'],safe='')+':'+quote(cfg['database_password'],safe='')+'@'+cfg['database_host']+':5432/'+cfg['database_name']+'?sslmode=disable'
        origin='https://medusa.365d4u.com'
        backend=dict(NODE_ENV='production',HOST='127.0.0.1',PORT='9055',DATABASE_URL=database_url,REDIS_URL='redis://:'+cfg['redis_password']+'@127.0.0.1:6389/0',JWT_SECRET=cfg['jwt_secret'],COOKIE_SECRET=cfg['cookie_secret'],STOREFRONT_URL=origin,PUBLIC_BACKEND_URL=origin,STORE_CORS=origin,ADMIN_CORS=origin,AUTH_CORS=origin,WORDPRESS_IMPORT_FILE=REMOTE+'/shared/medusa-import.json',WORDPRESS_HISTORY_DIR=REMOTE+'/shared/history',ADMIN_BOOTSTRAP_FILE=REMOTE+'/shared/admin-bootstrap.json',PAYPAL_ENABLED='false',OCEAN_ENABLED='false',APPLEPAY_ENABLED='false',BUSINESS_ENVIRONMENT='production',PAID_NOTIFICATIONS_ENABLED='false',OCEAN_LIMIT_ENABLED='true',OCEAN_ORDER_LIMIT='1000')
        frontend=dict(NODE_ENV='production',HOST='127.0.0.1',PORT='8100',MEDUSA_BACKEND_URL='http://127.0.0.1:9055',MEDUSA_PUBLISHABLE_KEY='',COOKIE_SECURE='true',COOKIE_SECRET=cfg['session_secret'],STOREFRONT_URL=origin,CHECKOUT_ENABLED='false',APPLEPAY_ENABLED='false',OCEAN_ENVIRONMENT='production',REVIEW_MEDIA_DIR=REMOTE+'/shared/review-media')
        sftp=client.open_sftp()
        with sftp.open(REMOTE+'/shared/admin-bootstrap.json','w') as f:f.write(json.dumps({'email':'admin@365d4u.com','password':cfg['admin_password']}))
        sftp.chmod(REMOTE+'/shared/admin-bootstrap.json',0o600)
        for app,env in [('backend',backend),('storefront',frontend)]:
            destination=REMOTE+'/apps/'+app+'/.env'
            # Re-runs must not overwrite a completed environment or payment configuration.
            try:sftp.stat(destination)
            except FileNotFoundError:
                with sftp.open(destination,'w') as file:file.write('\n'.join(k+'='+json.dumps(v) for k,v in env.items())+'\n')
                sftp.chmod(destination,0o600)
        run(client,'mkdir -p '+REMOTE+'/shared/redis '+REMOTE+'/shared/review-media')
        redis='bind 127.0.0.1\nport 6389\nprotected-mode yes\nrequirepass '+cfg['redis_password']+'\ndir '+REMOTE+'/shared/redis\nappendonly yes\nmaxmemory 192mb\nmaxmemory-policy noeviction\ndaemonize no\n'
        with sftp.open(REMOTE+'/shared/redis.conf','w') as f:f.write(redis)
        sftp.chmod(REMOTE+'/shared/redis.conf',0o600)
        definitions={
            'd4u-medusa-redis':(REMOTE+'/shared',REDIS+' '+REMOTE+'/shared/redis.conf',None),
            'd4u-medusa-backend':(REMOTE+'/apps/backend/.medusa/server',RUNTIME+'/node '+REMOTE+'/apps/backend/node_modules/@medusajs/cli/cli.js start --host 127.0.0.1 --port 9055',REMOTE+'/apps/backend/.env'),
            'd4u-medusa-storefront':(REMOTE+'/apps/storefront',RUNTIME+'/node src/server.mjs',REMOTE+'/apps/storefront/.env'),
        }
        for name,(cwd,command,env) in definitions.items():
            service='[Unit]\nDescription=365D4U Medusa '+name+'\nAfter=network.target'+(' d4u-medusa-redis.service' if env else '')+'\n\n[Service]\nType=simple\nUser=d4umedusa\nGroup=d4umedusa\nWorkingDirectory='+cwd+'\nExecStart='+command+'\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nEnvironment=PATH='+RUNTIME+':/usr/local/bin:/usr/bin:/bin\n'
            if env:service+='EnvironmentFile='+env+'\n'
            service+='\n[Install]\nWantedBy=multi-user.target\n'
            with sftp.open('/etc/systemd/system/'+name+'.service','w') as f:f.write(service)
        bootstrap='''set -eu
export PATH="RUNTIME:$PATH"
cd REMOTE/apps/backend
npm ci --omit=dev --no-audit --no-fund
cd REMOTE/apps/storefront
npm ci --omit=dev --no-audit --no-fund
cd REMOTE/apps/backend/.medusa/server
ln -sfn ../../node_modules node_modules
CLI=REMOTE/apps/backend/node_modules/@medusajs/cli/cli.js
ENV=REMOTE/apps/backend/.env
node --env-file="$ENV" "$CLI" db:migrate
node --env-file="$ENV" "$CLI" exec ./src/scripts/import-wordpress.js
node --env-file="$ENV" "$CLI" exec ./src/scripts/configure-store.js
node --env-file="$ENV" "$CLI" exec ./src/scripts/import-history.js
node --env-file="$ENV" "$CLI" exec ./src/scripts/import-wishlists.js
node --env-file="$ENV" "$CLI" exec ./src/scripts/set-order-number-start.js
node --env-file="$ENV" "$CLI" exec ./src/scripts/create-test-admin.js
touch REMOTE/shared/bootstrap-complete
'''.replace('RUNTIME',RUNTIME).replace('REMOTE',REMOTE)
        with sftp.open(REMOTE+'/shared/bootstrap.sh','w') as f:f.write(bootstrap)
        sftp.close()
        run(client,'mkdir -p '+REMOTE+'/.npm '+REMOTE+'/.cache '+REMOTE+'/.config && chown -R d4umedusa:d4umedusa '+REMOTE+'/.npm '+REMOTE+'/.cache '+REMOTE+'/.config')
        run(client,'chown -R d4umedusa:d4umedusa '+REMOTE+'/apps '+REMOTE+'/shared && systemctl daemon-reload && systemctl enable --now d4u-medusa-redis')
        run(client,"nohup runuser -u d4umedusa -- bash "+REMOTE+'/shared/bootstrap.sh > '+REMOTE+'/bootstrap.log 2>&1 < /dev/null &')
        print('Production application uploaded; database migrations and WordPress import running. Public routing unchanged.')
    finally:client.close()

if __name__=='__main__':main()
