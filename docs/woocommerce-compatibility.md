# WooCommerce 订单接口兼容层

2026-09-26 实现，并按用户要求部署到测试站和 Medusa 生产站。依据 [调用方盘点](wordpress-order-api-migration-audit.md)，覆盖已发现客户端的订单读取和 Respond/CRM 建单协议。**Medusa 新订单编号保持原样；WordPress 旧编号继续查询历史归档。** 原 WordPress 域名和外部调用方配置未切换。

## 接口

| 方法与路径 | 行为 |
|---|---|
| `GET /wp-json/wc/v3/orders` | 合并历史归档和 Medusa 非草稿订单，统一过滤/分页；顶层数组；`X-WP-Total`、`X-WP-TotalPages` |
| `GET /wp-json/wc/v3/orders/{id}` | 数字 ID 定位旧归档或 Medusa display_id；无记录为 Woo 风格 404；不接收 Medusa 内部字符串 ID |
| `GET/POST /wp-json/cus365d/v1/get_order_status` | `order_ids` 数组、逗号字符串；返回 `success/data`，每条为 `status/source_type/exists`；不存在为 null/空字符串/false |
| `POST /wp-json/cus365d/v1/auto_create_order` | 接收 `name/amount/note`、恰有一个 `respond_id/crm_id`；返回 HTTP 200 与 `success/order_id/payment_url/source` |

读取列表支持 `page`（默认 1）、`per_page`（默认 10，上限 100）、`status`（默认 any）、`after/before`、`orderby=date/id/modified` 和 `order=asc/desc`。after/before 按创建时间进行排他边界筛选；未含时区的时间按配置的旧站时区解释。空页仍保留总数/总页数。同时间订单以数字编号稳定排序。

标准订单接口接受 HTTP Basic 或 query 的 `consumer_key/consumer_secret`，凭据错误为 401，服务端未配置凭据为 503。两个 cus365d 接口保留旧版不要求员工登录的调用方式；建单增加显式上线开关，默认关闭。批量状态最多接受 1000 项。响应均 no-store。

## 新旧编号、状态和付款链接

- 旧号查 `d4u_content_record` 的 `order:{id}`，新号查 Medusa `order.display_id`，不调用 setval、不修改已发出的编号。任一编号同时命中两套数据时返回 409 `woocommerce_order_id_conflict`；列表也会拒绝输出存在编号冲突的混合数据。
- Native 收款达到订单总额后返回 `processing`，已完成的已付订单为 `completed`；全额退款为 `refunded`，部分退款仍保留已付状态并带退款条目；仅授权/部分收款为 `on-hold`，取消为 `cancelled`，其他为 `pending`。历史订单保留原 Woo 状态。付款尝试失败不自动等同于整个 Medusa 订单失败。
- API 建单复用现有 createInvoice 和支付集合，不直接调用支付渠道。原接口 amount 的整数截断语义保留，例如 12.9 → 12；新系统已有上限保留：标题 200 字、note 2000 字、金额 USD 1,000,000。
- 建单保留来源标记、`_respond/_crm` 和 customer note；API 操作人记作 `api:woocommerce-compat`，不伪装员工。不会额外发送邮件/Respond 消息。正常付款之后仍进入现有已付款通知流程，通知也支持 CRM 来源。
- 返回 `/payit/{现有新编号}/wc_order_{32位摘要}`。此密钥由现有 invoice token 派生，与订单详情 `order_key` 一致；服务端支付入口接受该别名。原 `mo_` 和 64 位 token 链接继续有效，支付渠道回跳仍使用原有 canonical 路径。
- 可传 `Idempotency-Key`（最多 200 字）复用现有账单创建锁/指纹；同键同内容复用订单，同键改内容或来源返回 409。老调用不传键时每次独立建单，不能按同名同金额擅自去重；调用方超时重试应使用稳定幂等键。

## 历史字段完整性

现有历史归档足够返回已保存的订单号、状态、金额、地址和部分时间/来源，但不是原始 Woo REST 快照。未补全时响应包含 `X-D4U-Legacy-Partial: true`，不伪造原 order_key、PayPal 元数据、Respond 关联 ID、退款或可支付链接。该响应头用于上线前对账，不能以基础查询成功替代数据完整验收。

提供一次性维护命令：

```powershell
# 文件必须留在私有目录；内容是 Woo GET /orders 返回的原始对象数组。
$env:WORDPRESS_ORDER_API_SNAPSHOT = 'E:\d4u_medusal\.private\woo-orders-page.json'
npm --prefix apps/backend run import:woo-contract
```

从后端目录执行也可：`npm run import:woo-contract`。需由该环境的后端加载正确 DATABASE_URL。每个文件 1–10000 条，允许按原 API 分页分文件导入。

导入器只给已存在的 shop_order 归档补入 `woo_rest`，不创建新 Medusa 订单，不触发工作流/收款/通知。验证 ID 唯一、必需字段和时间，拒绝比归档旧的快照；一份文件在一个事务内完成，任一缺失归档/错误都会整批回滚。重复导入同版本安全。响应优先使用完整快照，查询索引逻辑也使用快照的创建/更新时间、状态和金额。

本次未导出或导入真实订单。不要在补充后直接重跑会覆盖 payload 的旧全量 import-history；后续全量同步须保留/更新 `woo_rest`。完整快照仍需要在切换前刷新，不能把一次导入当持续同步。

## 上线配置与路由

在目标后端的私有环境中配置：

- `WOO_COMPAT_CONSUMER_KEY`、`WOO_COMPAT_CONSUMER_SECRET`：当前调用方使用的一对 key/secret；或用 `WOO_COMPAT_API_KEYS` JSON 数组配置多对。没有自动读取 WordPress 密钥，也没有生成/替换调用方凭据。
- `WOO_COMPAT_TIMEZONE`：原 WordPress 站点时区，默认 UTC；正式切换前必须核对。查询参数带 Z/偏移量时按明确时间解释。
- `WOO_COMPAT_CREATE_ENABLED=true`：准备承接建单后再开启。
- `STOREFRONT_URL`：返回付款链接的正式 Origin，沿用已有配置。

`scripts/configure-nginx.py` 已加入标准订单和 cus365d 到后端 9055 的路由、限流和关闭 URL 访问日志；正式域名脚本复用该模板。Medusa 的 Morgan URL/referrer token 同时对 key/secret query 参数脱敏，包含百分号编码的参数名。两台服务器已应用范围限定的接口路由和代码。

部署代码、凭据和 Nginx 后，先使用独立 Medusa 域名测试。两个硬编码 www 地址的调用方不会自动切换；需在后续上线任务中修改调用配置或切换旧域名。chat_analysis_app 的域名白名单仍需支持过渡域名；此次未修改其他项目。

## 验证与边界

新增 `tests/woocommerce-compat.test.ts`，用隔离 PGlite PostgreSQL 引擎验证真实查询 SQL；测试数据均为 fixture。测试覆盖两种鉴权及失败响应、参数、时区、PHP 金额规则、来源优先级、新旧密钥、敏感信息排除、HTTP 返回契约、合并分页、付款/退款状态、编号冲突，以及快照幂等/旧版本拒绝/事务回滚。PGlite 仅为开发测试依赖，不进入业务数据库。

验证命令：`npm test`、`npm run build:backend`。不需要连接生产数据库或运行外部调用方脚本。

本次本地验证结果：全套 **65 项测试通过**（含 11 项兼容测试及子测试），Medusa 后端和管理端构建通过。SQL 验证使用 PGlite。部署后的接口验收见下节；没有为本次发布发起支付渠道扣款。

## 2026-09-26 双环境发布记录

| 环境 | 入口 | 回滚备份 |
|---|---|---|
| 测试 | https://testmedusa.365d4u.com | `/var/www/d4u_medusa/shared/backups/woo-compat-20260926-095109` |
| Medusa 生产 | https://medusa.365d4u.com | `/data/d4u_medusal/shared/backups/woo-compat-20260926-095320` |

生产域名切换已按用户要求撤销，当前继续使用 `medusa.365d4u.com`，`www.custom365d.com` 不再作为本项目入口。原 WordPress 的 `www.365d4u.com` 未切换。域名恢复记录见 [生产部署记录](production-deployment.md)。

发布脚本为 `scripts/deploy-woocommerce-compat.py`，复核脚本为 `scripts/verify-woocommerce-deployment.py`。由于生产账单/后台版本早于测试站，发布器以每个环境当前代码为基础，只补入兼容 helper、来源元数据、幂等指纹和密钥校验；没有顺带升级生产站的账单邮件、员工后台或媒体模块。发布的目标源码和编译文件保存在本机私有 staging 目录，可与服务器逐文件核对。

两个环境均启用 `WOO_COMPAT_CREATE_ENABLED=true`。通过原站 REST index 核实其时区为 `Asia/Shanghai`，两边兼容层使用该时区。生产配置了已发现调用方使用的两对既有凭据；测试使用独立生成的凭据。凭据只保存于私有文件和服务器 env，不写入此文档。

两边均通过列表/详情、历史归档、Basic 和 query 鉴权、批量状态 GET/POST、不存在订单及无效建单参数检查。生产未创建测试订单、未导入历史数据或执行 schema 迁移。测试站创建并保留 #200022（Respond）与 #200023（CRM）两张各 USD 1.00 的未付款验证单，用于验证整数金额、重复提交幂等、改内容冲突和付款链接；没有扣款或发送邮件/消息。

私有验收报告：`.private/woo-test-verification.json`、`.private/woo-production-verification.json`。原域名仍由 WordPress 提供服务；外部项目硬编码 www 的调用仍然访问原站。生产历史接口仍返回 `X-D4U-Legacy-Partial: true`，补齐快照和旧未付款订单承接继续作为切换前条件。

备份包含原代码、后端 env、原虚拟主机配置以及新增文件清单；发布失败会恢复本次覆盖文件，并移除本次新增的代码文件，不回滚或删除订单数据。应用服务只重启 Medusa backend，Nginx 仅重载指定站点改动，storefront 和 Redis 持续运行。

此兼容层覆盖盘点到的调用行为，并非整个 WooCommerce REST API 的完整替代。新订单的商品内部 ID、退款 ID 与原 Woo 不同；尚未提供 Woo 商品/客户/退款 CRUD 或未发现的过滤参数。旧未付款订单归档不会因此成为可收款 Medusa 订单，旧密钥的支付承接仍需独立迁移。`cron_task` 直接读 Woo 库的付款补偿也不会自动转向本接口。

下一次上线应核对：编号无交集、历史快照已补齐、时区及两种鉴权通过、原调用方字段/分页结果一致、新建单返回链接能在测试环境付款，并处理旧订单在途支付和直接读库任务。发生故障时可关闭建单开关；已创建的新单及其回调需继续保留，不能只靠域名回退丢弃它们。
