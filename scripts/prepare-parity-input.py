"""Allowlisted product metadata and owned storefront policy copy, no customer data."""
import collections,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'.private/storefront-parity'
metadata=collections.defaultdict(dict)
for row in json.loads((base/'product-meta.json').read_text(encoding='utf8')):metadata[str(row['id'])][row['key']]=row['value']
raw=json.loads((ROOT/'.private/wordpress-export.json').read_text(encoding='utf8'))
labels={t['slug']:t['name'] for t in raw['terms'] if t['taxonomy'].startswith('pa_')}
policies=json.loads((base/'global-policies.json').read_text(encoding='utf8'))
source=Path('E:/c365/ecom365d4u/app/public/wp-content/plugins/365d-customizations/modules/ready-to-ship-copy/content.php').read_text(encoding='utf8')
copy={name:body for name,tag,body in re.findall(r"'(process|refund|shipping)'\s*=>\s*<<<'([^']+)'\s*\n(.*?)\n\2",source,re.S)}
copy['faqs']=[{'question':question,'answer':answer} for question,tag,answer in re.findall(r"'question'\s*=>\s*'([^']+)',\s*'answer'\s*=>\s*<<<'([^']+)'\s*\n(.*?)\n\2",source,re.S)]
# Shipping is a plain quoted string in some revisions.
if 'shipping' not in copy:
    match=re.search(r"'shipping'\s*=>\s*'((?:\\'|[^'])*)'",source)
    if match:copy['shipping']=match[1].replace("\\'","'")
policies['ready_to_ship']=copy
(base/'import.json').write_text(json.dumps({'metadata':metadata,'labels':labels,'policies':policies},ensure_ascii=False),encoding='utf8')
print('Prepared',len(metadata),'catalog records; ready-to-ship policy sections:',','.join(copy))
