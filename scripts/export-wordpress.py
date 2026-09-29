"""Read-only, no WordPress/plugin bootstrap. Credentials come from environment.

Exports private migration input, never a public web asset. Uses wp db query
because production may have connection settings outside wp-config.php.
"""
import json
import os
from pathlib import Path
import shlex
import datetime
import gzip
import paramiko

QUERIES = {
    "posts": ("wp_posts", "ID,post_parent,post_type,post_status,post_name,post_title,post_content,post_excerpt,post_date_gmt,post_modified_gmt,guid,post_mime_type,menu_order", "post_type IN ('page','post','product','product_variation','attachment','wp_template','wp_template_part','wp_navigation','wp_global_styles') AND post_status NOT IN ('trash','auto-draft','inherit') OR post_type='attachment'"),
    "postmeta": ("wp_postmeta", "post_id,meta_key,meta_value", "post_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('page','post','product','product_variation','attachment','wp_template','wp_template_part') AND post_status NOT IN ('trash','auto-draft')) AND meta_key NOT IN ('_edit_lock','_edit_last')"),
    "terms": ("wp_terms JOIN wp_term_taxonomy USING(term_id)", "term_id,name,slug,term_taxonomy_id,taxonomy,description,parent,count", "1=1"),
    "termmeta": ("wp_termmeta", "term_id,meta_key,meta_value", "1=1"),
    "relationships": ("wp_term_relationships", "object_id,term_taxonomy_id,term_order", "object_id IN (SELECT ID FROM wp_posts WHERE post_type IN ('page','post','product','product_variation','wp_template','wp_template_part'))"),
    "options": ("wp_options", "option_name,option_value", "option_name IN ('home365d_config','page_on_front','woocommerce_currency','woocommerce_permalinks','permalink_structure','d365_customizations_enabled','active_plugins','wc_global_policies') OR option_name LIKE 'theme_mods_%'"),
}

def connect():
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(os.environ['WP_SSH_HOST'], port=int(os.environ.get('WP_SSH_PORT', '22')), username=os.environ.get('WP_SSH_USER', 'root'), password=os.environ['WP_SSH_PASSWORD'], timeout=20)
    return client

def query(client, sql):
    command = 'cd ' + shlex.quote(os.environ.get('WP_ROOT', '/data/c365/app/public'))
    command += ' && wp --allow-root db query ' + shlex.quote('SET SESSION TRANSACTION READ ONLY; START TRANSACTION WITH CONSISTENT SNAPSHOT; ' + sql + '; ROLLBACK;')
    command += ' --batch --raw --skip-column-names | gzip -c'
    _, out, err = client.exec_command('bash -o pipefail -c ' + shlex.quote(command), timeout=180)
    raw = out.read()
    if out.channel.recv_exit_status():
        raise RuntimeError(err.read().decode())
    return [json.loads(line) for line in gzip.decompress(raw).splitlines() if line.strip()]

def main():
    destination = Path(os.environ.get('EXPORT_DIR', '.private'))
    destination.mkdir(parents=True, exist_ok=True)
    client = connect()
    result = {'exported_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': 'https://www.365d4u.com'}
    try:
        for name, (table, fields, where) in QUERIES.items():
            existing = destination / (name + '.json')
            if existing.exists():
                result[name] = json.loads(existing.read_text(encoding='utf-8'))
                print(name, len(result[name]), 'resumed', flush=True)
                continue
            arguments = ','.join("'%s',`%s`" % (field, field) for field in fields.split(','))
            result[name] = query(client, 'SELECT JSON_OBJECT(' + arguments + ') FROM ' + table + ' WHERE ' + where)
            print(name, len(result[name]), flush=True)
            (destination / (name + '.json')).write_text(json.dumps(result[name], ensure_ascii=False), encoding='utf-8')
        (destination / 'wordpress-export.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    finally:
        client.close()

if __name__ == '__main__':
    main()
