"""Publish only the reviewed admin UI to the authorized test site.

No database, business settings, credentials, storefront or payment code changes.
Existing hashed assets are retained so already-open admin tabs can finish loading.
"""
import argparse, hashlib, json, runpy, shlex, tarfile, time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/var/www/d4u_medusa'
ORIGIN='https://testmedusa.365d4u.com'
SOURCES=['medusa-config.ts','src/lib/admin-workspace-vite.ts','src/admin/lib/admin-ui.css',
 'src/admin/lib/product-workspace.tsx','src/admin/lib/product-general-editor.tsx','src/admin/lib/management-ui.tsx','src/admin/lib/payment-connections.tsx',
 'src/admin/widgets/product-attributes.tsx','src/admin/routes/store-settings/page.tsx',
 'src/admin/routes/email-log/page.tsx','src/admin/routes/reviews/page.tsx','src/admin/routes/staff-access/page.tsx']
SOURCES=['apps/backend/'+p for p in SOURCES]
STATIC='apps/backend/.medusa/server/public/admin'
digest=lambda data:hashlib.sha256(data).hexdigest()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 deploy=runpy.run_path(str(ROOT/'scripts/deploy-test.py'));client=deploy['connect']();sftp=client.open_sftp();run=lambda command:deploy['run'](client,command)
 private=ROOT/'.private/admin-workspace-deployment';private.mkdir(parents=True,exist_ok=True)
 try:
  env_raw=sftp.open(REMOTE+'/apps/backend/.env').read()
  env={k:v.strip().strip('"').strip("'") for line in env_raw.decode().splitlines() if '=' in line and not line.startswith('#') for k,v in [line.split('=',1)]}
  assert env.get('BUSINESS_ENVIRONMENT')=='test' and env.get('STOREFRONT_URL')==ORIGIN,'Test target mismatch'
  current={};existing=[]
  for name in SOURCES:
   try:
    data=sftp.open(REMOTE+'/'+name).read();current[name]=digest(data);existing.append(name)
    dest=private/'before'/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
   except FileNotFoundError:current[name]=None
  if not args.apply:
   (private/'reviewed-before.json').write_text(json.dumps(current,indent=2));print(json.dumps({'test_only':True,'source_files':len(SOURCES),'existing_files':len(existing),'services':run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront').splitlines()}));return
  assert current==json.loads((private/'reviewed-before.json').read_text()),'Server sources changed since review'
  built=ROOT/'apps/backend/.medusa/admin';assert (built/'index.html').exists()
  backup=REMOTE+'/shared/backups/admin-workspace-'+time.strftime('%Y%m%d-%H%M%S')
  run('mkdir -p '+shlex.quote(backup)+' && chmod 700 '+shlex.quote(backup))
  run('cd '+REMOTE+' && tar -czf '+shlex.quote(backup+'/before.tar.gz')+' '+' '.join(map(shlex.quote,existing+[STATIC])))
  archive=private/'release.tar.gz';manifest={}
  with tarfile.open(archive,'w:gz') as tar:
   for name in SOURCES:
    tar.add(ROOT/name,arcname=name);manifest[name]=digest((ROOT/name).read_bytes())
   for file in built.rglob('*'):
    if file.is_file():
     name=STATIC+'/'+file.relative_to(built).as_posix()
     if file.name=='index.html':name+='.next'
     tar.add(file,arcname=name);manifest[name]=digest(file.read_bytes())
  sftp.put(str(archive),backup+'/release.tar.gz')
  with sftp.open(backup+'/manifest.json','w') as f:f.write(json.dumps(manifest))
  changed=False
  try:
   changed=True;run('cd '+REMOTE+' && tar -xzf '+shlex.quote(backup+'/release.tar.gz'))
   verify="import pathlib,json,hashlib;root=pathlib.Path("+repr(REMOTE)+");m=json.loads(pathlib.Path("+repr(backup+'/manifest.json')+").read_text());assert all(hashlib.sha256((root/n).read_bytes()).hexdigest()==h for n,h in m.items());print('UI file hashes verified')"
   print(run('python3 -c '+shlex.quote(verify)).strip(),flush=True)
   run('mv '+REMOTE+'/'+STATIC+'/index.html.next '+REMOTE+'/'+STATIC+'/index.html')
   expected=(built/'index.html').read_bytes();response=requests.get(ORIGIN+'/app/',timeout=25)
   if response.status_code!=200 or response.content!=expected:
    # Some Medusa releases cache the HTML at startup.
    run('systemctl restart d4u-medusa-backend')
    for _ in range(20):
     time.sleep(1)
     response=requests.get(ORIGIN+'/app/',timeout=10)
     if response.status_code==200 and response.content==expected:break
   assert response.status_code==200 and response.content==expected,'Published admin HTML mismatch'
   assert requests.get(ORIGIN+'/health',timeout=15).status_code==200
   assert sftp.open(REMOTE+'/apps/backend/.env').read()==env_raw,'Environment changed'
   report={'origin':ORIGIN,'backup':backup,'files_verified':len(manifest),'admin_html_verified':True,'services':run('systemctl is-active d4u-medusa-backend d4u-medusa-storefront').splitlines()}
   (private/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
  except Exception:
   if changed:
    run('cd '+REMOTE+' && tar -xzf '+shlex.quote(backup+'/before.tar.gz'))
    run('systemctl restart d4u-medusa-backend')
   raise
 finally:sftp.close();client.close()

if __name__=='__main__':main()
