"""Export customer/order history privately; does not run WooCommerce or cron."""
import json
import os
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location('wp_export', Path(__file__).with_name('export-wordpress.py'))
wp = importlib.util.module_from_spec(spec); spec.loader.exec_module(wp)
queries = {
  'customers': "SELECT JSON_OBJECT('id',ID,'email',user_email,'display_name',display_name,'registered_at',user_registered,'password_hash',user_pass) FROM wp_users",
  'customer_meta': "SELECT JSON_OBJECT('user_id',user_id,'key',meta_key,'value',meta_value) FROM wp_usermeta WHERE meta_key IN ('first_name','last_name','billing_first_name','billing_last_name','billing_phone','billing_country','billing_address_1','billing_address_2','billing_city','billing_state','billing_postcode','shipping_first_name','shipping_last_name','shipping_phone','shipping_country','shipping_address_1','shipping_address_2','shipping_city','shipping_state','shipping_postcode','_wishlist')",
  'orders': "SELECT JSON_OBJECT('id',id,'status',status,'currency',currency,'type',type,'total_amount',total_amount,'tax_amount',tax_amount,'customer_id',customer_id,'billing_email',billing_email,'date_created_gmt',date_created_gmt,'date_updated_gmt',date_updated_gmt,'parent_order_id',parent_order_id,'payment_method',payment_method,'transaction_id',transaction_id,'customer_note',customer_note) FROM wp_wc_orders",
  'order_addresses': "SELECT JSON_OBJECT('order_id',order_id,'address_type',address_type,'first_name',first_name,'last_name',last_name,'company',company,'address_1',address_1,'address_2',address_2,'city',city,'state',state,'postcode',postcode,'country',country,'email',email,'phone',phone) FROM wp_wc_order_addresses",
  'order_items': "SELECT JSON_OBJECT('id',order_item_id,'name',order_item_name,'type',order_item_type,'order_id',order_id) FROM wp_woocommerce_order_items",
  'order_itemmeta': "SELECT JSON_OBJECT('item_id',order_item_id,'key',meta_key,'value',meta_value) FROM wp_woocommerce_order_itemmeta WHERE meta_key IN ('_qty','_product_id','_variation_id','_line_subtotal','_line_total','_line_subtotal_tax','_line_tax','cost','method_id','instance_id','total_tax','taxes') OR meta_key NOT LIKE '\\_%'",
  'reviews': "SELECT JSON_OBJECT('id',id,'reviewer_name',reviewer_name,'rating',rating,'title',title,'content',content,'review_date',review_date,'product_id',product_id,'product_handle',product_handle) FROM wp_custom365d_reviews",
  'review_media': "SELECT JSON_OBJECT('review_id',review_id,'media_type',media_type,'media_url',file_url) FROM wp_custom365d_review_media",
}
destination=Path(os.environ.get('EXPORT_HISTORY_DIR','.private/history'));destination.mkdir(parents=True,exist_ok=True)
client=wp.connect()
try:
  for name,sql in queries.items():
    file=destination/(name+'.json')
    if file.exists(): print(name,'already exported',flush=True);continue
    rows=wp.query(client,sql)
    file.write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
    print(name,len(rows),flush=True)
finally:client.close()
