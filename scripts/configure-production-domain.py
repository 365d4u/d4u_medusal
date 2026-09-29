"""Publish only the Medusa virtual host. Existing WordPress routing is preserved."""
import json,runpy,shlex,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HOST='medusa.365d4u.com'
CERT_NAME='medusa.365d4u.com'
REMOTE='/data/d4u_medusal'
deploy=runpy.run_path(str(ROOT/'scripts/deploy-production.py'))

def main():
    client,_=deploy['connect']();run=deploy['run'];s=client.open_sftp()
    try:
        target='/etc/nginx/sites-available/'+HOST+'.conf'
        try:
            original=s.open(target).read()
            (ROOT/'.private/medusa-nginx-before-domain.conf').write_bytes(original)
        except FileNotFoundError:pass
        run(client,'mkdir -p '+REMOTE+'/shared/acme/.well-known/acme-challenge')
        if '--http-only' in sys.argv:
            conf='server { listen 80; server_name '+HOST+'; location ^~ /.well-known/acme-challenge/ { root '+REMOTE+'/shared/acme; } location / { return 503; } }\n'
        else:
            run(client,'test -f /etc/letsencrypt/live/'+CERT_NAME+'/fullchain.pem')
            conf=runpy.run_path(str(ROOT/'scripts/configure-nginx.py'))['conf']
            conf=conf.replace('testmedusa.365d4u.com',HOST).replace('/var/www/d4u_medusa',REMOTE).replace('d4u_auth','d4u_prod_auth').replace('d4u_invoice','d4u_prod_invoice')
            conf=conf.replace('/live/'+HOST+'/', '/live/'+CERT_NAME+'/')
        with s.open(target,'w') as f:f.write(conf)
        run(client,'ln -sfn '+shlex.quote(target)+' /etc/nginx/sites-enabled/'+HOST+'.conf && nginx -t && systemctl reload nginx')
        if '--http-only' not in sys.argv:
            origin='https://'+HOST
            for app in ['backend','storefront']:
                file=REMOTE+'/apps/'+app+'/.env';old=s.open(file).read().decode()
                with s.open(file+'.before-domain','w') as f:f.write(old)
                s.chmod(file+'.before-domain',0o600)
                values={'STOREFRONT_URL':origin}
                if app=='backend':values.update(PUBLIC_BACKEND_URL=origin,STORE_CORS=origin,ADMIN_CORS=origin,AUTH_CORS=origin)
                lines=[l for l in old.splitlines() if l.split('=',1)[0] not in values]
                with s.open(file,'w') as f:f.write('\n'.join(lines+[k+'='+json.dumps(v) for k,v in values.items()])+'\n')
                s.chmod(file,0o600)
            hook='/etc/letsencrypt/renewal-hooks/deploy/d4u-medusa-nginx.sh'
            with s.open(hook,'w') as f:f.write('#!/bin/sh\nset -eu\n/usr/sbin/nginx -t\n/bin/systemctl reload nginx\n')
            s.chmod(hook,0o755)
            run(client,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        print('Configured '+HOST+(' HTTP certificate challenge' if '--http-only' in sys.argv else ' HTTPS and application origins'))
    finally:s.close();client.close()

if __name__=='__main__':main()
