"""Localize the live site's exact font files and cart SVG across captured templates."""
from pathlib import Path
import concurrent.futures,json,re
from bs4 import BeautifulSoup
import requests
ROOT=Path(__file__).resolve().parents[1]
source_file=ROOT/'.private/storefront-parity/home.html'
if not source_file.exists():
    manifest=json.loads((ROOT/'.private/rendered/manifest.json').read_text())
    source_file=ROOT/'.private/rendered'/next(item['file'] for item in manifest if item['path']=='/')
SOURCE=source_file.read_text(encoding='utf8')
icon=str(BeautifulSoup(SOURCE,'html.parser').select_one('.wc-block-mini-cart__icon')).replace('viewbox=','viewBox=')
icon=icon.replace('<svg ','<svg width="24" height="24" aria-hidden="true" ')
urls=set(re.findall(r"https://img\.365d4u\.com/c365/fonts/[^'\")]+\.woff2",SOURCE))
def download(url):
    dest=ROOT/'apps/storefront/public/assets/fonts'/url.rsplit('/',1)[-1];dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists():
        r=requests.get(url,timeout=35);r.raise_for_status()
        if not r.content.startswith(b'wOF2'):raise ValueError('Invalid font response')
        dest.write_bytes(r.content)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(download,urls))
count=0
for f in (ROOT/'apps/storefront/templates').glob('*.html'):
    s=f.read_text(encoding='utf8');old=s
    for url in urls:s=s.replace(url,'/assets/fonts/'+url.rsplit('/',1)[-1])
    s=re.sub(r'(<a[^>]+class="d4u-cart-link"[^>]*>)<svg.*?</svg>',lambda m:m[1]+icon,s,flags=re.S)
    # Scope source About-only h1 hiding to its original page, not product/cart shells.
    if f.name=='shell.html':s=re.sub(r'(?<![\w-])h1\s*\{\s*display:\s*none\s*!important;?\s*\}', '',s)
    s=s.replace('action=products_by_date&per_page=12','action=products_by_date&context=d365_home_fresh_drops&per_page=12')
    if f.name=='8a5edab282632443.html':
        s=re.sub(r'action=products_by_date(?!&context=d365_home_fresh_drops)', 'action=products_by_date&context=d365_home_fresh_drops',s)
    s=s.replace('/assets/storefront.css"','/assets/storefront.css?v=20260929"').replace('/assets/storefront.js"','/assets/storefront.js?v=20260929"')
    if '/assets/storefront-parity.css' not in s:s=s.replace('</head>','<link rel="stylesheet" href="/assets/storefront-parity.css?v=20260929"/></head>')
    if s!=old:f.write_text(s,encoding='utf8');count+=1
print('Localized',len(urls),'source fonts; updated',count,'templates')
