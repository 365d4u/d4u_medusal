"""Scoped Woo compatibility rollout. Never runs bootstrap/imports or switches www.

Preflight is read-only. --apply is explicit. SSH secrets use the existing deployment
connectors; API keys are kept in private env files and never printed.
"""
import argparse,hashlib,json,os,re,runpy,secrets,shlex,tarfile,time,subprocess
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
TARGETS={
 'test':{'root':'/var/www/d4u_medusa','origin':'https://testmedusa.365d4u.com','node':'/usr/bin/node'},
 'production':{'root':'/data/d4u_medusal','origin':'https://medusa.365d4u.com','node':'/data/d4u_medusal/shared/runtime/node-v22.22.2-linux-x64/bin/node'},
}
SOURCES=['lib/woocommerce-contract.ts','lib/woocommerce-repository.ts','lib/woocommerce-http.ts','lib/woocommerce-snapshot.ts','lib/woocommerce-logging.ts','lib/invoices.ts','lib/paid-notifications.ts','api/middlewares.ts','scripts/import-woocommerce-contract.ts','api/wp-json/wc/v3/orders/route.ts','api/wp-json/wc/v3/orders/[id]/route.ts','api/wp-json/cus365d/v1/get_order_status/route.ts','api/wp-json/cus365d/v1/auto_create_order/route.ts']
FILES=['apps/backend/src/'+p for p in SOURCES]+['apps/backend/.medusa/server/src/'+p.replace('.ts','.js') for p in SOURCES]+['apps/backend/medusa-config.ts','apps/backend/.medusa/server/medusa-config.js','apps/backend/package.json','apps/backend/package-lock.json','apps/backend/.medusa/server/package.json','docs/woocommerce-compatibility.md']

def connect(target):
 script='deploy-test.py' if target=='test' else 'deploy-production.py'
 d=runpy.run_path(str(ROOT/'scripts'/script));result=d['connect']()
 return (result[0] if isinstance(result,tuple) else result),d['run']

def read_env(s,path):
 values={}
 for line in s.open(path).read().decode().splitlines():
  if '=' not in line or line.lstrip().startswith('#'):continue
  k,v=line.split('=',1)
  try:values[k]=json.loads(v)
  except ValueError:values[k]=v.strip().strip("'")
 return values

def remote_node(c,s,run,target,code):
 cfg=TARGETS[target];base=cfg['root']+'/apps/backend'
 helper=base+'/.woo-compat-check.cjs'
 with s.open(helper,'w') as f:f.write(code)
 try:return run(c,'cd '+shlex.quote(base)+' && '+shlex.quote(cfg['node'])+' --env-file=.env '+shlex.quote(helper))
 finally:s.remove(helper)

def preflight(target):
 cfg=TARGETS[target];c,run=connect(target);s=c.open_sftp()
 try:
  result={'target':target,'services':run(c,'systemctl is-active d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis').splitlines()}
  env=read_env(s,cfg['root']+'/apps/backend/.env')
  result['environment']={k:env.get(k) for k in ['STOREFRONT_URL','BUSINESS_ENVIRONMENT','PAYPAL_ENVIRONMENT','OCEAN_ENVIRONMENT','WOO_COMPAT_TIMEZONE','WOO_COMPAT_CREATE_ENABLED']}
  result['api_credentials_present']=bool(env.get('WOO_COMPAT_API_KEYS') or env.get('WOO_COMPAT_CONSUMER_KEY'))
  result['missing_dependencies']=[]
  for relative in ['lib/invoice-note.ts','lib/invoice-email.ts','lib/invoice-reporting.ts','lib/invoice-staff-activity.ts','lib/store-management.ts','lib/cos-media.ts']:
   try:s.stat(cfg['root']+'/apps/backend/src/'+relative)
   except FileNotFoundError:result['missing_dependencies'].append(relative)
  for relative in ['apps/backend/src/lib/invoices.ts','apps/backend/src/api/middlewares.ts','apps/backend/medusa-config.ts']:
   value=s.open(cfg['root']+'/'+relative).read().decode()
   (ROOT/'.private'/('woo-'+target+'-before-'+Path(relative).name)).write_text(value,encoding='utf8')
  result['runtime']=json.loads(remote_node(c,s,run,target,"const path=require('path');const root=require.resolve('morgan');const fw=require.resolve('morgan',{paths:[path.dirname(require.resolve('@medusajs/framework/http'))]});console.log(JSON.stringify({node:process.version,morgan:require('morgan/package.json').version,morgan_shared:root===fw}));"))
  host=cfg['origin'].split('//')[1];nginx='/etc/nginx/sites-available/'+host+'.conf'
  conf=s.open(nginx).read().decode();result['nginx_sha256']=hashlib.sha256(conf.encode()).hexdigest();result['compat_routes_present']='/wp-json/wc/v3/orders' in conf
  (ROOT/'.private'/('woo-'+target+'-nginx-before.conf')).write_text(conf,encoding='utf8')
  result['health']=requests.get(cfg['origin']+'/health',timeout=20).status_code
  print(json.dumps(result,ensure_ascii=False),flush=True)
  return result
 finally:s.close();c.close()

def patch_existing(relative,text):
 text=text.replace('\r\n','\n')
 if relative.endswith('lib/invoices.ts'):
  if 'export function invoiceCompatKey' not in text:
   anchor='export function validInvoiceKey(record:any,key:string){'
   if anchor not in text:raise RuntimeError('Invoice key patch anchor missing')
   text=text.replace(anchor,"export function invoiceCompatKey(token:string){return 'wc_order_'+createHash('sha256').update('woocommerce:'+token).digest('hex').slice(0,32)}\n"+anchor+"\n  if(/^wc_order_[a-f0-9]{32}$/.test(key))return equal(invoiceCompatKey(record.token),key)")
  if 'options:{metadata?' not in text:
   replacements={
    'export async function createInvoice(scope:any,input:any,actor:string,requestId:string){':'export async function createInvoice(scope:any,input:any,actor:string,requestId:string,options:{metadata?:Record<string,any>,suppressEmail?:boolean}={}){',
    'fingerprint=sha256(JSON.stringify(validated))':'fingerprint=sha256(JSON.stringify(options.metadata?{...validated,source_metadata:options.metadata}:validated))',
    'metadata:{is_invoice:true,invoice_request_key':'metadata:{...options.metadata,is_invoice:true,invoice_request_key',
   }
   for old,new in replacements.items():
    if old not in text:raise RuntimeError('Invoice compatibility patch anchor missing')
    text=text.replace(old,new,1)
  text=text.replace("invoice_email_enabled:process.env.INVOICE_EMAIL_ENABLED==='true'","invoice_email_enabled:!options.suppressEmail&&process.env.INVOICE_EMAIL_ENABLED==='true'",1)
  if 'customer_note:validated.note' not in text:
   text=text.replace('note:validated.note,created_at:',"note:validated.note,...(options.metadata?.woo_compat?{customer_note:validated.note}:{}),created_at:",1)
  if 'view.customer_note' not in text:
   text=text.replace('view.payment_path=invoicePayPath(record)',"view.payment_path=invoicePayPath(record)\n  if(order.metadata?.woo_compat)view.customer_note=record.customer_note||''",1)
 elif relative.endswith('lib/paid-notifications.ts'):
  if "from './woocommerce-contract'" not in text:text="import { orderSource } from './woocommerce-contract'\n"+text
  old="source_type:order.metadata?.is_respond_order?'Respond':order.metadata?._wc_order_attribution_source_type||'unknown'"
  if old not in text and "source_type:orderSource(" not in text:raise RuntimeError('Notification source patch anchor missing')
  text=text.replace(old,"source_type:orderSource(order.metadata,'unknown')")
 elif relative.endswith('api/middlewares.ts'):
  if "'/wp-json/cus365d/v1/*'" not in text:
   text=text.replace('routes: [',"routes: [\n  { matcher: '/wp-json/cus365d/v1/*', bodyParser: {sizeLimit:'256kb'}, middlewares: [express.urlencoded({extended:false,limit:'256kb'})] },",1)
 elif relative.endswith('medusa-config.ts'):
  if 'registerWooLogRedaction' not in text:text="import { registerWooLogRedaction } from './src/lib/woocommerce-logging'\nregisterWooLogRedaction()\n"+text
 else:raise RuntimeError('Unexpected patch target')
 return text

def stage_release(target,s):
 cfg=TARGETS[target];stage=ROOT/'.private'/('woo-release-'+target);stage.mkdir(parents=True,exist_ok=True)
 patched=['apps/backend/src/lib/invoices.ts','apps/backend/src/lib/paid-notifications.ts','apps/backend/src/api/middlewares.ts','apps/backend/medusa-config.ts']
 source_files=['apps/backend/src/'+p for p in SOURCES]
 source_files+=['apps/backend/medusa-config.ts']
 files=[]
 for relative in source_files:
  if relative in patched:content=patch_existing(relative,s.open(cfg['root']+'/'+relative).read().decode())
  else:content=(ROOT/relative).read_text(encoding='utf8')
  path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content,encoding='utf8');files.append(relative)
 # Compile each target's narrowly patched source, preserving its existing features.
 compiler=stage/'compile.cjs'
 compiler.write_text("const fs=require('fs'),path=require('path'),ts=require("+json.dumps(str(ROOT/'apps/backend/node_modules/typescript'))+");for(const relative of "+json.dumps(source_files)+"){const input=path.join(__dirname,relative),output=path.join(__dirname,relative.replace('apps/backend/src/','apps/backend/.medusa/server/src/').replace('apps/backend/medusa-config.ts','apps/backend/.medusa/server/medusa-config.ts').replace(/\\.ts$/,'.js'));const result=ts.transpileModule(fs.readFileSync(input,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2021,module:ts.ModuleKind.Node16,esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true},reportDiagnostics:true});if(result.diagnostics.some(d=>d.category===ts.DiagnosticCategory.Error))throw Error('Target compilation failed');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result.outputText)}",encoding='utf8')
 subprocess.run(['node',str(compiler)],check=True,capture_output=True)
 for relative in source_files:
  files.append(relative.replace('apps/backend/src/','apps/backend/.medusa/server/src/').replace('apps/backend/medusa-config.ts','apps/backend/.medusa/server/medusa-config.ts').replace('.ts','.js'))
 for relative in ['apps/backend/package.json','apps/backend/package-lock.json','apps/backend/.medusa/server/package.json']:
  value=json.loads(s.open(cfg['root']+'/'+relative).read().decode())
  if relative.endswith('package-lock.json'):value['packages']['']['dependencies']['morgan']='1.12.1'
  else:
   value.setdefault('dependencies',{})['morgan']='1.12.1'
   if relative=='apps/backend/package.json':value.setdefault('scripts',{})['import:woo-contract']='medusa exec ./src/scripts/import-woocommerce-contract.ts'
  path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2)+'\n',encoding='utf8');files.append(relative)
 for relative in ['docs/woocommerce-compatibility.md']:
  path=stage/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes((ROOT/relative).read_bytes());files.append(relative)
 archive=ROOT/'.private'/('woo-release-'+target+'.tar.gz')
 with tarfile.open(archive,'w:gz') as tar:
  for relative in files:tar.add(stage/relative,arcname=relative)
 return archive,files,stage

def patch_nginx(original,target):
 template=(ROOT/'scripts/configure-nginx.py').read_text(encoding='utf8')
 start=template.index('    location ^~ /wp-json/wc/v3/orders {');end=template.index('    location ^~ /auth/ {',start)
 blocks=template[start:end]
 if target=='production':blocks=blocks.replace('zone=d4u_invoice','zone=d4u_prod_invoice').replace('zone=d4u_auth','zone=d4u_prod_auth')
 block='    # D4U WOO COMPAT START\n'+blocks+'    # D4U WOO COMPAT END\n'
 if '# D4U WOO COMPAT START' in original:return re.sub(r'    # D4U WOO COMPAT START.*?    # D4U WOO COMPAT END\n',lambda _:block,original,flags=re.S)
 if '/wp-json/wc/v3/orders' in original:raise RuntimeError('Unmanaged compatibility Nginx routes already exist')
 anchor='    location ^~ /auth/ {'
 if anchor not in original:raise RuntimeError('Nginx insertion anchor missing')
 return original.replace(anchor,block+anchor,1)

def verify(target,create_test=False):
 cfg=TARGETS[target];origin=cfg['origin'];private=json.loads((ROOT/'.private'/('woo-'+target+'-api.json')).read_text());keys=private['keys'];auth=(keys[0]['consumer_key'],keys[0]['consumer_secret'])
 def call(method,path,expected=200,**kwargs):
  try:r=requests.request(method,origin+path,timeout=90,**kwargs)
  except requests.RequestException:raise RuntimeError('Compatibility HTTP transport verification failed') from None
  if r.status_code!=expected:raise RuntimeError('Compatibility verification '+method+' '+path.split('?')[0]+' returned '+str(r.status_code)+' instead of '+str(expected))
  return r
 report={'target':target,'origin':origin}
 call('GET','/health');call('GET','/wp-json/wc/v3/orders',expected=401)
 first=call('GET','/wp-json/wc/v3/orders',auth=auth,params={'per_page':1,'orderby':'date','order':'desc'})
 page=first.json();assert isinstance(page,list) and page,'No orders available for read verification'
 report.update(total_orders=int(first.headers['X-WP-Total']),total_pages=int(first.headers['X-WP-TotalPages']),legacy_partial=first.headers.get('X-D4U-Legacy-Partial')=='true')
 number=page[0]['id'];assert isinstance(number,int)
 detail=call('GET','/wp-json/wc/v3/orders/'+str(number),auth=auth).json();assert detail['id']==number and isinstance(detail['total'],str)
 oldest=call('GET','/wp-json/wc/v3/orders',auth=auth,params={'per_page':1,'orderby':'id','order':'asc'})
 if oldest.json():
  legacy=call('GET','/wp-json/wc/v3/orders/'+str(oldest.json()[0]['id']),auth=auth)
  report['historical_order_read']=True;report['historical_fields_partial']=legacy.headers.get('X-D4U-Legacy-Partial')=='true'
 for key in keys:call('GET','/wp-json/wc/v3/orders',params={**key,'per_page':1})
 call('GET','/wp-json/wc/v3/orders/99999999999',expected=404,auth=auth)
 batch=call('POST','/wp-json/cus365d/v1/get_order_status',json={'order_ids':[str(number),'99999999999']}).json()
 assert batch['success'] and batch['data'][str(number)]['exists'] and not batch['data']['99999999999']['exists']
 call('GET','/wp-json/cus365d/v1/get_order_status',params={'order_ids':str(number)})
 call('POST','/wp-json/cus365d/v1/auto_create_order',expected=400,json={})
 report.update(basic_auth=True,query_auth_key_pairs=len(keys),list_and_detail=True,status_get_post=True,create_validation=True)
 if create_test:
  assert target=='test'
  report['test_orders']=[]
  for source in ['respond','crm']:
   payload={'name':'Compatibility deployment verification - '+source,'amount':1.9,'note':'Sandbox API verification; no charge or messages.',source+'_id':'compat-deploy-fixture'}
   headers={'Idempotency-Key':'woo-deploy-20260926-'+source}
   created=call('POST','/wp-json/cus365d/v1/auto_create_order',json=payload,headers=headers).json()
   duplicate=call('POST','/wp-json/cus365d/v1/auto_create_order',json=payload,headers=headers).json()
   assert created==duplicate and created['source']==('Respond' if source=='respond' else 'CRM')
   call('POST','/wp-json/cus365d/v1/auto_create_order',expected=409,json={**payload,'amount':2},headers=headers)
   detail=call('GET','/wp-json/wc/v3/orders/'+str(created['order_id']),auth=auth).json()
   assert detail['total']=='1.00' and detail['status']=='pending' and detail['order_key'].startswith('wc_order_')
   assert created['payment_url']==origin+'/payit/'+str(created['order_id'])+'/'+detail['order_key']
   call('GET',created['payment_url'][len(origin):])
   api=call('GET','/api/invoices/'+str(created['order_id']),params={'key':detail['order_key']}).json()
   assert api.get('invoice',api)['display_id']==created['order_id']
   report['test_orders'].append({'id':created['order_id'],'source':created['source'],'amount':'1.00','status':'pending','idempotency':True,'payment_link':True})
 (ROOT/'.private'/('woo-'+target+'-verification.json')).write_text(json.dumps(report,indent=2),encoding='utf8')
 return report

def apply(target):
 check=preflight(target)
 if check['health']!=200 or not all(v=='active' for v in check['services']):raise RuntimeError('Preflight health check failed')
 if check['runtime']['morgan']!='1.12.1' or not check['runtime']['morgan_shared']:raise RuntimeError('HTTP logger dependency needs review before deployment')
 cfg=TARGETS[target];c,run=connect(target);s=c.open_sftp();base=cfg['root'];stamp=time.strftime('%Y%m%d-%H%M%S');backup=base+'/shared/backups/woo-compat-'+stamp
 nginx='/etc/nginx/sites-available/'+cfg['origin'].split('//')[1]+'.conf';changed=False
 try:
  archive,files,stage=stage_release(target,s)
  original_nginx=s.open(nginx).read().decode();new_nginx=patch_nginx(original_nginx,target)
  envfile=base+'/apps/backend/.env';original_env=s.open(envfile).read().decode()
  private=json.loads((ROOT/'.private'/('woo-'+target+'-api.json')).read_text())
  values={'WOO_COMPAT_API_KEYS':json.dumps(private['keys'],separators=(',',':')),'WOO_COMPAT_TIMEZONE':private['timezone'],'WOO_COMPAT_CREATE_ENABLED':'true'}
  new_env='\n'.join(line for line in original_env.splitlines() if line.split('=',1)[0] not in values)+'\n'+'\n'.join(k+'='+json.dumps(v) for k,v in values.items())+'\n'
  existing=[];introduced=[]
  for relative in files:
   try:s.stat(base+'/'+relative);existing.append(relative)
   except FileNotFoundError:introduced.append(relative)
  run(c,'mkdir -p '+shlex.quote(backup)+' && chmod 700 '+shlex.quote(backup))
  with s.open(backup+'/existing-files.txt','w') as f:f.write('\n'.join(existing)+'\n')
  with s.open(backup+'/introduced-files.json','w') as f:f.write(json.dumps(introduced))
  run(c,'cd '+shlex.quote(base)+' && tar -czf '+shlex.quote(backup+'/files.tar.gz')+' -T '+shlex.quote(backup+'/existing-files.txt')+' && cp '+shlex.quote(envfile)+' '+shlex.quote(backup+'/backend.env')+' && cp '+shlex.quote(nginx)+' '+shlex.quote(backup+'/nginx.conf')+' && chmod 600 '+shlex.quote(backup+'/backend.env'))
  remote_archive=backup+'/release.tar.gz';s.put(str(archive),remote_archive);s.chmod(remote_archive,0o600)
  print(json.dumps({'target':target,'backup':backup,'release_files':len(files),'preserved_existing_environment_features':True}),flush=True)
  changed=True
  run(c,'cd '+shlex.quote(base)+' && tar -xzf '+shlex.quote(remote_archive))
  with s.open(envfile,'w') as f:f.write(new_env)
  s.chmod(envfile,0o600)
  with s.open(nginx,'w') as f:f.write(new_nginx)
  run(c,'nginx -t')
  remote_node(c,s,run,target,"for(const p of ['woocommerce-http','woocommerce-repository','woocommerce-contract'])require('./.medusa/server/src/lib/'+p);const i=require('./.medusa/server/src/lib/invoices');if(typeof i.invoiceCompatKey!=='function')throw Error('Missing compatibility key');console.log('Compatibility runtime imports verified')")
  run(c,'systemctl restart d4u-medusa-backend')
  for _ in range(40):
   try:
    if requests.get(cfg['origin']+'/health',timeout=3).status_code==200:break
   except requests.RequestException:pass
   time.sleep(2)
  else:raise RuntimeError('Backend failed to become healthy')
  run(c,'systemctl reload nginx')
  report=verify(target,create_test=target=='test');report['backup']=backup
  (ROOT/'.private'/('woo-'+target+'-verification.json')).write_text(json.dumps(report,indent=2),encoding='utf8')
  print(json.dumps(report,ensure_ascii=False),flush=True)
 except Exception:
  if changed:
   # Restore only this deployment's paths; retain all business data/test orders.
   run(c,'cd '+shlex.quote(base)+' && tar -xzf '+shlex.quote(backup+'/files.tar.gz')+' && cp '+shlex.quote(backup+'/backend.env')+' '+shlex.quote(envfile)+' && cp '+shlex.quote(backup+'/nginx.conf')+' '+shlex.quote(nginx))
   for relative in introduced:
    if not relative.startswith(('apps/backend/','docs/')) or '..' in Path(relative).parts:raise RuntimeError('Unsafe rollback path')
    try:s.remove(base+'/'+relative)
    except FileNotFoundError:pass
   run(c,'nginx -t && systemctl reload nginx && systemctl restart d4u-medusa-backend')
   print(json.dumps({'target':target,'rolled_back':True,'backup':backup}),flush=True)
  raise
 finally:s.close();c.close()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('target',choices=TARGETS);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
 if args.apply:apply(args.target)
 else:preflight(args.target)

if __name__=='__main__':main()
