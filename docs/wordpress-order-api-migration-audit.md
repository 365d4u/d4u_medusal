# WordPress 订单 API 调用盘点与兼容迁移方案

后续状态：4 个兼容路径已在本地实现，配置、验证和历史字段补齐方式见 [实现说明](woocommerce-compatibility.md)。下文保留实施前排查结论，不能作为当前已实现功能的唯一清单。

排查日期：2026-09-26。目标：为 `E:\d4u_medusal` 后续替换 `www.365d4u.com` 的 WordPress/WooCommerce 做准备。本轮只做源码排查和方案，不实现接口、不切换调用方、不部署。

用户确认的编号原则：**保留 Medusa 当前新的订单编号体系，与原 WordPress 编号并存；兼容迁移不重新编号、不将新单改成旧单编号。**

## 1. 结论与证据边界

在 `E:\PycharmProjects` 当前本地源码中，确认 **4 个项目有指向旧站的订单读取调用及域名配置**，另有 **1 个项目具备可配置的订单读取代码但默认关闭**；此外 **1 个项目调用旧站创建订单**。这是源码依赖盘点，不等于这些脚本此刻全部在生产运行。

扫描包括主域名/裸域名、`wp-json`、WooCommerce SDK/适配器、配置变量和调用链；补扫了 Git 忽略的源文件。依赖目录、虚拟环境、构建资源、导出数据及备份副本不作为独立调用项目计数。未请求真实订单接口，未查询业务数据库，未核验生产 crontab、插件启用状态或访问日志；动态配置、远端独有脚本及其他工作目录不在完整性保证范围内。

| 项目 | 接口与用途 | 本地证据及状态 |
|---|---|---|
| `new_system` | `GET /wp-json/wc/v3/orders`、`GET /wp-json/wc/v3/orders/{id}`；批量同步网站收款，并根据 PayPal 关联号补查单笔订单 | [sync_payments_to_new_payments.py](E:/PycharmProjects/new_system/scripts/sync_payments_to_new_payments.py:343)，单笔函数在 374 行；本地 `WC_BASE_URL` 指向旧站。脚本是否定时运行未核验 |
| `flow_system` | 同上；独立项目的收款同步 | [sync_payments_to_new_payments.py](E:/PycharmProjects/flow_system/scripts/sync_payments_to_new_payments.py:349)，单笔函数在 380 行；本地 `WC_BASE_URL` 指向旧站。不能因为文件相似就合并为一个项目 |
| `biz365d4u-cli` | `GET /wp-json/wc/v3/orders`；售前统计的建单数量、付款时间及建单至付款间隔 | [woocommerce.py](E:/PycharmProjects/biz365d4u-cli/src/biz_cli/adapters/woocommerce.py:17)、[presale_service.py](E:/PycharmProjects/biz365d4u-cli/src/biz_cli/services/presale_service.py:34)；默认和本地 URL 指向旧站，实际调用还受凭据配置及 mock 开关控制 |
| `cron_task` | `POST /wp-json/cus365d/v1/get_order_status`；按订单号批量取来源，用于飞书来源字段补齐 | [cmd_update_feishu_sourcetype.py](E:/PycharmProjects/cron_task/cmd_update_feishu_sourcetype.py:200)；URL 硬编码，读取 `success/data/exists/source_type`。这是命令脚本，文件名不能证明已进入 cron |
| `365d4u/projects/chat_analysis_app`（条件依赖） | `GET /wp-json/wc/v3/orders/{id}`；支付证据核对 | [woocommerce_client.py](E:/PycharmProjects/365d4u/projects/chat_analysis_app/backend/core/domains/payments/woocommerce_client.py:82)、[config.py](E:/PycharmProjects/365d4u/projects/chat_analysis_app/backend/core/config.py:83)；默认 enabled=false、base_url 为空，需显式启用。链接解析器识别旧站域名；本轮未确认生产启用 |
| `responstat`（业务名称 respondstat，创建接口） | `POST /wp-json/cus365d/v1/auto_create_order`；创建收款订单、取得付款链接 | [woo_order_service.py](E:/PycharmProjects/responstat/service/woo_order_service.py:114)；URL 硬编码。属于建单，不计入上面的 4 个读取项目 |

`chatwoot_message` 的 Chat Link、`crawl_fedex_dhl` 的 customer-says 链接、`snapup` 邮件首页链接，以及 `cron_task` 的 order-preview 链接，是页面链接依赖，不是这次发现的订单 HTTP 读取调用。知识索引中的域名和备份代码也不计数。

## 2. 必须保留的外部接口契约

### A. 标准订单列表与详情

- `GET /wp-json/wc/v3/orders`
- `GET /wp-json/wc/v3/orders/{id}`
- 鉴权兼容两种既有用法：HTTP Basic（Biz CLI、chat_analysis_app）和 query 中的 `consumer_key` / `consumer_secret`（new_system、flow_system）。不能使用 Medusa publishable key 替代订单读取权限。沿用旧凭据时需单独迁移校验机制，不能假设 WordPress 凭据会自动适用于 Medusa；URL 参数必须从访问日志中脱敏。
- 列表支持调用方已用的 `page`、`per_page`、`after`、`before`、`status=any`、`orderby=date`、`order=desc`；返回顶层数组，详情返回顶层对象，不能包装为 `{orders: [...]}`。保留 `X-WP-TotalPages`，建议一并保留 `X-WP-Total`。日期边界、默认排序、空页与站点时区按旧 Woo 实现/脱敏样本验证。
- new_system/flow_system 用空页或不足一页终止遍历；Biz CLI 还读取总页数。分页必须在旧归档和新订单合并后统一过滤、排序、计数和截取，不能分别分页后拼接。

调用方实际消费的字段：

| 用途 | 字段 |
|---|---|
| 标识及支付链接校验 | `id`（数字）、`number`、`order_key` |
| 状态及金额 | `status`、`total`、`currency`；金额保持 Woo 字符串格式 |
| 时间窗口/统计 | `date_created`、`date_created_gmt`、`date_modified_gmt`、`date_paid`、`date_paid_gmt` |
| 收款识别 | `transaction_id`、`payment_method`、`payment_method_title` |
| 客户 | `billing.email/first_name/last_name/phone/address_1/address_2/city/state/postcode/country` |
| 来源关联 | `meta_data` 中 `_respond`、`is_respond_order`；为原插件兼容还需 `_crm`、`is_crm_order`、`_wc_order_attribution_source_type` |
| 证据核对 | `refunds`、PayPal order/capture/payer 元数据；解析器支持 `_ppcp_paypal_order_id` 等别名，见 provider_evidence.py 的常量与 `_first_provider_ref` |

这是已观察到的最小消费字段，不代表完整 WooCommerce orders schema。若承诺“原样”，需要进一步为行项目、fee_lines、shipping、税费、退款及 `_links` 等完整返回建立对照样本，不能以调用方暂未读取为由声明完全等价。

状态必须用 Woo 语义：`pending / on-hold / processing / completed / cancelled / failed / refunded`。flow/new 的同步脚本只接收 `processing/completed/paid`；chat_analysis_app 只将 `processing/completed` 视为 Woo 已付。因此不能直接返回 Medusa 的 `captured` 或仅返回账单视图的 `paid`。授权不等于收款、部分退款不等于全额退款，状态映射应结合支付、退款、履约事实，并用案例验收。

### B. 自定义批量状态/来源

原实现：[Cus365dRespondSendOrder.php](E:/c365/ecom365d4u/app/public/wp-content/plugins/woocommerce-365d4u-payment-control/Cus365dRespondSendOrder.php:25)。插件入口有 require，生产启用状态未核验。

- 路径：`GET` 或 `POST /wp-json/cus365d/v1/get_order_status`；当前 cron_task 用 JSON POST。
- `order_ids` 接受数组或逗号分隔字符串；原代码用 PHP intval 转换并跳过非正数。缺失/空列表返回 400，错误 code 为 `invalid_order_ids`。全是无效非正 ID 时原实现可能返回空 PHP 数组，这个边界也应保留样本。
- 成功 200：`{"success":true,"data":{"123":{"status":"processing","source_type":"Respond","exists":true}}}`。
- 不存在：`{"status":null,"source_type":"","exists":false}`；不能伪装成 pending/failed。
- 来源优先级：`is_respond_order` → `Respond`；否则 `is_crm_order` → `CRM`；否则 `_wc_order_attribution_source_type`。保留大小写和空字符串含义。
- 当前本地原插件 permission_callback 为 `__return_true`，调用方不传鉴权。上线设计须明确保留的公开字段范围和限流，不得悄悄改为员工登录接口导致后台脚本中断。

### C. 自定义建单及付款链接

原实现：[Cus365dRespondSendOrder.php](E:/c365/ecom365d4u/app/public/wp-content/plugins/woocommerce-365d4u-payment-control/Cus365dRespondSendOrder.php:80)。以这次本地代码为依据；旧专项说明只描述 Respond，当前源码还支持 CRM，实施前要复核线上版本。

- `POST /wp-json/cus365d/v1/auto_create_order`；参数 `name`、`amount`、`note`，且 `respond_id` / `crm_id` 必须恰有一个非空；responstat 当前发送 respond_id。
- 原代码对 amount 用 intval：例如 12.9 转为 12，再校验大于 0。兼容迁移不能默默改成 12.90；是否升级金额规则应作为独立版本变更。
- 创建 pending 订单和一条 fee line，写入来源标记/关联 ID、客户 note，并返回 HTTP **200**：`success/order_id/payment_url/source`。responstat 把非 200 视为失败，因此不能照搬当前 Medusa 管理端创建接口的 201。
- 原付款链接为 `/payit/{数字订单号}/{订单密钥}`。responstat 消费返回 URL；chat_analysis_app 还提取订单密钥并与 API `order_key` 对照，因此付款 URL 和详情必须使用一致的外部标识。
- 保留 WP 风格错误对象及状态码：`invalid_name`、`invalid_amount`、`invalid_source_id` 为 400；建单异常为 `create_order_failed` / 500。
- 原建单接口未要求登录、未接收幂等键。建议新适配器内部复用现有创建锁，并支持可选幂等键；老调用不传键时不能仅按姓名/金额去重，否则合法重复开单会被吞掉。新增强制鉴权须配套升级调用方，不能宣称无修改兼容。
- 建单只负责创建和返回链接，不能额外发送 Respond 消息或邮件；现有调用方的发送步骤仍由调用方负责。

## 3. 当前 Medusa 项目的可复用部分与缺口

| 现有代码 | 结论 |
|---|---|
| [invoices.ts](../apps/backend/src/lib/invoices.ts)、[invoice-routes.mjs](../apps/storefront/src/invoice-routes.mjs) | 已有创建账单、支付集合、幂等锁和 `/payit/:number/:key`。但内部使用 Medusa order ID，外部密钥为 `mo_...` / token；历史 Woo order_key 尚不能靠现有 invoiceRecord 自动校验 |
| [import-history.ts](../apps/backend/src/scripts/import-history.ts)、[export-history.py](../scripts/export-history.py) | 旧订单保存为 `d4u_content_record` 的 `order:{id}` 归档；不是可支付 Medusa 订单，也不是完整 Woo REST 快照 |
| [migrate-admin-source.cjs](../scripts/migrate-admin-source.cjs) | 已有补充 payment_date、origin、配送信息等的代码，但只保留选定字段。不能由 origin 反推出 `_respond`、完整支付元数据或原订单密钥；也未证明所有环境执行过该补丁 |
| [admin-order-report.ts](../apps/backend/src/lib/admin-order-report.ts) | 已合并展示 WordPress 历史、新账单和原生订单，可参考数据来源；其内部返回格式不能直接作为 Woo API 输出 |
| [paid-notifications.ts](../apps/backend/src/lib/paid-notifications.ts) | 已有付款通知及原队列格式适配，可用于验证下游一致性；需要让兼容层来源/Respond/CRM 标记与通知读取的事实一致 |
| [middlewares.ts](../apps/backend/src/api/middlewares.ts)、[configure-nginx.py](../scripts/configure-nginx.py) | 需增加订单兼容路由及独立 API 鉴权；目前 wp-json 没有专用后端转发规则，仅发现 storefront 的 myshop 商品兼容路由 |

当前源码未发现上述 4 个订单 API 路由的实现。历史导出缺少完整订单级 meta_data、order_key、退款表达及部分付款字段，需扩充导出/增量同步，不能直接对现有归档补空值就声明兼容。

建议新增独立 `woocommerce-compat` 服务层，统一完成：外部数字 ID 映射 → 归档/新订单查询 → Woo 格式序列化 → 权限/错误转换。route handler 只处理请求与响应；不要求把 PHP 搬入 Node 运行，也不让调用方直接读 Medusa 表。

编号方案遵循用户确认：旧单继续使用原 Woo ID，Medusa 新单继续使用当前新编号（对外 display_id）；Medusa 内部 order ID 保持原样。兼容层持久记录“来源系统 + 对外编号 → 历史归档或 Medusa 内部 ID”的映射与唯一约束，不新建一套替代现有新编号的规则。旧号查归档，新号查 Medusa，所有列表/详情/建单响应/付款链接保持同一编号。实施前只核验两套编号是否有交集和旧站并行增长边界；不能仅凭“新单从 200000 开始”的旧部署记录断言永不冲突。如发现交集，须单独制定兼容路由处理方案，不能自动重编号已有订单或使已发链接失效。

## 4. 接口之外，停用 WordPress 前必须处理的依赖

1. **直接读库的付款补偿**：[cron_compensate_paid_orders.py](E:/PycharmProjects/cron_task/cron_compensate_paid_orders.py:528) 通过数据库连接读 Woo HPOS 或 posts/postmeta，并执行后续同步。它不依赖旧站 HTTP 域名，迁移 API 不会自动让它读取新单。建议改为消费新站兼容 API/付款事件，保留必要的旧单只读补偿；需验证去重和补偿窗口。本轮未运行它。
2. **旧未付款链接**：归档查询可用不代表旧链接可以继续支付。须单独决定旧未付单/在途支付的承接方式，保留原密钥映射、付款回调路由与交易关联，不能将历史已付订单重建成可扣款订单。
3. **支付证据的域名和密钥格式识别**：chat_analysis_app 的 SUPPORTED_WOOCOMMERCE_HOSTS 仅包含 `365d4u.com/www.365d4u.com`，且 payit 路径要求数字订单号和 `wc_order_` 开头的密钥。当前 Medusa 的 `mo_` 链接即使换回原域名也不会被该解析器识别。需要更新解析器支持新域名/新密钥，或在兼容出口提供可校验的旧格式别名；不改变新订单编号，详情 order_key 必须与返回链接一致。
4. **链接型功能**：`order-preview/?email=...`、`?cw_key=...` 等不是本次 API 列表，但旧站完整替换仍需页面兼容审查。
5. **付款通知与增量数据**：已有 Medusa 付款通知不代替历史增量同步。必须覆盖切换期间旧站新建/修改订单、退款、支付回调，以及补偿脚本重复处理同一交易的情况。

## 5. 分阶段实施与验收

1. **冻结基线**：只读复核生产各调用入口、实际计划、原插件版本和 Woo 版本；收集脱敏响应样本，明确哪些调用启用。记录当前凭据校验方式，不在代码/报告里保存密钥。
2. **先补数据模型**：定义外部 ID 映射、旧单 REST 必要字段、来源和支付事实；补齐可重复执行的增量导入。以业务更新时点维护日期，不能把导入时间作为 date_modified_gmt；不触发付款、发货或历史通知。
3. **实现 3 个读取路径**：订单列表、订单详情、批量状态。支持新旧数据统一分页、筛选、鉴权和错误语义。测试站用脱敏固定样本逐字段比较，不改变生产调用方。
4. **实现建单与旧链接承接**：通过现有账单/支付服务创建新单，补齐 fee/source/note 元数据与外部 key 映射。把真实来源记录为 API 客户端，不能伪装成登录员工。隔离消息发送和历史通知。
5. **调用方回归**：直接以 flow/new 的字段提取函数、Biz CLI 的分页和统计逻辑、cron 的来源补齐逻辑、chat_analysis 的证据校验、responstat 的 HTTP 200/付款链接解析验证，不仅检查 HTTP 200。
6. **灰度和切换**：先在测试域通过，再按已验证依赖逐个切换配置或路由；硬编码 URL 的 cron/responstat 需配置化，或最终保留 www 原域名。上线前完成最后增量对账、旧支付回调分流和直接读库脚本迁移。写流量一次只由一个系统承接。

验收至少包括：旧/新/不存在/冲突订单号；跨边界分页、相同创建时间的稳定排序、时区；待付、授权、已付、部分退款、全额退款、取消；Respond/CRM/普通来源；两种 Woo 鉴权；错误对象；金额/日期类型；正确/错误订单密钥；并发建单和可选幂等键；回调重放不重复入账或通知。

回滚不只是改回 DNS：一旦新站接受新订单或付款，须继续保留它们的查询、付款与回调处理，避免回滚后新单不可见。每一步应记录路由配置、增量同步水位、ID 映射版本及已切换调用方。

本次交付为本文件；未实现业务代码或执行支付/同步/生产切换。后续可按第 5 节拆分实施任务。
