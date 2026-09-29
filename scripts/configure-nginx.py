"""Install only the testmedusa virtual host, after its certificate exists."""
import importlib,sys
sys.path.insert(0,str(__import__('pathlib').Path(__file__).parent))
deploy=importlib.import_module('deploy-test')
conf='''limit_req_zone $binary_remote_addr zone=d4u_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=d4u_invoice:10m rate=60r/m;
server {
    listen 80;
    server_name testmedusa.365d4u.com;
    location ^~ /.well-known/acme-challenge/ { root /var/www/d4u_medusa/shared/acme; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name testmedusa.365d4u.com;
    ssl_certificate /etc/letsencrypt/live/testmedusa.365d4u.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/testmedusa.365d4u.com/privkey.pem;
    client_max_body_size 12m;
    add_header X-Robots-Tag "noindex, nofollow" always;
    location = /app/invoices { return 302 /invoices/new/?feishu=1; }
    location = /app/invoices/ { return 302 /invoices/new/?feishu=1; }
    location = /.well-known/apple-developer-merchantid-domain-association {
        alias /var/www/d4u_medusa/shared/apple-developer-merchantid-domain-association;
        default_type text/plain;
    }
    location ^~ /wp-json/wc/v3/orders {
        # Legacy callers send consumer_secret in the query string.
        access_log off;
        limit_req zone=d4u_invoice burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location = /wp-json/cus365d/v1/auto_create_order {
        access_log off;
        limit_req zone=d4u_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location ^~ /wp-json/cus365d/v1/ {
        access_log off;
        limit_req zone=d4u_invoice burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location ^~ /auth/ {
        limit_req zone=d4u_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location ^~ /api/staff/feishu/ {
        access_log off;
        limit_req zone=d4u_auth burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location = /store/feedback {
        limit_req zone=d4u_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location = /wp-admin/admin-ajax.php {
        limit_req zone=d4u_auth burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location ^~ /store/invoices/ {
        limit_req zone=d4u_invoice burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:9055;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location ~ ^/(payit|checkout/order-pay|api/invoices)(/|$) {
        limit_req zone=d4u_invoice burst=30 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location ~ ^/(app|admin|store|hooks|webhooks)(/|$) {
        proxy_pass http://127.0.0.1:9055;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
    location ~ ^/(api/account/(login|register)|api/staff/login|api/review-media|api/reviews)$ {
        limit_req zone=d4u_auth burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
    }
}
'''
if __name__=='__main__':
    c=deploy.connect()
    try:
        s=c.open_sftp()
        with s.file('/etc/nginx/sites-available/testmedusa.365d4u.com.conf','w') as f:f.write(conf)
        s.close()
        print(deploy.run(c,'nginx -t && systemctl reload nginx'))
    finally:c.close()
