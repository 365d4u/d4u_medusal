"""Switch the existing production vhost and origins without deploying app code or data.

Retires the old domain with HTTP 410, without redirects or API compatibility.
Backs up environments/vhosts and restores them (and the PayPal URL) on failure.
"""
import argparse, hashlib, json, re, runpy, shlex, socket, time
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
REMOTE = '/data/d4u_medusal'
OLD = 'medusa.365d4u.com'
NEW = 'www.custom365d.com'
ORIGIN = 'https://' + NEW
CERT_NAME = 'd4u-medusa-custom365d'
VHOST = '/etc/nginx/sites-available/'
ENABLED = '/etc/nginx/sites-enabled/'


def parse_env(text):
    values = {}
    for line in text.splitlines():
        if '=' not in line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        try:
            values[key] = json.loads(value)
        except ValueError:
            values[key] = value.strip('\"\'')
    return values


def request(method, url, **kwargs):
    response = requests.request(method, url, timeout=40, **kwargs)
    if not response.ok:
        # URLs can contain auth or customer keys, so do not expose request details.
        raise RuntimeError('Domain migration HTTP check failed: ' + str(response.status_code))
    return response


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    deploy = runpy.run_path(str(ROOT / 'scripts/deploy-production.py'))
    client, cfg = deploy['connect']()
    run = lambda command: deploy['run'](client, command)
    s = client.open_sftp()
    originals = {}
    changed = False
    hook_attempted = False
    paypal_headers = None
    hook_before = None

    def read(path):
        with s.open(path) as f:
            return f.read().decode()

    def write(path, text, mode=0o644):
        with s.open(path, 'w') as f:
            f.write(text)
        s.chmod(path, mode)

    try:
        assert '165.154.134.51' in socket.gethostbyname_ex(NEW)[2], 'DNS mismatch'
        assert '165.154.134.51' in run('getent ahostsv4 ' + NEW), 'Server DNS mismatch'
        # Refuse to overwrite an active site. Back up the old disabled WP definition.
        try:
            s.stat(ENABLED + NEW + '.conf')
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError('New domain vhost is already enabled; inspect before rerunning')
        try:
            originals[VHOST + NEW + '.conf'] = read(VHOST + NEW + '.conf')
        except FileNotFoundError:
            pass
        old_conf = read(VHOST + OLD + '.conf')
        assert '# D4U WOO COMPAT START' in old_conf
        originals[VHOST + OLD + '.conf'] = old_conf
        for app in ['backend', 'storefront']:
            path = REMOTE + '/apps/' + app + '/.env'
            originals[path] = read(path)
        env = parse_env(originals[REMOTE + '/apps/backend/.env'])
        assert env['STOREFRONT_URL'] == 'https://' + OLD
        assert env['PAYPAL_ENVIRONMENT'] == 'production'
        # Keep snapshots of other sites for a byte-for-byte post-change check.
        other_sites = {name: s.open(ENABLED + name).read() for name in s.listdir(ENABLED) if name != OLD + '.conf'}
        token = request('POST', 'https://api-m.paypal.com/v1/oauth2/token',
                        auth=(env['PAYPAL_CLIENT_ID'], env['PAYPAL_CLIENT_SECRET']),
                        data={'grant_type': 'client_credentials'}).json()['access_token']
        paypal_headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
        paypal_api = 'https://api-m.paypal.com/v1/notifications/webhooks'
        hooks_before = request('GET', paypal_api, headers=paypal_headers).json()['webhooks']
        hook_before = next(h for h in hooks_before if h['id'] == env['PAYPAL_WEBHOOK_ID'])
        assert hook_before['url'] == 'https://' + OLD + '/hooks/payment/paypal_paypal'
        print('DNS, current origins, production PayPal webhook and site isolation verified.', flush=True)
        if not args.apply:
            return

        stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
        backup = REMOTE + '/shared/backups/domain-custom365d-' + stamp
        run('mkdir -p ' + backup + ' && chmod 700 ' + backup)
        for index, (path, contents) in enumerate(originals.items()):
            write(backup + '/original-' + str(index), contents, 0o600)
        write(backup + '/manifest.json', json.dumps(list(originals)), 0o600)
        write(backup + '/paypal-webhook.json', json.dumps(hook_before), 0o600)
        (ROOT / '.private/domain-custom365d-backup.json').write_text(json.dumps({'backup': backup, 'paths': list(originals)}))
        changed = True
        run('mkdir -p ' + REMOTE + '/shared/acme/.well-known/acme-challenge')
        challenge = 'server { listen 80; server_name ' + NEW + '; location ^~ /.well-known/acme-challenge/ { root ' + REMOTE + '/shared/acme; } location / { return 503; } }\n'
        write(VHOST + NEW + '.conf', challenge)
        run('ln -s ' + VHOST + NEW + '.conf ' + ENABLED + NEW + '.conf && nginx -t && systemctl reload nginx')
        challenge_path = REMOTE + '/shared/acme/.well-known/acme-challenge/d4u-domain-preflight'
        write(challenge_path, stamp)
        assert request('GET', 'http://' + NEW + '/.well-known/acme-challenge/d4u-domain-preflight').text == stamp
        s.remove(challenge_path)
        print('Issuing HTTPS certificate for ' + NEW, flush=True)
        run('certbot certonly --webroot -w ' + REMOTE + '/shared/acme -d ' + NEW + ' --cert-name ' + CERT_NAME + ' --non-interactive --agree-tos --keep-until-expiring')
        new_conf = old_conf.replace(OLD, NEW).replace('/live/' + NEW + '/', '/live/' + CERT_NAME + '/')
        write(VHOST + NEW + '.conf', new_conf)
        old_retired = '''server {
    listen 80;
    server_name OLD;
    access_log off;
    location ^~ /.well-known/acme-challenge/ { root ROOT/shared/acme; }
    location / { return 410; }
}
server {
    listen 443 ssl http2;
    server_name OLD;
    ssl_certificate /etc/letsencrypt/live/OLD/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/OLD/privkey.pem;
    access_log off;
    add_header X-Robots-Tag "noindex, nofollow" always;
    # Explicitly retired: no application proxy, redirect or callback compatibility.
    location / { return 410; }
}
'''.replace('OLD', OLD).replace('ROOT', REMOTE)
        write(VHOST + OLD + '.conf', old_retired)
        # Test before activating; both vhosts refer to the single existing rate-limit zones.
        run('nginx -t && systemctl reload nginx')
        assert request('GET', ORIGIN + '/health').status_code == 200
        for app in ['backend', 'storefront']:
            path = REMOTE + '/apps/' + app + '/.env'
            values = {'STOREFRONT_URL': ORIGIN}
            if app == 'backend':
                values.update(PUBLIC_BACKEND_URL=ORIGIN, STORE_CORS=ORIGIN, ADMIN_CORS=ORIGIN, AUTH_CORS=ORIGIN)
            lines = [line for line in originals[path].splitlines() if line.split('=', 1)[0] not in values]
            write(path, '\n'.join(lines + [key + '=' + json.dumps(value) for key, value in values.items()]) + '\n', 0o600)
        print('HTTPS ready; switching application origins and restarting Medusa services.', flush=True)
        run('systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for attempt in range(40):
            try:
                if requests.get(ORIGIN + '/health', timeout=5).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(2)
        request('GET', ORIGIN + '/health')
        # Keep the webhook ID and event subscription unchanged for signature verification.
        hook_attempted = True
        request('PATCH', paypal_api + '/' + hook_before['id'], headers=paypal_headers,
                json=[{'op': 'replace', 'path': '/url', 'value': ORIGIN + '/hooks/payment/paypal_paypal'}])
        hooks_after = request('GET', paypal_api, headers=paypal_headers).json()['webhooks']
        updated_hook = next(h for h in hooks_after if h['id'] == hook_before['id'])
        assert updated_hook['url'] == ORIGIN + '/hooks/payment/paypal_paypal'
        def hook_subscription(h):
            return (h['url'], sorted(e['name'] for e in h['event_types']))
        assert hook_subscription(updated_hook)[1] == hook_subscription(hook_before)[1]
        # PayPal can reorder the returned list and HATEOAS links after an update.
        assert {h['id']: hook_subscription(h) for h in hooks_before if h['id'] != hook_before['id']} == {h['id']: hook_subscription(h) for h in hooks_after if h['id'] != hook_before['id']}
        report = {'origin': ORIGIN, 'backup': backup, 'https': True, 'paypal_webhook_updated': True,
                  'other_paypal_webhooks_preserved': True, 'no_orders_or_payments_created': True}
        for path in ['/', '/health', '/app/', '/invoices/new/', '/api/config']:
            assert request('GET', ORIGIN + path).status_code == 200
        for scheme in ['http', 'https']:
            for path in ['/', '/checkout/order-pay/200000/?key=domain-check', '/wp-json/wc/v3/orders', '/hooks/payment/paypal_paypal', '/webhooks/oceanpayment']:
                response = requests.get(scheme + '://' + OLD + path, timeout=30, allow_redirects=False)
                assert response.status_code == 410 and 'Location' not in response.headers
        pair = json.loads((ROOT / '.private/woo-production-api.json').read_text())['keys'][0]
        for base in [ORIGIN]:
            response = request('GET', base + '/wp-json/wc/v3/orders', params={'per_page': 1},
                               auth=(pair['consumer_key'], pair['consumer_secret']), allow_redirects=False)
            assert response.status_code == 200 and 'X-WP-Total' in response.headers
        response = request('GET', ORIGIN + '/wp-json/cus365d/v1/get_order_status', params={'order_ids': '0'})
        assert response.status_code == 200
        report.update(pages_and_woo_api_verified=True, old_domain_retired_http_410=True, old_domain_compatibility=False)
        for path, old in originals.items():
            if not path.endswith('.env'):
                continue
            before, after = parse_env(old), parse_env(read(path))
            expected = {'STOREFRONT_URL'} if '/storefront/' in path else {'STOREFRONT_URL', 'PUBLIC_BACKEND_URL', 'STORE_CORS', 'ADMIN_CORS', 'AUTH_CORS'}
            assert {k for k in set(before) | set(after) if before.get(k) != after.get(k)} == expected
            assert all(after[k] == ORIGIN for k in expected)
        for name, previous in other_sites.items():
            assert s.open(ENABLED + name).read() == previous, 'Unrelated vhost changed'
        report['unrelated_sites_and_env_preserved'] = True
        report['services'] = run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines()
        report['certificate'] = run('openssl x509 -in /etc/letsencrypt/live/' + CERT_NAME + '/fullchain.pem -noout -dates -ext subjectAltName').strip()
        run('test -x /etc/letsencrypt/renewal-hooks/deploy/d4u-medusa-nginx.sh')
        report['renewal_reload_hook'] = True
        (ROOT / '.private/production-custom-domain-verification.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        (ROOT / '.private/production-medusa-paypal-webhook.json').write_text(json.dumps(updated_hook, indent=2), encoding='utf8')
        write(backup + '/verification.json', json.dumps(report, indent=2), 0o600)
        print(json.dumps(report), flush=True)
    except Exception:
        if changed:
            print('Restoring previous Medusa origins and vhost after failed verification.', flush=True)
            # Restore the URL even if a timed-out PATCH may have succeeded remotely.
            if hook_attempted:
                request('PATCH', 'https://api-m.paypal.com/v1/notifications/webhooks/' + hook_before['id'], headers=paypal_headers,
                        json=[{'op': 'replace', 'path': '/url', 'value': hook_before['url']}])
            for path, contents in originals.items():
                write(path, contents, 0o600 if path.endswith('.env') else 0o644)
            remove_paths = [ENABLED + NEW + '.conf']
            if VHOST + NEW + '.conf' not in originals:
                remove_paths.append(VHOST + NEW + '.conf')
            for path in remove_paths:
                try:
                    s.remove(path)
                except FileNotFoundError:
                    pass
            run('nginx -t && systemctl reload nginx && systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        raise
    finally:
        s.close()
        client.close()


if __name__ == '__main__':
    main()
