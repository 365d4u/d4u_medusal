"""Scoped TEST deployment of payment connections and the /admin entry alias.

Default: read-only preflight. --apply: back up, publish, verify, or roll back.
Uses the existing DEPLOY_SSH_PASSWORD connector; never rewrites environment files.
"""
import argparse
import hashlib
import json
import re
import runpy
import shlex
import subprocess
import tarfile
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
REMOTE = '/var/www/d4u_medusa'
ORIGIN = 'https://testmedusa.365d4u.com'
NGINX = '/etc/nginx/sites-available/testmedusa.365d4u.com.conf'
BACKEND = [
    'api/admin/store-management/[section]/route.ts', 'api/store/payment-policy/route.ts',
    'api/webhooks/oceanpayment/route.ts', 'lib/invoices.ts', 'lib/staff-access.ts',
    'lib/store-management.ts', 'lib/payment-connections.ts',
    'modules/oceanpayment/index.ts', 'modules/oceanpayment/service.ts', 'modules/paypal/service.ts',
]
SOURCES = ['apps/backend/src/' + p for p in BACKEND] + [
    'apps/backend/medusa-config.ts', 'apps/backend/src/admin/routes/store-settings/page.tsx',
    'apps/backend/src/admin/lib/payment-connections.tsx', 'apps/storefront/src/server.mjs',
    'apps/storefront/src/invoice-routes.mjs', 'apps/storefront/public/assets/invoice-payment.js',
]
FILES = SOURCES + ['apps/backend/.medusa/server/src/' + p.replace('.ts', '.js') for p in BACKEND] + [
    'apps/backend/.medusa/server/medusa-config.js', 'apps/backend/.medusa/server/public/admin',
]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def parse_env(raw):
    result = {}
    for line in raw.decode().splitlines():
        if '=' not in line or line.lstrip().startswith('#'):
            continue
        key, value = line.split('=', 1)
        try:
            result[key] = json.loads(value)
        except ValueError:
            result[key] = value.strip().strip("'")
    return result


def nginx_with_entry(raw):
    text = raw.decode()
    for entry in ['/admin', '/admin/']:
        match = re.search(r'location\s+=\s+' + re.escape(entry) + r'\s*\{([^{}]*)\}', text)
        if match and not re.fullmatch(r'\s*return\s+302\s+/app/;\s*', match.group(1)):
            raise RuntimeError('Conflicting existing admin entry in test Nginx')
    additions = ''.join('    location = ' + entry + ' { return 302 /app/; }\n' for entry in ['/admin', '/admin/'] if not re.search(r'location\s+=\s+' + re.escape(entry) + r'\s*\{', text))
    if additions:
        anchor = '    location = /app/invoices {'
        if text.count(anchor) != 1:
            raise RuntimeError('Cannot locate the test HTTPS admin entry')
        text = text.replace(anchor, additions + anchor, 1)
    return text.encode()


def baseline(path):
    backend = path.startswith('apps/backend/')
    cwd = ROOT / 'apps/backend' if backend else ROOT
    relative = path[len('apps/backend/'):] if backend else path
    result = subprocess.run(['git', 'show', 'HEAD:' + relative], cwd=cwd, capture_output=True)
    return result.stdout if result.returncode == 0 else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--reviewed-source-hashes', type=Path, help='Exact hashes of server-only source differences already reviewed')
    args = parser.parse_args()
    deploy = runpy.run_path(str(ROOT / 'scripts/deploy-test.py'))
    client = deploy['connect']()
    sftp = client.open_sftp()
    run = lambda command: deploy['run'](client, command)
    private = ROOT / '.private/payment-connections-deployment'
    private.mkdir(parents=True, exist_ok=True)
    backup = REMOTE + '/shared/backups/payment-connections-' + time.strftime('%Y%m%d-%H%M%S')
    mutated = False
    missing = []
    try:
        env_before = {name: sftp.open(REMOTE + '/apps/' + name + '/.env').read() for name in ['backend', 'storefront']}
        env = parse_env(env_before['backend'])
        storefront_env = parse_env(env_before['storefront'])
        if not storefront_env.get('MEDUSA_PUBLISHABLE_KEY'):
            raise RuntimeError('Test storefront publishable key is unavailable')
        if env.get('BUSINESS_ENVIRONMENT') != 'test' or env.get('STOREFRONT_URL') != ORIGIN or env.get('PUBLIC_BACKEND_URL') != ORIGIN:
            raise RuntimeError('Test environment mismatch')
        if env.get('PAYPAL_ENVIRONMENT', 'sandbox') != 'sandbox' or env.get('OCEAN_ENVIRONMENT', 'sandbox') != 'sandbox':
            raise RuntimeError('Test payment providers must use sandbox credentials')
        nginx_before = sftp.open(NGINX).read()
        if 'server_name testmedusa.365d4u.com;' not in nginx_before.decode():
            raise RuntimeError('Test virtual host mismatch')
        nginx_after = nginx_with_entry(nginx_before)
        report = {'environment': 'test', 'origin': ORIGIN, 'services_before': run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines(), 'source_conflicts': [], 'payment_environments': {key: env.get(key) for key in ['PAYPAL_ENVIRONMENT', 'OCEAN_ENVIRONMENT']}}
        reviewed = json.loads(args.reviewed_source_hashes.read_text(encoding='utf8')) if args.reviewed_source_hashes else {}
        for path in SOURCES:
            try:
                remote = sftp.open(REMOTE + '/' + path).read()
            except FileNotFoundError:
                continue
            # Ignore platform line endings when checking for unrelated server edits.
            normal = lambda data: data.replace(b'\r\n', b'\n')
            original = baseline(path)
            if normal(remote) not in [normal((ROOT / path).read_bytes()), normal(original or b'')] and digest(remote) != reviewed.get(path):
                report['source_conflicts'].append(path)
                dest = private / 'before' / path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(remote)
        (private / 'preflight.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        print(json.dumps(report), flush=True)
        if report['source_conflicts']:
            raise RuntimeError('Review unexpected test server source changes before applying')
        if not args.apply:
            return
        archive = private / 'release.tar.gz'
        hashes = {}
        with tarfile.open(archive, 'w:gz') as tar:
            for path in FILES:
                tar.add(ROOT / path, arcname=path)
                entry = ROOT / path
                for file in entry.rglob('*') if entry.is_dir() else [entry]:
                    if file.is_file():
                        hashes[file.relative_to(ROOT).as_posix()] = digest(file.read_bytes())
        existing = []
        for path in FILES:
            try:
                sftp.stat(REMOTE + '/' + path)
                existing.append(path)
            except FileNotFoundError:
                missing.append(path)
        run('mkdir -p ' + shlex.quote(backup) + ' && chmod 700 ' + shlex.quote(backup) + ' && cd ' + REMOTE + ' && tar -czf ' + shlex.quote(backup + '/files.tar.gz') + ' ' + ' '.join(map(shlex.quote, existing)))
        with sftp.open(backup + '/nginx.conf', 'wb') as handle:
            handle.write(nginx_before)
        with sftp.open(backup + '/manifest.json', 'w') as handle:
            handle.write(json.dumps({'existing': existing, 'new': missing, 'environment_hashes': {key: digest(value) for key, value in env_before.items()}}, indent=2))
        with sftp.open(backup + '/hashes.json', 'w') as handle:
            handle.write(json.dumps(hashes))
        upload = backup + '/release.tar.gz'
        sftp.put(str(archive), upload)
        print('Backup and release upload ready: ' + backup, flush=True)
        mutated = True
        run('systemctl stop d4u-medusa-backend d4u-medusa-storefront')
        run('cd ' + REMOTE + ' && tar -xzf ' + shlex.quote(upload))
        verify = "import hashlib,json,pathlib;root=pathlib.Path(" + repr(REMOTE) + ");hashes=json.loads(pathlib.Path(" + repr(backup + '/hashes.json') + ").read_text());assert all(hashlib.sha256((root/name).read_bytes()).hexdigest()==expected for name,expected in hashes.items()),'Uploaded file hash mismatch';print('Verified uploaded file hashes')"
        print(run('python3 -c ' + shlex.quote(verify)).strip(), flush=True)
        with sftp.open(NGINX, 'wb') as handle:
            handle.write(nginx_after)
        run('nginx -t')
        run('systemctl restart d4u-medusa-backend d4u-medusa-storefront && systemctl reload nginx')
        for _ in range(30):
            try:
                if requests.get(ORIGIN + '/health', timeout=5).status_code == 200:
                    break
            except requests.RequestException:
                pass
            time.sleep(2)
        else:
            raise RuntimeError('Test backend health check failed')
        report['http'] = {}
        for path in ['/', '/health', '/app/', '/app/store-settings', '/invoices/new/', '/api/config', '/store/payment-policy']:
            headers = {'x-publishable-api-key': storefront_env['MEDUSA_PUBLISHABLE_KEY']} if path.startswith('/store/') else {}
            response = requests.get(ORIGIN + path, headers=headers, timeout=20)
            report['http'][path] = response.status_code
            if response.status_code != 200:
                raise RuntimeError('HTTP verification failed for ' + path)
        for path in ['/admin', '/admin/']:
            response = requests.get(ORIGIN + path, allow_redirects=False, timeout=15)
            if response.status_code != 302 or response.headers.get('Location') not in ['/app/', ORIGIN + '/app/']:
                raise RuntimeError('Admin entry verification failed')
            report['http'][path] = {'status': 302, 'location': response.headers['Location']}
        for method in ['get', 'post']:
            response = getattr(requests, method)(ORIGIN + '/admin/store-management/payment-connections', timeout=15, **({'json': {}} if method == 'post' else {}))
            if response.status_code not in [401, 403]:
                raise RuntimeError('Anonymous payment configuration access was not rejected')
        for name, raw in env_before.items():
            if sftp.open(REMOTE + '/apps/' + name + '/.env').read() != raw:
                raise RuntimeError('Environment file unexpectedly changed')
        report.update(backup=backup, services_after=run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines(), uploaded_hashes_verified=True, environment_files_unchanged=True, anonymous_access_rejected=True, production_changed=False)
        (private / 'deployment.json').write_text(json.dumps(report, indent=2), encoding='utf8')
        mutated = False
        print(json.dumps(report), flush=True)
    except Exception:
        if mutated:
            run('systemctl stop d4u-medusa-backend d4u-medusa-storefront')
            run('cd ' + REMOTE + ' && tar -xzf ' + shlex.quote(backup + '/files.tar.gz'))
            for path in missing:
                if (ROOT / path).is_file():
                    try:
                        sftp.remove(REMOTE + '/' + path)
                    except FileNotFoundError:
                        pass
            with sftp.open(NGINX, 'wb') as handle:
                handle.write(nginx_before)
            run('nginx -t && systemctl restart d4u-medusa-backend d4u-medusa-storefront && systemctl reload nginx')
            print('Restored the previous test release: ' + backup, flush=True)
        raise
    finally:
        sftp.close()
        client.close()


if __name__ == '__main__':
    main()
