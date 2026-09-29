"""Turn captured owned pages into standalone storefront templates.

Preserve source markup/styles and browser catalog code; remove WordPress
commerce/payment/analytics runtime. Commerce is implemented by our own BFF.
"""
from pathlib import Path
from urllib.parse import urlparse, urljoin
import concurrent.futures
import json
import re
import requests
import runpy
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / '.private/rendered'
target = ROOT / 'apps/storefront'
(target/'templates').mkdir(parents=True, exist_ok=True)
(target/'public').mkdir(exist_ok=True)
assets = set()
vendors = {
    'masonry.pkgd.min.js': 'https://unpkg.com/masonry-layout@4.2.2/dist/masonry.pkgd.min.js',
    'imagesloaded.pkgd.min.js': 'https://unpkg.com/imagesloaded@5.0.0/imagesloaded.pkgd.min.js',
}
manifest = json.loads((source/'manifest.json').read_text())
routes = {}
for item in manifest:
    document = BeautifulSoup((source/item['file']).read_bytes(), 'html.parser')
    for script in document.find_all('script'):
        src = script.get('src', '')
        code = script.string or script.get_text()
        if src:
            # Retain only DOM library and owned presentation scripts; provider SDKs load only on new checkout.
            vendor=next((name for name in vendors if name in src),None)
            if vendor:
                script['src']='/assets/vendor/'+vendor
            elif '/jquery/jquery.min.js' in src or any(name in src for name in ['/loading-modal.js','/floating-contact.js','/resize-refresh.js']):
                assets.add(src)
            else:
                script.decompose(); continue
        elif script.get('type')=='importmap' or any(marker in code for marker in ['_wpemojiSettings','googletagmanager', 'gtag(', 'fbq(', 'wpmDataLayer', 'ppcp', 'onePageCardData', 'Oceanpayment', 'wp.apiFetch', 'wp.i18n', 'wp.data', 'wp.hooks', 'sourcebuster', 'wcSettings', 'wcBlocksRegistry', 'wc_order_attribution', 'woocommerce_params', 'wc_add_to_cart_params', 'wpApiSettings']):
            script.decompose(); continue
    for element in document.select('noscript, link[rel="modulepreload"], link[rel="https://api.w.org/"], link[rel="EditURI"], meta[name="generator"]'):
        element.decompose()
    for link in document.select('link[rel="stylesheet"]'):
        href = link.get('href', '')
        if urlparse(href).hostname == 'www.365d4u.com': assets.add(href)
    for style in document.find_all('style'):
        for url in re.findall(r'url\([\'\"]?([^\)\'\"]+)',style.get_text()):
            if urlparse(url).hostname=='www.365d4u.com':assets.add(url)
    for img in document.select('img[src]'):
        if '/wp-content/themes/' in img['src']:assets.add(img['src'])
    # Replace old mini-cart block with a native-cart entry point.
    for cart in document.select('.wp-block-woocommerce-mini-cart'):
        cart.clear()
        a = document.new_tag('a', href='/cart/', attrs={'aria-label':'Shopping cart', 'class':'d4u-cart-link'})
        icon=BeautifulSoup('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>','html.parser')
        a.append(icon); cart.append(a)
    if item['path']=='/customer-says/':
        for selector,marker in [('.reviews-list','__D4U_REVIEW_LIST__'),('.pagination','__D4U_REVIEW_PAGINATION__'),('.pagination-info','__D4U_REVIEW_INFO__')]:
            element=document.select_one(selector)
            if element:element.clear();element.string=marker
    if item['path']=='/terms-conditions/' and not document.select_one('object[data="https://www.9-bill.com/index/text"]'):
        anchor=document.select_one('img[src="https://www.9-bill.com/index/img"]')
        if not anchor:raise ValueError('Terms footer insertion point not found')
        anchor.parent.insert_after(document.new_tag('object', data='https://www.9-bill.com/index/text', style='width:100%'))
    bridge = document.new_tag('script', src='/assets/storefront.js', defer=True)
    document.head.append(bridge)
    extra = document.new_tag('link', rel='stylesheet', href='/assets/storefront.css')
    document.head.append(extra)
    rendered = str(document).replace('https://www.365d4u.com', '').replace('http://www.365d4u.com', '').replace('https:\\/\\/www.365d4u.com', '')
    rendered = rendered.replace('https://test.365d4u.com', '').replace('http://ecom365d4u.local', '')
    rendered = rendered.replace('Subscribed! Please check your inbox for confirmation.','Thanks for subscribing!')
    (target/'templates'/item['file']).write_text(rendered, encoding='utf-8')
    routes[item['path']] = item['file']
(target/'templates/routes.json').write_text(json.dumps(routes, indent=2), encoding='utf-8')
shell=BeautifulSoup((target/'templates'/routes['/about/']).read_text(encoding='utf8'),'html.parser')
main=shell.find('main')
if not main:raise ValueError('Homepage main element not found')
main.clear();main.string='__D4U_CONTENT__'
main['class']=['d4u-main']
main.attrs.pop('style',None)
(target/'templates/shell.html').write_text(str(shell),encoding='utf8')

def download(url):
    parsed = urlparse(url)
    if parsed.hostname != 'www.365d4u.com': return
    destination = (target/'public'/parsed.path.lstrip('/')).resolve()
    if not destination.is_relative_to((target/'public').resolve()): raise ValueError('Unsafe asset path')
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():return
    response = requests.get(url, timeout=30); response.raise_for_status()
    destination.write_bytes(response.content)
    if parsed.path.endswith('.css'):
        for relative in re.findall(r'url\([\'\"]?([^\)\'\"]+)', response.text):
            child = urljoin(url, relative)
            if urlparse(child).hostname == 'www.365d4u.com' and not child.endswith('.css'): download(child)

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(download, assets))
for name,url in vendors.items():
    file=target/'public/assets/vendor'/name;file.parent.mkdir(parents=True,exist_ok=True)
    if not file.exists():
        response=requests.get(url,timeout=30);response.raise_for_status();file.write_bytes(response.content)
print('Prepared',len(routes),'page templates and',len(assets),'source stylesheet/script assets')
# Keep source fonts, mini-cart, Fresh Drops context and shell fixes on regeneration.
runpy.run_path(str(ROOT/'scripts/prepare-parity-assets.py'))
