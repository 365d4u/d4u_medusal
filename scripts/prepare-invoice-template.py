"""Prepare the owner's exact reference payment page, replacing WordPress commerce with Medusa."""
from pathlib import Path
from urllib.parse import urlparse,urljoin
import re,requests
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1];target=ROOT/'apps/storefront'
doc=BeautifulSoup((ROOT/'.private/invoice-reference.html').read_text(encoding='utf8'),'html.parser')
for item in doc.select('script,iframe,noscript,link[rel="modulepreload"],link[rel="https://api.w.org/"],link[rel="EditURI"],link[rel="canonical"],meta[name="generator"],.select2-container,.ppc-button-wrapper,#ppc-button-ppcp-applepay,#ppc-button-ppcp-googlepay,.ppcp-messages'):
    item.decompose()
for item in doc.select('[onclick],[onchange]'):
    item.attrs.pop('onclick',None);item.attrs.pop('onchange',None)
doc.title.string='Pay - Order:__INVOICE_NUMBER__'
doc.select_one('.order_h4').string='Order Number : __INVOICE_NUMBER__'
form=doc.select_one('#order_review');form['action']='#';form['novalidate']='novalidate'
table=form.select_one('table.shop_table')
table.tbody.clear()
table.tfoot.clear();table.tfoot.append(BeautifulSoup('__INVOICE_ROWS__<tr><th colspan="2" scope="row">Total:</th><td class="product-total">__INVOICE_TOTAL__</td></tr>','html.parser'))
for item in form.select('input[type=hidden],button[name=woocommerce_checkout_update_totals]'):item.decompose()
for item in form.select('input:not([type=radio]):not([type=checkbox])'):item['value']=''
for item in form.select('select'):
    item['class']=[x for x in item.get('class',[]) if x!='select2-hidden-accessible']
    for name in ['tabindex','aria-hidden','data-select2-id']:item.attrs.pop(name,None)
for item in form.select('[data-select2-id]'):item.attrs.pop('data-select2-id',None)
for select in form.select('select[name$=_country]'):
    for opt in select.select('option'):opt.attrs.pop('selected',None)
    select.select_one('option')['selected']='selected'
for item in form.select('input,select'):
    if item.get('type') not in ['radio','checkbox'] and not item.get('name','').endswith('address_2'):item['required']='required'
card=form.select_one('.payment_box.payment_method_oceancreditcardonepage')
icons=card.select_one('#op-payment-icons');icons.extract() if icons else None
card.clear()
if icons:
    note=icons.select_one('.status-box')
    if note:note['id']='invoice-card-sandbox';note['hidden']='hidden'
    card.append(icons)
card.append(BeautifulSoup('<fieldset><p id="invoice-card-loading" role="status">Loading secure card form…</p><div id="oceanpayment-element"></div></fieldset>','html.parser'))
card.parent.insert_after(BeautifulSoup('<li class="wc_payment_method payment_method_oceanapplepay" id="invoice-applepay-method" hidden><input id="payment_method_oceanapplepay" type="radio" class="input-radio" name="payment_method" value="oceanapplepay"><label for="payment_method_oceanapplepay">Apple Pay</label><p id="invoice-applepay-unavailable" hidden>Apple Pay requires a supported Apple device and browser with Apple Pay set up.</p><div class="payment_box payment_method_oceanapplepay" style="display:none"><p id="invoice-applepay-help">Continue with Apple Pay below, then authorize your payment.</p><div id="oceanpayment-applepayelement"></div></div></li>','html.parser'))
button=form.select_one('#place_order');button['class']=['button','alt','wp-element-button','invoice-paypal-button'];button.attrs.pop('style',None);button.string='Pay with PayPal'
status=doc.new_tag('p',id='invoice-payment-status',role='status');button.insert_before(status)
form.select_one('#custom_checkbox')['required']='required'
script=doc.new_tag('script',type='application/json',id='invoice-data');script.string='__INVOICE_DATA__';doc.body.append(script)
doc.body.append(doc.new_tag('script',src='/assets/address-states.js?v=20260923-business-address2',defer=True))
doc.body.append(doc.new_tag('script',src='/assets/invoice-payment.js?v=20260923-business-address2',defer=True))
doc.body.append(doc.new_tag('script',src='/assets/address-select.js?v=20260923-business-address2',defer=True))
doc.head.append(doc.new_tag('link',rel='stylesheet',href='/assets/invoice-payment.css?v=20260923-business-address2'))
for origin in ['https://secure.oceanpayment.com','https://test-secure.oceanpayment.com']:
    doc.head.append(doc.new_tag('link',rel='preconnect',href=origin))
doc.head.append(doc.new_tag('link',rel='preload',href='/assets/vendor/oceanpayment-0e7a4e5cebd8.js',attrs={'as':'script'}))
seen=set()
def local_asset(url):
    parsed=urlparse(url)
    if parsed.hostname not in ['test.365d4u.com','www.365d4u.com']:return url
    relative='/assets/invoice-source'+parsed.path
    destination=(target/'public'/relative.lstrip('/')).resolve()
    if not destination.is_relative_to((target/'public/assets/invoice-source').resolve()):raise ValueError('Unsafe asset')
    if url in seen:return relative
    seen.add(url);destination.parent.mkdir(parents=True,exist_ok=True)
    if not destination.exists():
        r=requests.get(url,timeout=30);r.raise_for_status()
        if parsed.path.endswith('.css'):
            text=re.sub(r'url\([\'\"]?([^\)\'\"]+)[\'\"]?\)',lambda m:'url("'+local_asset(urljoin(url,m.group(1)))+'")',r.text)
            destination.write_text(text,encoding='utf8')
        else:destination.write_bytes(r.content)
    return relative
for item in doc.select('link[rel=stylesheet]'):
    item['href']=local_asset(item['href'])
for item in doc.select('img[src]'):
    item['src']=local_asset(item['src'])
for style in doc.find_all('style'):
    style.string=re.sub(r'url\([\'\"]?([^\)\'\"]+)[\'\"]?\)',lambda m:'url("'+local_asset(m.group(1))+'")',style.get_text())
text=str(doc).replace('https://test.365d4u.com','').replace('https://www.365d4u.com','')
# Sensitive source order URL/nonces must never survive the conversion.
text=re.sub(r'wc_order_[A-Za-z0-9]+','',text).replace('102973','__INVOICE_NUMBER__')
(target/'templates/invoice-payment.html').write_text(text,encoding='utf8')
print('Prepared invoice template and',len(seen),'owned assets')
