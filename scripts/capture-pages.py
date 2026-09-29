"""Capture owned public pages as migration input. No authenticated requests."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import requests

root = Path(__file__).resolve().parent.parent
destination = root / '.private' / 'rendered'
destination.mkdir(parents=True, exist_ok=True)
pages = json.loads((root / '.private' / 'posts.json').read_text(encoding='utf-8'))
paths = ['/'] + ['/' + p['post_name'] + '/' for p in pages if p['post_status']=='publish' and p['post_type'] in ['page','post'] and p['post_name'] not in ['ga-set', 'index']]
previous={item['path']:item for item in json.loads((destination/'manifest.json').read_text())} if (destination/'manifest.json').exists() else {}

def capture(path):
    if path in previous:return previous[path]
    key = hashlib.sha256(path.encode()).hexdigest()[:16]
    response = requests.get('https://www.365d4u.com' + path, timeout=45)
    response.raise_for_status()
    (destination / (key + '.html')).write_bytes(response.content)
    return {'path': path, 'file': key + '.html', 'status': response.status_code, 'bytes': len(response.content), 'final_url': response.url}

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for item in pool.map(capture, paths):
        results.append(item)
        print(item['path'], item['status'], item['bytes'], flush=True)
        (destination / 'manifest.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
