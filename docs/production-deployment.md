# 正式服务器部署

**当前入口仍为 `https://medusa.365d4u.com`。2026-09-26 用户撤销了 custom365d 域名切换；下方切换章节仅为历史记录。飞书/SSO 接入也已停止，未发布。**

2026-09-23 已部署到 `165.154.134.51:2204` 的 `/data/d4u_medusal`，连接 `10.11.181.67:5432/d4u_medusa`。数据库初始为空，重新从正式 WordPress 只读导出并导入；没有复制测试站的 Medusa 测试订单。

## 当前运行状态

| 服务 | systemd 名称 | 本机监听 |
|---|---|---|
| Medusa 后台/API | d4u-medusa-backend | 127.0.0.1:9055 |
| Storefront | d4u-medusa-storefront | 127.0.0.1:8100 |
| 专用 Redis | d4u-medusa-redis | 127.0.0.1:6389 |

Node.js 22.22.2、Redis 7.2.16 安装在 `shared/runtime`。Redis 使用独立目录、端口、密码和 AOF；原系统 Redis 6379 未变。Redis 发布包已与 [官方 SHA256 清单](https://github.com/redis/redis-hashes/blob/master/README) 核对。

数据库返回 PostgreSQL 17.5-ucloudrel1、`ssl=off`；对应内网连接显式使用 `sslmode=disable`，解决 Medusa 对非本地地址默认发起 SSL 握手导致的初始化超时。

后端健康、前端健康、首页、账单创建页面、管理后台均 HTTP 200；管理员登录验证成功；商品接口返回 794 个已发布商品。服务已启用开机启动。

## 数据对账

| 数据 | 数量 |
|---|---:|
| 商品 | 821 |
| 规格 | 4,323 |
| 客户 | 6,313 |
| 历史订单归档 | 52,927 |
| 收藏账户 | 2,180 |
| 评论 | 882 |
| 新 Medusa 订单 | 0 |
| 通知任务 | 0 |
| 下一笔新订单号 | 200000 |

历史订单是可查询归档，不是重新生成的可收款/发货订单。商品、客户及历史订单来自本次重新导出的正式数据；页面展示配置、直播等展示内容仍有较早同日快照。正式切换前须同步此后旧站新增或修改的数据，现有导入脚本不是完整增量同步器。

对账结果：服务器 `shared/deployment-verification.json`、`shared/service-verification.json`，本地 `.private/production-data-verification.json`、`.private/production-service-verification.json`。

## 正式访问入口（2026-09-26 已恢复原域名）

- 前台：https://medusa.365d4u.com/
- 管理后台：https://medusa.365d4u.com/app/
- 独立账单页面：https://medusa.365d4u.com/invoices/new/

DNS 指向 165.154.134.51。独立 Nginx vhost 已启用 HTTPS，HTTP 自动跳转；Let's Encrypt 证书已配置自动续期与 reload hook；当前证书信息见下方域名切换记录。STORE/ADMIN/AUTH CORS、STOREFRONT_URL、PUBLIC_BACKEND_URL 均使用新域名。新站暂保留 noindex，避免与现有 WordPress 重复收录。

现有 www.365d4u.com 的 WordPress vhost 与原备份逐字节一致；此次发布没有切换旧站。

生产收款配置：

- PayPal、Oceanpayment 信用卡及 CHECKOUT_ENABLED 已启用，使用原站正式商户配置。PayPal 正式 OAuth 校验通过。
- 新增独立 PayPal webhook `/hooks/payment/paypal_paypal`，订阅 PAYMENT.CAPTURE.COMPLETED；原 WooCommerce webhook 保留。共享商户应用的非 Medusa 订单事件在验签后忽略。
- Oceanpayment 回调地址为 `https://medusa.365d4u.com/webhooks/oceanpayment`；订单额度限制为 1000 USD（大于等于该金额默认不支持 Ocean，可由后台对单笔账单豁免）。
- 用户明确暂不添加新域名 Apple Pay 白名单，因此前端及后端 Apple Pay provider 均关闭，区域仅关联 PayPal 和 Ocean 信用卡。
- 正式邮件/队列已启用；BUSINESS_ENVIRONMENT=production，目标为 salted_fish@qq.com / order_paid。PAID_NOTIFICATIONS_START_AT 设置为启用时间，历史订单不补发通知。
- 已通过 24 项支付相关自动化测试、后端/管理端构建，以及新域名首页、后台、管理员登录、375px 手机端账单创建和列表页面检查。没有创建正式测试账单、发起真实扣款或发送虚假付款通知。
- 全站等价迁移遗留项见 `acceptance.md`。域名发布及配置校验不代表已完成真实支付验收；Apple Pay 真机验收也仍待完成。

SMTP 认证及生产 order_paid 队列只读连通性验证通过；新订单仍为 0，下一单号为 200000，通知任务为 0。原 WordPress vhost 已再次校验未改动。

验证报告：本地 `.private/production-domain-verification.json`、`.private/production-payment-readiness.json`。新域名发布脚本为 `scripts/configure-production-domain.py`；正式支付启用脚本为 `scripts/activate-production-payments.py`，其运行前须完成支付测试和后端构建。

## 运维位置

- 私有环境：`apps/backend/.env`、`apps/storefront/.env`，文件权限 0600。
- 管理员账号：`admin@365d4u.com`，随机密码在服务器 `shared/admin-bootstrap.json` 与本地 `.private/production-deployment.json`；未写入代码或文档。
- 初始化日志：`bootstrap.log`、`bootstrap-resume.log`。
- Redis 升级前备份：`shared/backups/redis-before-7.2.16.tar.gz`。
- WordPress Nginx 原配置只读备份：本地 `.private/production-original-nginx.conf`。
- 初始化部署脚本：`scripts/deploy-production.py`；初次对账脚本：`scripts/finalize-production.cjs`。初始化脚本用于新环境，不应当作正式运营后的常规更新脚本反复导入快照。

查看运行状态：`systemctl status d4u-medusa-backend d4u-medusa-storefront d4u-medusa-redis`。业务日志用对应 unit 的 `journalctl` 查看。仅前端模板和静态资源更新时，更新指定文件并重启 storefront；后端修改需要构建后发布对应源码/编译文件并重启 backend。

## WooCommerce 兼容接口（2026-09-26）

已将订单列表/详情、批量状态和 Respond/CRM 建单接口部署到 Medusa 生产站（当前 medusa.365d4u.com），并同步部署到测试站。当前生产版本较测试站旧，本次只对现有账单模块做兼容增量修改，没有整体覆盖测试站的后台功能。订单编号不变，原 WordPress 域名及外部调用方不切换。

生产备份：`/data/d4u_medusal/shared/backups/woo-compat-20260926-095320`。已启用兼容建单、现有调用方凭据和 Asia/Shanghai 时区，完成查询/鉴权/无效参数验证；未创建生产测试订单或执行数据导入。历史归档缺失字段仍待补齐。详细配置、测试和回滚边界见 [WooCommerce 兼容说明](woocommerce-compatibility.md)。

## 2026-09-26 正式域名切换（已按用户要求撤销，仅保留操作记录）

生产入口改为 `https://www.custom365d.com`。按用户明确要求，`medusa.365d4u.com` 的 HTTP/HTTPS 页面、订单接口和支付回调全部返回 **410 Gone**，不跳转、不代理，也不兼容旧链接。旧 vhost 仅保留停用响应与 ACME 证书续期路径，避免落入其他站点的默认虚拟主机。测试站仍使用 `testmedusa.365d4u.com`。

新域名此前存在未启用的旧 WordPress vhost，已先备份再替换。由于服务器留有该域名的旧证书 archive，本次使用独立证书名称 `d4u-medusa-custom365d`，SAN 为 `www.custom365d.com`，有效期至 2026-12-25 01:28:53 UTC。证书路径 `/etc/letsencrypt/live/d4u-medusa-custom365d/`，webroot 为 `/data/d4u_medusal/shared/acme`，沿用证书续期后的 Nginx reload hook。

只更新生产 Nginx 和两个应用 env 中的公开域名/CORS，再重启 backend、storefront；应用代码、订单编号、数据库和其他配置未变。PayPal 通过官方 webhook PATCH 更新已有 Medusa webhook 的 URL 为 `https://www.custom365d.com/hooks/payment/paypal_paypal`，保留 webhook ID 和事件订阅，其他 WordPress webhook 未变。Oceanpayment 的新支付会话由更新后的 `PUBLIC_BACKEND_URL` / `STOREFRONT_URL` 生成新域名回调与回跳地址，Apple Pay 仍关闭。

验证：HTTPS、首页/健康/后台/账单页、管理员登录和 CORS、手机端账单界面、Woo 订单鉴权查询/分页与状态接口、旧域名所有业务路径 410、三个服务 active。浏览器检查未发起对旧 Medusa 域名的请求。此次没有创建订单或发起真实支付；当前没有生产账单可用于现有付款链接抽样，因此付款链接域名通过运行环境配置确认，不宣称完成真实付款验收。`www.365d4u.com` 及其他已启用站点配置逐字节核对未变。

部署脚本：`scripts/migrate-production-domain.py`（一次性切换；默认只读预检，`--apply` 执行，成功后重复运行会拒绝覆盖已启用新站）。UI 验证：`node scripts/check-production-domain.cjs`。常规生产发布/验证脚本中的入口也已更新为新域名。

备份：`/data/d4u_medusal/shared/backups/domain-custom365d-20260926-022826`，`manifest.json` 对应各 `original-N` 文件，包含切换前的两个 vhost 与两份 env，另有 PayPal webhook 快照和验收报告。回退时须同时恢复这些文件、撤销新站 enabled 软链接并恢复原 PayPal webhook URL，执行 `nginx -t` 后重载及重启应用；不恢复数据库。私有本地验收报告：`.private/production-custom-domain-verification.json`、`.private/production-domain-verification.json`。

## 2026-09-26 用户撤销域名切换

按用户要求恢复 `medusa.365d4u.com` 的原有 Nginx vhost、两个应用的公开 URL/CORS 与 PayPal webhook URL；撤下 `www.custom365d.com` 的 enabled 配置，并还原其原先未启用的旧配置。独立 custom365d 证书保留，续期配置移入回退备份停用。支付商户、Woo 兼容接口、订单数据和编号、测试环境均不变。常规发布脚本和当前入口文档也恢复原域名。

恢复脚本：`scripts/restore-production-domain.py`。期间发现 `medusa.365d4u.com` 的 DNS 已不存在（1.1.1.1 与 223.5.5.5 均返回 NXDOMAIN），已请用户恢复 `medusa → 165.154.134.51` 的 A 记录。服务器验收可定向连接已知 IP，仍验证 HTTPS 主机名与证书，不能将此结果等同于公网 DNS 已恢复。最终配置验收记录保存于 `.private/production-domain-restore-verification.json`。

用户随后确认恢复解析，已通过 1.1.1.1、223.5.5.5 和本机正常 DNS 确认 A 记录为 `165.154.134.51`；不使用 DNS 覆盖的公网 HTTPS 首页、健康、后台和账单页面均返回 200。管理员登录/CORS、Woo 查询和状态接口验证通过，PayPal webhook 已核实恢复原地址，三个应用服务均 active。回退备份为 `/data/d4u_medusal/shared/backups/domain-revert-20260926-024852`。

飞书登录接入仅进行了源码和说明排查，没有发布 Medusa 登录代码、修改 SSO 服务或修改飞书应用配置。
