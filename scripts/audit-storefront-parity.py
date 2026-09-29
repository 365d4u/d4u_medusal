"""Read-only source audit. Raw source/catalog exports stay in .private."""
import concurrent.futures, json, re, runpy
from pathlib import Path
import requests

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'.private/storefront-parity'
DEST.mkdir(parents=True,exist_ok=True)

def main():
    source=runpy.run_path(str(ROOT/'scripts/deploy-production.py'))
    c,_=source['connect']();s=c.open_sftp()
    try:
        for relative in ['365d-customizations/modules/registry.php','365d-customizations/modules/home-fresh-drops/module.php','365d-customizations/modules/ready-to-ship-badge/module.php','home365d-config/home365d-config.php','myshop/Cus365dProduct.php','myshop/Cus365dProducts.php']:
            try:
                body=s.open('/data/c365/app/public/wp-content/plugins/'+relative).read()
                path=DEST/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
                print('Source',relative,len(body))
            except FileNotFoundError:print('Not deployed',relative)
        query=runpy.run_path(str(ROOT/'scripts/export-wordpress.py'))['query']
        rows=query(c,"SELECT JSON_OBJECT('name',option_name,'value',option_value) FROM wp_options WHERE option_name IN ('d365_customizations_enabled','active_plugins')")
        (DEST/'modules.json').write_text(json.dumps(rows),encoding='utf8')
        # Public product metadata only; no customers, orders, or credentials.
        meta=query(c,"SELECT JSON_OBJECT('id',post_id,'key',meta_key,'value',meta_value) FROM wp_postmeta WHERE post_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('product','product_variation') AND post_status='publish') AND (meta_key LIKE '_home365d_%' OR meta_key IN ('_regular_price','_sale_price','_price','_sale_price_dates_from','_sale_price_dates_to','_myshop_semi_full_payment_only','_myshop_semi_deposit','_myshop_specifications','_default_attributes','_personal_summary','_checkout_summary','_myshop_show_on_checkout','_myshop_tag_sort'))")
        (DEST/'product-meta.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf8')
        print('Product metadata',len(meta))
    finally:s.close();c.close()
    urls={'home':'https://www.365d4u.com/','fresh':'https://www.365d4u.com/custom-api.php?action=products_by_date&per_page=8&page=1','sale':'https://www.365d4u.com/custom-api.php?action=live_sale_products&per_page=10','test-config':'https://testmedusa.365d4u.com/api/config'}
    def fetch(item):
        name,url=item;r=requests.get(url,timeout=45);r.raise_for_status()
        (DEST/(name+('.html' if name=='home' else '.json'))).write_text(r.text,encoding='utf8')
        if name=='test-config':
            d=r.json();print(name,{k:d.get(k) for k in ['checkout_enabled','applepay_enabled','ocean_sandbox','payment_policy']})
        else:print('Fetched',name,r.status_code,len(r.content))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,urls.items()))

if __name__=='__main__':main()
