# 原支付控制插件业务迁移

2026-09-23 对照本地插件及正式 WordPress 的只读查询核实。正式站 `active_plugins` 包含 `woocommerce-365d4u-payment-control`，`sendEmail.php` 的线上版本与本地通知流程一致。

## Oceanpayment 额度

- 正式配置：`custom_pay_control_enabled=yes`、`custom_pay_control_order_total=1000`。
- 金额 **大于或等于 USD 1,000** 时，信用卡和 Apple Pay 均不可选；PayPal 保留。
- 原 `_no_ocean_limit=yes` 的单订单豁免对应 Medusa 订单 metadata `no_ocean_limit=true`。管理员可在 Invoices 列表切换，后台记录操作人和时间，只允许修改未付账单。
- 账单页面、购物车页面、账单 method/payment API、Oceanpayment provider 都执行限制。provider 通过数据库里的 session → collection → order 关联读取豁免，不信任客户端传入的金额限制或豁免字段。
- 配置：`OCEAN_LIMIT_ENABLED`、`OCEAN_ORDER_LIMIT`。已发起的外部交易不会因调整额度而被取消；已确认的有效收款仍处理回执。

## 付款成功通知

确认原 `sendEmail.php` 在未付状态转为 processing/completed/paid 时通知指定邮箱，并调用 RabbitMQ management publish API。原手工 `paypal` / `Paypal Direct` 方式排除；线上 PPCP PayPal、Ocean 信用卡、Ocean Apple Pay 参与。

新实现只对服务端已确认 capture、且订单足额收款的记录入队，订阅 `payment.captured`、`order.placed`。每分钟对账任务补漏，处理付款先于订单生成、回调和浏览器同时完成、进程中断等情况。历史导入不发送通知，捕获时间必须在 `PAID_NOTIFICATIONS_START_AT` 之后。

| 环境 | 邮件收件人 | RabbitMQ routing key |
|---|---|---|
| test | zsc@365d4u.com | order_paid_test |
| production | salted_fish@qq.com | order_paid |

用户明确要求测试邮件与测试队列都启用。环境由 `BUSINESS_ENVIRONMENT` 指定，不能用 `NODE_ENV=production` 判断业务环境。生产通知额外校验正式站域名，避免测试站配置错误向生产队列投递。

沿用邮件主题 `Order Pay Success#订单号`，保留原队列字段：email、transaction_id、paypal_transaction_id、ocean_transaction_id、order_no、pay_time、shipping、billing、amount、method、source_type、order_date。PayPal 使用真实 capture ID，Ocean 使用签名回执的 payment_id；时间格式保持上海时区，method 对应原 Woo gateway ID。通知 HTML 对动态字段进行转义。

通知在 `d4u_content_record` 中以 `paid-notification:环境:order_id:channel` 唯一存储。邮件与队列独立发送、独立重试，发送失败不回滚已收款订单。工作者使用原子领取、两分钟租约、指数退避；SMTP 必须确认接收，RabbitMQ 必须返回 `routed=true`，并启用 TLS 验证。日志不输出订单地址或通道密钥。

同一业务事件只建立一条通知任务。网络在远端已接收后断开仍可能重试，因此外部投递是至少一次；消息属性 `message_id` 和邮件 Message-ID 固定。队列消费者如需严格去重，应使用 message_id 或订单号，不能将 RabbitMQ publish 回应当成下游处理完成。

## 验证

- 沙箱 #200019 信用卡与 #200020 PayPal 都已收款；四条通知均 `sent`、首次发送成功。
- SMTP 接受指定测试收件人，RabbitMQ 确认路由至 `order_paid_test`；不等同于人工打开邮件或下游业务消费验收。
- 对 #200019 重放两次真实签名回调，每个通道仍一条通知、一次发送。
- #200018 验证额度边界、后台豁免、匿名请求拒绝；直接调用原生 Medusa session API 并伪造豁免参数，也无法绕过限制。
- 单元测试验证金额边界、环境隔离、队列字段、真实交易 ID、时区与邮件转义；后端构建通过。

## 未付款账单邮件（2026-09-24，测试站）

对照 `CustomerInvoiceEmail.php`、`Cus365dPayForm.php` 和原邮件模板迁移。按用户最新要求，原来的“备注首行作为邮箱”规则已替换为独立 Email 字段；Note 只作为客户可见文本，任何位置出现邮箱都不触发发送。保留原 Note 的多行显示、文本转义和有备注时明细名称强调样式。没有发现额外的 Note 指令解析器；Respond/CRM 的关联元数据不由 Note 改写。

`INVOICE_EMAIL_ENABLED=true` 在测试环境启用。创建或编辑未付账单时设置 Email 会建立发送任务；同一账单、邮箱及通道以唯一键防止普通重复投递。修改 Note 不重发已经成功的邮件；尚未发送的任务使用最新保存的备注。更换 Email 时取消旧邮箱尚未投递的任务，新地址建立独立任务。发送前再次检查账单未取消、未足额付款、客户收件人仍有效。

客户邮件包含旧站品牌模板、明细、金额、Note 和短付款链接。内部副本在客户邮件发送成功后才处理：测试地址 `zsc@365d4u.com`，生产规则保留原账单插件的 `salted_fish@foxmail.com`（本次未部署生产，且与付款成功通知的 QQ 邮箱是不同规则）。

队列存于 `d4u_content_record` 的 `invoice-mail:` 记录，每分钟处理和补漏；只处理新功能明确启用的账单，不向历史订单自动补发。复用 `PAID_SMTP_*` 配置，SMTP 接受才标记 sent，最多六次尝试并退避。客户邮件与内部副本独立记录，失败不影响账单创建或收款。使用固定 Message-ID，但 SMTP 接收后连接断开等不确定结果仍可能重试，不能承诺外部邮箱绝对只收到一次。

Email、Note 修改以及邮件状态变化进入账单审计；详情页显示收件人、通道、尝试次数、发送时间和状态。数据库回滚验证覆盖 Email 唯一触发、Note 不发信、不重复排队、重试、客户先于副本、改邮箱以及已付账单抑制；SMTP 连接及认证已验证，本次未实际向客户发信。

尚未完成的全站迁移事项见 `acceptance.md`。

## 地址选择

账单付款页 Country / Region、带固定列表的 State 可搜索；新地址默认 United States (US)，已有保存地址优先。州代码和英文名称从原 WooCommerce `i18n/states.php` 迁移；无固定列表的国家保留文本输入。搜索框支持键盘与手机触摸，改变国家清空旧州，底层提交仍使用国家/州代码。

375×667 手机视口测试通过：美国默认值、Canada → Ontario、United States → California、非列表国家文本州输入、地址一致勾选和无横向溢出。

## 客户付款确认邮件（2026-09-28，测试站）

测试站新增 `customer_email` 通道，发送到付款时保存的邮箱，包含订单明细、金额、地址和 PDF 账单；PayPal API、Ocean 信用卡及 Apple Pay 的已核实足额收款适用，手动 Paypal Direct 不发送。`CUSTOMER_PAID_EMAIL_START_AT=2026-09-28T08:07:06Z`（北京时间 16:07:06），不补发此前付款。后台模板、预览、邮件日志、账单详情均接入，缺少有效邮箱时记录 skipped。其他原站关闭的状态邮件仍关闭。

本次只发布 `testmedusa.365d4u.com`，未更新 Medusa 正式站或旧 WordPress。备份 `/var/www/d4u_medusa/shared/backups/customer-paid-email-20260928-160645`；发布脚本 `scripts/deploy-customer-paid-email.py`。68 项测试、完整后端/管理端构建、手机/桌面及只读权限路由检查通过；线上默认创建页和列表切换通过，服务器端模板预览、日志查询与 PDF 生成通过。已有浏览器验收账号没有邮件管理权限，因此对应接口按预期返回 403，管理数据用已授权 SSH 只读验证；没有调整权限或发送真实客户验收邮件。全部缺口见 `email-parity-audit.md`。
