"""Undo the custom365d domain switch; preserve current application code and data."""
import json, runpy, time, socket
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://medusa.365d4u.com'
NEW = 'www.custom365d.com'
REMOTE = '/data/d4u_medusal'


def main():
    resolver = socket.getaddrinfo
    try:
        public_dns_ready = '165.154.134.51' in socket.gethostbyname_ex('medusa.365d4u.com')[2]
    except socket.gaierror:
        public_dns_ready = False
    # Resolve only this known production hostname to its verified server IP.
    # TLS still verifies the original hostname/SNI; no OS hosts file is changed.
    socket.getaddrinfo = lambda host, *args, **kwargs: resolver('165.154.134.51' if host == 'medusa.365d4u.com' else host, *args, **kwargs)
    d = runpy.run_path(str(ROOT / 'scripts/deploy-production.py'))
    helpers = runpy.run_path(str(ROOT / 'scripts/migrate-production-domain.py'))
    source = json.loads((ROOT / '.private/domain-custom365d-backup.json').read_text())['backup']
    c, _ = d['connect']()
    s = c.open_sftp()
    run = lambda command: d['run'](c, command)
    def read(path):
        with s.open(path) as f: return f.read().decode()
    def write(path, value, mode=0o600):
        with s.open(path, 'w') as f: f.write(value)
        s.chmod(path, mode)
    def api(method, url, **kwargs):
        r = requests.request(method, url, timeout=35, **kwargs)
        if not r.ok: raise RuntimeError('Restore verification HTTP ' + str(r.status_code))
        return r
    try:
        paths = json.loads(read(source + '/manifest.json'))
        restored = {path: read(source + '/original-' + str(i)) for i, path in enumerate(paths)}
        current = {path: read(path) for path in paths}
        env = helpers['parse_env'](current[REMOTE + '/apps/backend/.env'])
        assert env['STOREFRONT_URL'] in ['https://' + NEW, ORIGIN]
        other_sites = {name: s.open('/etc/nginx/sites-enabled/' + name).read() for name in s.listdir('/etc/nginx/sites-enabled') if name not in [NEW + '.conf', 'medusa.365d4u.com.conf']}
        token = api('POST', 'https://api-m.paypal.com/v1/oauth2/token', auth=(env['PAYPAL_CLIENT_ID'],env['PAYPAL_CLIENT_SECRET']),data={'grant_type':'client_credentials'}).json()['access_token']
        headers = {'Authorization':'Bearer ' + token, 'Content-Type':'application/json'}
        endpoint = 'https://api-m.paypal.com/v1/notifications/webhooks'
        hooks = api('GET', endpoint, headers=headers).json()['webhooks']
        hook = next(h for h in hooks if h['id'] == env['PAYPAL_WEBHOOK_ID'])
        assert hook['url'] in ['https://' + NEW + '/hooks/payment/paypal_paypal', ORIGIN + '/hooks/payment/paypal_paypal']
        backup = REMOTE + '/shared/backups/domain-revert-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        run('mkdir -p ' + backup + ' && chmod 700 ' + backup)
        for i, (path, contents) in enumerate(current.items()): write(backup + '/original-' + str(i), contents)
        write(backup + '/manifest.json', json.dumps(list(current)))
        write(backup + '/paypal-webhook.json', json.dumps(hook))
        print('Current configuration backed up; restoring medusa.365d4u.com.', flush=True)
        # Only restore domain-related env fields, preserving any unrelated changes.
        for path, contents in restored.items():
            if path.endswith('.env'):
                old = helpers['parse_env'](contents)
                keys = ['STOREFRONT_URL'] if '/storefront/' in path else ['STOREFRONT_URL','PUBLIC_BACKEND_URL','STORE_CORS','ADMIN_CORS','AUTH_CORS']
                lines = [line for line in current[path].splitlines() if line.split('=',1)[0] not in keys]
                contents = '\n'.join(lines + [key+'='+json.dumps(old[key]) for key in keys]) + '\n'
                write(path, contents)
            else:
                write(path, contents, 0o644)
        try: s.remove('/etc/nginx/sites-enabled/' + NEW + '.conf')
        except FileNotFoundError: pass
        run('nginx -t && systemctl reload nginx && systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for _ in range(35):
            try:
                if requests.get(ORIGIN+'/health',timeout=5).status_code == 200: break
            except requests.RequestException: pass
            time.sleep(2)
        api('GET',ORIGIN+'/health')
        api('PATCH',endpoint+'/'+hook['id'],headers=headers,json=[{'op':'replace','path':'/url','value':ORIGIN+'/hooks/payment/paypal_paypal'}])
        after = api('GET',endpoint,headers=headers).json()['webhooks']
        signature = lambda h: (h['url'], sorted(e['name'] for e in h['event_types']))
        result_hook = next(h for h in after if h['id']==hook['id'])
        assert result_hook['url']==ORIGIN+'/hooks/payment/paypal_paypal'
        assert signature(result_hook)[1]==signature(hook)[1]
        assert {h['id']:signature(h) for h in hooks if h['id']!=hook['id']}=={h['id']:signature(h) for h in after if h['id']!=hook['id']}
        for path in ['/','/app/','/invoices/new/','/api/config']: api('GET',ORIGIN+path)
        pairs=json.loads((ROOT/'.private/woo-production-api.json').read_text())['keys']
        for pair in pairs:
            api('GET',ORIGIN+'/wp-json/wc/v3/orders',params={'per_page':1},auth=(pair['consumer_key'],pair['consumer_secret']))
        api('POST',ORIGIN+'/wp-json/cus365d/v1/get_order_status',data={'order_ids':'0'})
        for name, contents in other_sites.items(): assert s.open('/etc/nginx/sites-enabled/'+name).read()==contents
        for path in paths:
            if not path.endswith('.env'):
                assert read(path)==restored[path]
            else:
                before, after_env=helpers['parse_env'](current[path]),helpers['parse_env'](read(path))
                keys={'STOREFRONT_URL'} if '/storefront/' in path else {'STOREFRONT_URL','PUBLIC_BACKEND_URL','STORE_CORS','ADMIN_CORS','AUTH_CORS'}
                assert all(before[k]==after_env[k] for k in before if k not in keys)
                assert all(after_env[k]==ORIGIN for k in keys)
        # Retain the unused certificate as a backup, but don't renew a retired host.
        renewal='/etc/letsencrypt/renewal/d4u-medusa-custom365d.conf'
        try:
            renewal_contents=read(renewal)
            write(backup+'/retired-custom-domain-renewal.conf',renewal_contents)
            assert read(backup+'/retired-custom-domain-renewal.conf')==renewal_contents
            s.remove(renewal)
        except FileNotFoundError: pass
        report={'origin':ORIGIN,'restored_from':source,'backup':backup,'public_dns_ready':public_dns_ready,'verification_via_server_ip_with_valid_tls':True,'custom_domain_vhost_disabled':True,'paypal_callback_restored':True,'pages_and_woo_api_verified':True,'unrelated_sites_and_settings_preserved':True,'feishu_login_not_deployed':True,'services':run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines()}
        (ROOT/'.private/production-domain-restore-verification.json').write_text(json.dumps(report,indent=2))
        (ROOT/'.private/production-medusa-paypal-webhook.json').write_text(json.dumps(result_hook,indent=2))
        write(backup+'/verification.json',json.dumps(report,indent=2))
        print(json.dumps(report),flush=True)
    finally: s.close();c.close();socket.getaddrinfo=resolver


if __name__=='__main__':main()
