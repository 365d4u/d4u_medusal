<?php
// Run via SSH stdin: php /dev/stdin /data/c365/app/public
// Never loads WordPress/plugins or executes source configuration.
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$root = $argv[1] ?? '';
$config = file_get_contents($root . '/wp-config.php');
$credentials = [];
foreach (['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'] as $key) {
    if (!preg_match('/define\s*\(\s*[\'\"]' . $key . '[\'\"]\s*,\s*([\'\"])(.*?)\1\s*\)/s', $config, $match)) {
        throw new RuntimeException('Unsupported configuration for ' . $key);
    }
    $credentials[$key] = $match[2];
}
preg_match('/\$table_prefix\s*=\s*[\'\"]([a-zA-Z0-9_]+)[\'\"]/', $config, $m);
$prefix = $m[1] ?? 'wp_';
$host = $credentials['DB_HOST'];
$port = 3306;
if (preg_match('/^([^:]+):(\d+)$/', $host, $m)) { $host = $m[1]; $port = (int)$m[2]; }
$db = new mysqli($host, $credentials['DB_USER'], $credentials['DB_PASSWORD'], $credentials['DB_NAME'], $port);
$db->set_charset('utf8mb4');
$db->query('SET SESSION TRANSACTION READ ONLY');
$db->query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
function rows($sql) { global $db; return $db->query($sql)->fetch_all(MYSQLI_ASSOC); }
function decoded($s) {
    if (!is_string($s) || !preg_match('/^(a|s|i|b|d|N):/', $s)) return $s;
    $v = @unserialize($s, ['allowed_classes' => false]);
    return $v === false && $s !== 'b:0;' ? $s : $v;
}
$result = ['exported_at' => gmdate('c'), 'source' => 'https://www.365d4u.com'];
$result['posts'] = rows("SELECT ID,post_parent,post_type,post_status,post_name,post_title,post_content,post_excerpt,post_date_gmt,post_modified_gmt,guid,post_mime_type,menu_order FROM {$prefix}posts WHERE post_type IN ('page','post','product','product_variation','attachment','wp_template','wp_template_part','wp_navigation','wp_global_styles') AND post_status NOT IN ('trash','auto-draft','inherit') OR post_type='attachment'");
$result['postmeta'] = rows("SELECT m.post_id,m.meta_key,m.meta_value FROM {$prefix}postmeta m INNER JOIN {$prefix}posts p ON p.ID=m.post_id WHERE p.post_type IN ('page','post','product','product_variation','attachment','wp_template','wp_template_part') AND p.post_status NOT IN ('trash','auto-draft') AND m.meta_key NOT IN ('_edit_lock','_edit_last')");
foreach ($result['postmeta'] as &$row) $row['meta_value'] = decoded($row['meta_value']); unset($row);
$result['terms'] = rows("SELECT t.*,tt.term_taxonomy_id,tt.taxonomy,tt.description,tt.parent,tt.count FROM {$prefix}terms t JOIN {$prefix}term_taxonomy tt ON t.term_id=tt.term_id");
$result['termmeta'] = rows("SELECT term_id,meta_key,meta_value FROM {$prefix}termmeta");
foreach ($result['termmeta'] as &$row) $row['meta_value'] = decoded($row['meta_value']); unset($row);
$result['relationships'] = rows("SELECT r.* FROM {$prefix}term_relationships r JOIN {$prefix}posts p ON p.ID=r.object_id WHERE p.post_type IN ('product','product_variation','post','page','wp_template','wp_template_part')");
$result['options'] = [];
foreach (rows("SELECT option_name,option_value FROM {$prefix}options WHERE option_name IN ('home365d_config','page_on_front','woocommerce_currency','woocommerce_permalinks','permalink_structure','d365_customizations_enabled','active_plugins','wc_global_policies','woocommerce_store_address','woocommerce_store_city','woocommerce_default_country') OR option_name LIKE 'widget_%' OR option_name LIKE 'theme_mods_%'") as $row) $result['options'][$row['option_name']] = decoded($row['option_value']);
$result['counts'] = rows("SELECT post_type,post_status,COUNT(*) AS count FROM {$prefix}posts GROUP BY post_type,post_status");
$result['order_counts'] = rows("SELECT status,currency,COUNT(*) AS count FROM {$prefix}wc_orders GROUP BY status,currency");
$result['customer_count'] = rows("SELECT COUNT(*) AS count FROM {$prefix}users");
$result['tables'] = rows('SHOW TABLES');
$db->rollback();
echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
