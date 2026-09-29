# 邮件迁移核查（2026-09-28）

对照实际生产 WordPress `www.365d4u.com` 的 `/data/c365/app/public`，只读检查启用插件、PHP 触发器和 `wp_options` 邮件设置。Medusa 正式入口为 `medusa.365d4u.com`；不能把本地或测试站代码当作正式站已发布的证据。

| 功能 | 旧站实际规则 | 本次处理 / 当前差异 |
|---|---|---|
| 未付账单付款链接 | `CustomerInvoiceEmail.php` 给客户发 `Invoice #…` | 已迁移；按此前用户要求独立 Email 字段触发，Note 不控制收件人 |
| 账单管理员副本 | `salted_fish@foxmail.com` | 保持一致，测试环境为 `zsc@365d4u.com` |
| 付款成功内部通知 | `sendEmail.php` 给 `salted_fish@qq.com` 发 `Order Pay Success#…` | 保持一致，邮件和 RabbitMQ 分通道处理 |
| 客户付款确认 | WooCommerce `customer_processing_order`，发给订单 `billing_email`；未配置覆盖，默认开启 | 本次补齐，Medusa 对应付款时保存的 `order.email`，确认足额收款后排队 |
| 付款确认 PDF 附件 | 启用的 PDF Invoices 插件将 invoice 附加到 `customer_processing_order` 和 `customer_completed_order` | 本次为客户付款确认补齐 PDF，复用新站现有账单 PDF 渲染；不附内部备注或后台元数据。版式不承诺与旧插件逐像素相同 |
| 手动 PayPal / Paypal Direct | 自定义代码禁止内部付款通知和客户 processing 邮件 | 保留排除；当前 PayPal API 网关对应 `ppcp-gateway`，正常发送，不能一概禁用全部 PayPal |
| 新订单、取消、失败、客户失败、待处理、完成、退款、POS 退款邮件 | 生产设置明确 `enabled=no` | 保留关闭；不是漏发故障 |
| 注册欢迎信 | WooCommerce customer new account 默认流程，没有禁用覆盖 | Medusa 注册接口已有，欢迎邮件触发和模板尚未迁移 |
| 找回密码邮件 | WooCommerce customer reset password 默认流程，没有禁用覆盖 | Medusa 账户找回密码页面、令牌和邮件流程尚未补齐；需与迁移后的认证提供方一起实现 |
| 客户订单备注通知 | WooCommerce customer note 默认流程 | Medusa 没有等价的“向客户发送订单备注”操作和邮件触发；当前 Note 是客户可见账单文本，不等同这条通知 |
| 管理员手动订单邮件 / 重发 | WooCommerce customer invoice 支持后台人工触发 | 当前新站自动账单付款链接已覆盖主要用途，但未付/已付订单的等价人工重发操作尚未迁移 |
| 营销订阅 | 独立于交易邮件 | 新站只保存订阅记录，向原邮件系统同步及确认信尚未接入 |

## 本次客户付款通知的实现边界

- 复用 `paid-notification:` 持久队列，新增 `customer_email` 通道；每个环境、订单、通道一个唯一键，重复回调和重试不重复建任务。
- `CUSTOMER_PAID_EMAIL_START_AT` 必须是有效时间，未设置时不排新客户邮件。部署首次启用时记录服务器 UTC 时间，后续发布保留原值。早于启用时间的付款不会自动补发。
- 同时要求现有 `PAID_NOTIFICATIONS_ENABLED=true`、有效内部通知起始时间和已核实的全额收款；未付款、部分付款、取消订单、未知/手动支付方式不建立客户邮件。
- 收件人来自付款流程保存的 `order.email`，与账单最初发送邮箱独立；空或非法邮箱记录 skipped，不退回管理员邮箱。
- PDF 和正文在排队时保存为快照。SMTP 接受后标记 sent；失败退避重试。固定 Message-ID 无法保证 SMTP 接收后连接中断等极端情况下外部邮箱绝对不重复。
- 邮件模板管理增加 `customer_processing_order`、真实示例预览，邮件日志和账单详情显示客户通知及实际收件人。日志接口不返回 PDF base64 内容。

## 验证

使用隔离 PostgreSQL 兼容测试库与假的 SMTP：验证收件人、完整 PDF 附件、去重、重试、漏任务恢复、历史订单抑制、手动 PayPal 排除、环境隔离、HTML 转义和日志展示。不会向真实客户发送验收邮件，也不发起真实付款。

`/invoices/new` 无 hash 默认显示创建账单；`#list` 和 `#invoice/编号` 仍分别进入列表和详情，没有创建权限的账号默认列表。

## 发布结果

已发布测试站 `testmedusa.365d4u.com`，客户邮件启用时间为 2026-09-28 16:07:06（北京时间）。Medusa 正式站与旧 WordPress 未修改。68 项测试及后端/管理端构建通过；线上手机/桌面默认创建页、列表导航、服务器模板预览、日志、PDF 生成验证通过。受限测试账号无邮件管理权限，403 是预期权限行为，此部分使用服务器只读检查。未通过真实付款或真实邮件发送验收。
