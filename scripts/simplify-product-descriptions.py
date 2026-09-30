"""Prepare readable descriptions from the test-only Medusa maintenance export."""
import json
from pathlib import Path
from catalog_description import readable_description
ROOT=Path(__file__).resolve().parents[1]
products=json.loads((ROOT/'.private/description-before.json').read_text(encoding='utf8'))
updates=[]
for p in products:
 original=p.get('description') or ''
 text=readable_description(original)
 if text!=original:updates.append({'id':p['id'],'original':original,'text':text})
(ROOT/'.private/description-updates.json').write_text(json.dumps(updates,ensure_ascii=False),encoding='utf8')
print(json.dumps({'count':len(updates),'sample':next((p['text'] for p in updates if p['id']=='prod_01M361SD87XE60VHYER6T2M7T8'),None)},ensure_ascii=False))
