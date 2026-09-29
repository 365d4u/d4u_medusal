"""Activate the confirmed production domain without charging or creating orders."""
import json, runpy, time
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
REMOTE='/data/d4u_medusal'
ORIGIN='https://medusa.365d4u.com'

def main():
    requests.get(ORIGIN+'/health',timeout=30).raise_for_status()
    deploy=runpy.run_path(str(ROOT/'scripts/deploy-production.py'))
    client,cfg=deploy['connect']();sftp=client.open_sftp()
    try:
        for file in ['src/lib/paid-notifications.ts','src/modules/paypal/service.ts','src/modules/oceanpayment/index.ts']:
            for rel in [file,'.medusa/server/'+file.replace('.ts','.js')]:
                target=REMOTE+'/apps/backend/'+rel
                with sftp.open(target) as existing: backup=existing.read()
                with sftp.open(target+'.before-domain','wb') as out:out.write(backup)
                sftp.put(str(ROOT/'apps/backend'/rel),target)
        credentials=json.loads((ROOT/'.private/production-payment-options.json').read_text(encoding='utf8'))['woocommerce-ppcp-data-common']
        auth=requests.post('https://api-m.paypal.com/v1/oauth2/token',auth=(credentials['client_id'],credentials['client_secret']),data={'grant_type':'client_credentials'},timeout=30)
        auth.raise_for_status()
        headers={'Authorization':'Bearer '+auth.json()['access_token'],'Content-Type':'application/json'}
        endpoint='https://api-m.paypal.com/v1/notifications/webhooks'
        response=requests.get(endpoint,headers=headers,timeout=30);response.raise_for_status()
        before=response.json().get('webhooks',[])
        hook_url=ORIGIN+'/hooks/payment/paypal_paypal'
        hook=next((h for h in before if h['url']==hook_url),None)
        if not hook:
            response=requests.post(endpoint,headers=headers,json={'url':hook_url,'event_types':[{'name':'PAYMENT.CAPTURE.COMPLETED'}]},timeout=30)
            response.raise_for_status();hook=response.json()
        assert any(e['name'] in ['PAYMENT.CAPTURE.COMPLETED','*'] for e in hook['event_types'])
        (ROOT/'.private/production-medusa-paypal-webhook.json').write_text(json.dumps(hook,indent=2),encoding='utf8')
        after=requests.get(endpoint,headers=headers,timeout=30);after.raise_for_status()
        assert all(any(old['id']==new['id'] and old['url']==new['url'] for new in after.json()['webhooks']) for old in before)
        now=datetime.now(timezone.utc).isoformat()
        for app in ['backend','storefront']:
            target=REMOTE+'/apps/'+app+'/.env'
            previous=sftp.open(target).read().decode()
            current={}
            for line in previous.splitlines():
                if '=' not in line or line.startswith('#'):continue
                key,value=line.split('=',1)
                try:current[key]=json.loads(value)
                except ValueError:current[key]=value.strip('"')
            if app=='backend':
                values={'PAYPAL_ENABLED':'true','OCEAN_ENABLED':'true','APPLEPAY_ENABLED':'false','PAYPAL_WEBHOOK_ID':hook['id'],'PAID_NOTIFICATIONS_ENABLED':'true','PAID_NOTIFICATIONS_START_AT':current.get('PAID_NOTIFICATIONS_START_AT') or now}
                assert current['PAYPAL_ENVIRONMENT']=='production' and current['OCEAN_ENVIRONMENT']=='production'
                assert current['BUSINESS_ENVIRONMENT']=='production' and current['STOREFRONT_URL']==ORIGIN
            else:values={'CHECKOUT_ENABLED':'true','APPLEPAY_ENABLED':'false','PAYPAL_CLIENT_ID':credentials['client_id']}
            with sftp.open(target+'.before-payment-activation','w') as out:out.write(previous)
            sftp.chmod(target+'.before-payment-activation',0o600)
            remaining=[l for l in previous.splitlines() if l.split('=',1)[0] not in values]
            with sftp.open(target,'w') as out:out.write('\n'.join(remaining+[k+'='+json.dumps(v) for k,v in values.items()])+'\n')
            sftp.chmod(target,0o600)
        deploy['run'](client,'systemctl restart d4u-medusa-backend d4u-medusa-storefront')
        for attempt in range(30):
            try:
                login=requests.post(ORIGIN+'/auth/user/emailpass',json={'email':cfg.get('admin_email','admin@365d4u.com'),'password':cfg['admin_password']},timeout=10)
                if login.status_code==200:break
            except requests.RequestException:pass
            time.sleep(2)
        login.raise_for_status()
        admin={'Authorization':'Bearer '+login.json()['token']}
        result=requests.get(ORIGIN+'/admin/regions',headers=admin,timeout=25);result.raise_for_status()
        region=next(r for r in result.json()['regions'] if r['name']=='365D4U International')
        providers=['pp_paypal_paypal','pp_oceanpayment_oceanpayment']
        update=requests.post(ORIGIN+'/admin/regions/'+region['id'],headers=admin,json={'payment_providers':providers},timeout=30);update.raise_for_status()
        readiness={'checked_at':now,'domain':ORIGIN,'https':True,'paypal_live_credentials_verified':True,'paypal_medusa_webhook_registered':True,'existing_paypal_webhooks_preserved':True,'payments_enabled':True,'applepay_enabled':False,'applepay_reason':'User postponed production domain registration','notifications_enabled':True,'region_providers':providers,'live_payment_test_performed':False}
        (ROOT/'.private/production-payment-readiness.json').write_text(json.dumps(readiness,indent=2),encoding='utf8')
        print(json.dumps(readiness))
    finally:sftp.close();client.close()

if __name__=='__main__':main()
