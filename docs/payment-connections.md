# 后台支付接入配置

入口：Medusa Admin → Store settings → Payments → 支付接入配置。

可维护 PayPal、Ocean Pay 信用卡、Ocean Apple Pay 的接入开关、账号和密钥。PayPal 和 Ocean 可选择 Sandbox / Production；Apple Pay 共用 Ocean 的 Account 和环境，但独立维护 Terminal、Secure Code。PayPal 的 REST App 名称仅作备注，真正标识应用的是 Client ID。

密钥输入框不会回显已有值，留空表示保留；填写新值后保存即替换。信用卡 Public Key 可留空。开启接入时校验必填字段；保存只验证配置格式，不代表支付平台认证或真实收款验收通过。

页面下方原有的「结账展示与额度」控制显示名称、排序、展示开关和 Ocean 额度。支付方式需要同时开启接入及展示开关；购物车还需要在 Settings → Regions 中关联相应 provider。Apple Pay 的商户域名登记和设备支持仍需满足，保存配置不会替代域名登记。

## PayPal REST App

1. 登录 [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/)，进入 Apps & Credentials。
2. 选择 Live（正式）或 Sandbox（测试），点击 Create App；本站自营收款在出现类型选择时使用 Merchant。名称可填 `365D4U Medusa`。
3. 从该 App 复制 Client ID 和 Client Secret。
4. 在同一个 App、同一个环境中添加 Webhook，URL 使用本后台配置页展示的地址，订阅 `PAYMENT.CAPTURE.COMPLETED`，复制生成的 Webhook ID。
5. 将同一套环境、Client ID、Client Secret、Webhook ID 保存到 Medusa。当前仅支持一套用于新付款的 PayPal App，不提供多 App 分流。

参考：[创建 REST 凭据](https://www.paypal.com/tm/cshelp/article/how-do-i-create-rest-api-credentials-ts1949)、[PayPal Webhooks](https://developer.paypal.com/api/rest/webhooks)。

## 生效与在途付款

- 首次保存前兼容 `PAYPAL_*`、`OCEAN_*`、`APPLEPAY_ENABLED` 环境变量；已有部署不会因更新代码自动启用原本关闭的接入。
- 首次保存时将原配置保存为版本 0，此后保存完整的新版本并更新当前版本指针。保存后所有进程的新支付请求读取数据库配置，无需重启；环境变量不再覆盖已保存版本。
- 新会话的签名绑定包含配置版本。查询、扣款、退款和回调校验沿用该会话版本；旧的未带版本会话使用版本 0。停止新付款不会停止已有回调处理。
- 修改 PayPal App、Webhook 或 Ocean 终端时，须保留旧平台配置可用。版本记录不能让已被支付平台撤销的凭据重新有效。不要删除旧 App/回调或轮换旧密钥，直到其在途交易及后续退款需求处理完成。
- Ocean 退款仍通过原商户后台操作；本次没有增加 Ocean 退款 API。
- 回调 URL 和网站 URL 由部署环境计算，页面只读展示，不允许浏览器修改服务地址。

## 存储与权限

配置使用 AES-256-GCM 加密后保存到现有 `d4u_content_record`，不需要新数据库迁移。加密密钥从部署的 `COOKIE_SECRET` 派生；须在备份与恢复时保留相同的密钥。变更它之前需要迁移配置密文，它也用于原有支付会话签名。

管理员接口只返回非密钥字段和「已配置」状态，公共支付策略只返回启用状态及环境标志。修改审计记录操作人、版本和变化的字段名，不保存明文密钥。并发保存通过数据库事务、锁和版本校验保护，旧页面不会覆盖新配置。

沿用现有管理员认证和权限：启用 Staff Access 时仅 super admin 可修改；有 Store settings 查看权限的员工只能查看脱敏配置。账单员工无此接口权限。

## 验证与部署

运行 `npm test`、`npm run build:backend`、`node scripts/check-payment-connections-ui.cjs`。UI 验证使用本地模拟接口，输出到忽略目录 `artifacts/payment-connections`，不连接真实支付平台。

部署须同步 backend 和 storefront 的本次改动：前台环境标志由后端返回，避免继续使用另一份过期环境变量。首次发布需要构建并重启服务，此后后台保存配置无需重启。支付 provider 始终注册，以支持后台启停及历史回调；是否可发起新支付仍由保存的接入开关和展示开关共同控制。

## 2026-09-29 测试环境发布

已发布至 `https://testmedusa.365d4u.com`。后台入口 `/admin`、`/admin/` 均以 302 跳转 `/app/`；支付配置页面为 `/app/store-settings`。正式环境未更新。

本次为定向文件发布，保留两份环境文件和原有支付账号、启用状态，没有导入数据或保存新的商户配置。备份为 `/var/www/d4u_medusa/shared/backups/payment-connections-20260929-134455`。发布脚本 `scripts/deploy-payment-connections.py` 默认只读预检，`--apply` 执行发布；已有远端源码差异须核对后通过精确哈希放行。

验证：后端及管理端构建通过，上传文件哈希一致；首页、健康、后台、账单页面、前台配置和支付策略接口返回 200，三个服务 active。实际浏览器验证 `/admin` 跳转至登录页及账号权限拦截，无 JavaScript 异常；匿名读取、修改支付配置均拒绝。服务器只读校验确认配置版本 0、PayPal/Ocean 沙箱环境及密钥脱敏正常，沿用当前环境的三个接入开关。未创建订单、发起扣款、发送验收邮件或修改权限。

现有浏览器验收账号仅有受限权限，对配置页及接口按预期返回无权限，因此在线管理员编辑流程未用该账号验收。管理员表单的保存、冲突、撤销、密钥不回显以及桌面/手机布局已通过本地模拟接口验证；加密存储、旧会话及回调处理由自动化测试覆盖。

首次发布校验因未携带 Store API 公开密钥而自动恢复旧版本；修正验证请求后重新发布成功。公开 API Key 仅用于服务器端验证，未写入报告。发布及验证记录在忽略目录 `.private/payment-connections-deployment/`。
