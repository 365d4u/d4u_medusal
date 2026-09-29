"""Read-only post-rollout checks, including secret-safe HTTP log inspection."""
import argparse,hashlib,json,runpy,time
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
def main():
 parser=argparse.ArgumentParser();parser.add_argument('target',choices=['test','production']);args=parser.parse_args();target=args.target
 d=runpy.run_path(str(ROOT/'scripts/deploy-woocommerce-compat.py'));cfg=d['TARGETS'][target]
 report_file=ROOT/'.private'/('woo-'+target+'-verification.json');report=json.loads(report_file.read_text())
 private=json.loads((ROOT/'.private'/('woo-'+target+'-api.json')).read_text());key=private['keys'][0];auth=(key['consumer_key'],key['consumer_secret'])
 def get(path,**kwargs):
  response=requests.get(cfg['origin']+path,timeout=90,**kwargs)
  if response.status_code!=200:raise RuntimeError('Read-only verification failed: '+path.split('?')[0]+' HTTP '+str(response.status_code))
  return response
 oldest=get('/wp-json/wc/v3/orders',auth=auth,params={'per_page':1,'orderby':'id','order':'asc'})
 detail=get('/wp-json/wc/v3/orders/'+str(oldest.json()[0]['id']),auth=auth)
 report['historical_order_read']=True;report['historical_fields_partial']=detail.headers.get('X-D4U-Legacy-Partial')=='true'
 if target=='test':
  fixtures=report['test_orders'];statuses=get('/wp-json/cus365d/v1/get_order_status',params={'order_ids':','.join(str(f['id']) for f in fixtures)}).json()['data']
  for f in fixtures:
   assert statuses[str(f['id'])]['source_type']==f['source'] and statuses[str(f['id'])]['status']=='pending'
   order=get('/wp-json/wc/v3/orders/'+str(f['id']),auth=auth).json()
   invoice=get('/api/invoices/'+str(f['id']),params={'key':order['order_key']}).json();invoice=invoice.get('invoice',invoice)
   get(invoice['payment_path'])
  report['persisted_sources_and_original_links']=True
 c,run=d['connect'](target);s=c.open_sftp()
 try:
  report['services']=run(c,'systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines()
  # Never echo raw logs: they can contain private customer or configuration data.
  _,out,err=c.exec_command('journalctl -u d4u-medusa-backend --since "10 minutes ago" --no-pager -o cat',timeout=30)
  logs=out.read().decode(errors='replace');err.read()
  report['http_credentials_redacted']=not any(pair[field] in logs for pair in private['keys'] for field in ['consumer_key','consumer_secret'])
  if not report['http_credentials_redacted']:raise RuntimeError('Unexpected unredacted compatibility credentials in service log')
  expected=json.loads((ROOT/'.private'/('woo-'+target+'-api.json')).read_text())
  remote_env=d['read_env'](s,cfg['root']+'/apps/backend/.env')
  assert remote_env['WOO_COMPAT_TIMEZONE']==expected['timezone'] and remote_env['WOO_COMPAT_CREATE_ENABLED']=='true'
  report['timezone']=expected['timezone'];report['creation_enabled']=True
  backup=report['backup'];assert s.stat(backup+'/files.tar.gz').st_size>0 and s.stat(backup+'/backend.env').st_size>0 and s.stat(backup+'/nginx.conf').st_size>0
  report['backup_verified']=True
  # Confirm every staged source/compiled module reached the server exactly.
  stage=ROOT/'.private'/('woo-release-'+target)
  for path in stage.rglob('*'):
   if not path.is_file() or path.name=='compile.cjs':continue
   relative=path.relative_to(stage).as_posix()
   actual=s.open(cfg['root']+'/'+relative).read()
   if hashlib.sha256(actual).digest()!=hashlib.sha256(path.read_bytes()).digest():raise RuntimeError('Deployed file checksum mismatch: '+relative)
  report['release_checksums_verified']=True
 finally:s.close();c.close()
 report_file.write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
