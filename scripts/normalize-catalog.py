"""Convert private WP export into allowlisted Medusa migration input."""
import collections
import os
import html
import json
import re
from urllib.parse import unquote
from pathlib import Path
import phpserialize

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get('EXPORT_DIR', str(ROOT / '.private')))
data = json.loads((SOURCE / 'wordpress-export.json').read_text(encoding='utf-8'))

def unserialize(value):
    if not isinstance(value, str) or not value.startswith(('a:', 's:', 'b:', 'i:', 'd:')):
        return value
    try:
        return phpserialize.loads(value.encode(), decode_strings=True)
    except (ValueError, UnicodeError):
        return value

def local_links(value):
    if isinstance(value, dict): return {str(k): local_links(v) for k,v in value.items()}
    if isinstance(value, list): return [local_links(v) for v in value]
    if isinstance(value, str): return value.replace('https://www.365d4u.com', '').replace('http://www.365d4u.com', '')
    return value

posts = {str(p['ID']): p for p in data['posts']}
meta = collections.defaultdict(dict)
for item in data['postmeta']:
    meta[str(item['post_id'])][item['meta_key']] = unserialize(item['meta_value'])
termmeta = collections.defaultdict(dict)
for item in data['termmeta']:
    termmeta[str(item['term_id'])][item['meta_key']] = unserialize(item['meta_value'])
terms = {str(t['term_taxonomy_id']): t for t in data['terms']}
relations = collections.defaultdict(list)
for r in data['relationships']:
    if str(r['term_taxonomy_id']) in terms: relations[str(r['object_id'])].append(terms[str(r['term_taxonomy_id'])])
variants = collections.defaultdict(list)
for p in data['posts']:
    if p['post_type'] == 'product_variation' and p['post_status'] == 'publish': variants[str(p['post_parent'])].append(p)

def image(identifier, size=None):
    m = meta[str(identifier)]
    file = m.get('_wp_attached_file', '')
    if not isinstance(file, str) or not file: return ''
    if size and isinstance(m.get('_wp_attachment_metadata'), dict):
        sized = m['_wp_attachment_metadata'].get('sizes', {}).get(size, {}).get('file')
        if sized: file = file.rsplit('/', 1)[0] + '/' + sized
    return file if file.startswith('https://') else 'https://img.365d4u.com/c365/' + file.lstrip('/')

def amount(value):
    try: return float(value) if str(value).strip() else None
    except (TypeError, ValueError): return None

def term(t):
    return {'id': int(t['term_id']), 'name': html.unescape(t['name']), 'slug': t['slug'], 'parent': int(t['parent']), 'description': t['description'], 'count': int(t['count']), 'display_type': termmeta[str(t['term_id'])].get('display_type', 0), 'url': '/product-category/' + t['slug'] + '/', 'image': image(termmeta[str(t['term_id'])].get('thumbnail_id', ''))}

products = []
for p in data['posts']:
    if p['post_type'] != 'product': continue
    pid = str(p['ID']); m = meta[pid]
    categories = [term(t) for t in relations[pid] if t['taxonomy'] == 'product_cat']
    tags = [term(t) for t in relations[pid] if t['taxonomy'] == 'product_tag']
    brands = [term(t) for t in relations[pid] if t['taxonomy'] == 'product_brand']
    parents = {str(t['id']) for t in categories}
    changed = True
    while changed:
        old = len(parents)
        for t in data['terms']:
            if str(t['term_id']) in parents and int(t['parent']): parents.add(str(t['parent']))
        changed = old != len(parents)
    category_slugs = [t['slug'] for t in data['terms'] if str(t['term_id']) in parents and t['taxonomy'] == 'product_cat']
    options = collections.defaultdict(list); normalized_variants = []
    for v in variants[pid] or [p]:
        vm = meta[str(v['ID'])]
        attrs = {k.removeprefix('attribute_').removeprefix('pa_').replace('-', ' ').title(): html.unescape(str(value)) or 'Any' for k,value in vm.items() if k.startswith('attribute_')}
        if not attrs: attrs = {'Option': 'Default'}
        for name, value in attrs.items():
            if value not in options[name]: options[name].append(value)
        regular = amount(vm.get('_regular_price', vm.get('_price')))
        price = amount(vm.get('_price', vm.get('_regular_price')))
        if any('deposit' in str(value).lower() for value in attrs.values()) and regular is not None: price = regular
        normalized_variants.append({'legacy_id': int(v['ID']), 'title': ' / '.join(attrs.values()), 'sku': vm.get('_sku') or 'WP-' + str(v['ID']), 'options': attrs, 'price': price, 'regular_price': regular, 'stock': amount(vm.get('_stock')), 'manage_inventory': vm.get('_manage_stock') == 'yes', 'allow_backorder': vm.get('_backorders') in ['yes','notify'], 'stock_status': vm.get('_stock_status', 'instock'), 'image': image(vm.get('_thumbnail_id', ''))})
    # Medusa requires unique option combinations; retain the source ID as an explicit option when necessary.
    combos = [json.dumps(v['options'], sort_keys=True) for v in normalized_variants]
    if len(combos) != len(set(combos)):
        options['Reference'] = [str(v['legacy_id']) for v in normalized_variants]
        for v in normalized_variants: v['options']['Reference'] = str(v['legacy_id'])
    gallery = [{'type': 'video' if posts.get(str(i), {}).get('post_mime_type', '').startswith('video/') else 'image', 'url': image(i)} for i in str(m.get('_product_image_gallery', '')).split(',') if i and image(i)]
    display_prices = [v['regular_price'] for v in normalized_variants if v['regular_price'] is not None]
    public = {'id': int(pid), 'name': html.unescape(p['post_title']), 'description': local_links(p['post_content']), 'short_description': local_links(p['post_excerpt']), 'price': f'{min(display_prices):.2f}' if display_prices else '', 'regular_price': f'{min(display_prices):.2f}' if display_prices else '', 'url': '/product/' + p['post_name'] + '/', 'image': image(m.get('_thumbnail_id', ''), 'woocommerce_thumbnail'), 'gallery_images': gallery, 'video': image(m.get('_myshop_video_id', '')), 'video_width': m.get('_myshop_video_width'), 'video_height': m.get('_myshop_video_height'), 'favorites_count': int(m.get('_favorites_count') or 0), 'comments_count': int(m.get('_wc_review_count') or 0), 'categories': categories, 'tags': tags, 'category_slugs': category_slugs, 'category_ids': list(parents), 'tag_slugs': [t['slug'] for t in tags], 'tag_ids': [str(t['id']) for t in tags], 'is_semi': 'semi-custom' in category_slugs, 'is_ready_to_ship': 'ready-to-ship' in category_slugs, 'semi_deposit': m.get('_myshop_semi_deposit') == '1', 'type': 'variable' if variants[pid] else 'simple', 'specifications': m.get('_myshop_specifications', ''), 'sort': amount(m.get('_myshop_sort')) or 0, 'created_at': p['post_date_gmt'], 'stock_status': m.get('_stock_status', 'instock'), 'variants': normalized_variants}
    public.update(brands=brands,brand_slugs=[b['slug'] for b in brands],brand_ids=[str(b['id']) for b in brands])
    products.append({'legacy_id': int(pid), 'title': html.unescape(p['post_title']), 'handle': p['post_name'] or 'wp-' + pid, 'status': 'published' if p['post_status']=='publish' else 'draft', 'description': html.unescape(p['post_content']), 'thumbnail': public['image'], 'images': list(dict.fromkeys([image(m.get('_thumbnail_id', ''))] + [g['url'] for g in gallery if g['type']=='image'])), 'options': [{'title': key, 'values': values} for key,values in options.items()], 'variants': normalized_variants, 'legacy': public})

for product in products:
    previous = product['handle']
    canonical = re.sub(r'[^\w-]+', '-', unquote(previous)).replace('_','-').lower()
    canonical = re.sub(r'-+', '-', canonical).strip('-') or 'wp-' + str(product['legacy_id'])
    if canonical != previous:
        product['handle'] = canonical
        product['legacy']['original_url'] = product['legacy']['url']
        product['legacy']['url'] = '/product/' + canonical + '/'
if len({p['handle'] for p in products}) != len(products):
    raise ValueError('Canonical product URL collision; resolve explicitly before import')

api = SOURCE / 'api'
home = local_links(json.loads((api/'homepage_settings.json').read_text(encoding='utf-8'))['data'])
reviews_raw = json.loads((api/'reviews.json').read_text(encoding='utf-8'))
reviews = [{k: v for k,v in review.items() if k in ['id','reviewer_name','rating','title','content','review_date','product_id','product_handle','media','helpful_count']} for review in reviews_raw.get('reviews', [])]
content = {'homepage_settings': {'status': 200, 'msg': 'success', 'data': home}, 'category_tree_all': local_links(json.loads((api/'category_tree_all.json').read_text(encoding='utf-8'))), 'all_tags': local_links(json.loads((api/'all_tags.json').read_text(encoding='utf-8'))), 'reviews': {'reviews': reviews, 'total': len(reviews), 'max_pages': 1}, 'live_sale_products': local_links(json.loads((api/'live_sale_products.json').read_text(encoding='utf-8')))}
output = {'exported_at': data['exported_at'], 'products': products, 'categories': [term(t) for t in data['terms'] if t['taxonomy']=='product_cat'], 'content': content}
target = SOURCE / 'medusa-import.json'
target.write_text(json.dumps(output, ensure_ascii=False), encoding='utf-8')
print('Normalized:',len(products),'products,',sum(len(p['variants']) for p in products),'sellable variant records; private review fields excluded')
