# Invoice 飞书免登与管理后台 SSO

## 当前状态

**2026-09-24 最新规则（取代下方较早的人工分配流程）**：本企业、应用可见范围内的普通飞书用户无需分配，首次登录自动创建员工身份，默认仅创建/查看全部账单。后台入口登录后直接进入 `/app/billing`。管理员仅按以下 user_id 白名单识别：邱军浩 `g6g27173`、张胜超 `2f977a46`、陈奕廷 `g8c48261`、Ada `a749f97b`；名字不参与授权。旧手工授予的 super_admin 标志不能绕过此白名单，邮箱运维账号若未绑定这四人的身份也仅有账单权限。普通商城客户身份仍完全独立，不能进入员工后台。

后端配置：`FEISHU_DEFAULT_ROLE=invoice` 与 `FEISHU_ADMIN_IDENTITIES`（JSON 数组，`user:<id>`）。每个请求重新计算有效权限，已禁用的员工账号不自动重新启用；首次登录通过数据库事务与身份锁保证并发幂等。自动模式下 Staff access 仅供管理员查看，不再要求人工分配、也不允许用旧分配 API 提升其他用户。

飞书返回登录者 user_id 需开通 `contact:user.employee_id:readonly`；用户已确认该权限开通并发布生效。字段缺失时不按姓名猜测管理员，仍允许普通账单权限登录。

2026-09-24：用户已创建飞书网页应用 cli_aa3ec98ab736dbef，并确认测试回调已添加、Invoice 按应用可见范围开放。测试环境已发布 SSO 代码和应用配置。应用凭据校验通过；tenant:tenant:readonly 已开通，官方企业信息接口已验证通过并完成企业绑定。测试环境已发布前后台认证隔离、后台账号分配和页面权限。现有指定管理员完成初始化，飞书员工身份仍需本人登录后由管理员分配；正式环境未启用此次飞书及权限配置。原邮箱密码登录已回归验证。

## 应用形态

Invoice 已有独立手机网页，适合发布为飞书企业自建**网页应用**，从工作台内打开。此方式可在飞书客户端内免去二次登录；无需打包成原生小程序。若必须使用原生小程序外壳，需要另行配置其 WebView 与小程序代码发布流程，本次没有生成原生小程序包。

正式应用桌面端与移动端主页：

`https://medusa.365d4u.com/invoices/new/?feishu=1`

安全设置的重定向 URL：

`https://medusa.365d4u.com/api/staff/feishu/callback`

测试主页已使用 `https://testmedusa.365d4u.com/app/invoices`，Nginx 对该精确路径（含尾斜杠）跳转至独立 Invoice 页面并自动发起飞书登录；完整后台 Invoice 菜单改为 `/app/billing`，iframe 强制使用后台会话，避免与独立 Invoice 会话混用。测试应用使用对应 `testmedusa.365d4u.com` 回调地址；先加入测试回调并完成真人客户端验收，再启用正式域名。飞书后台完成网页能力、重定向 URL、可用范围设置后，创建应用版本并发布；若租户要求审批，还需企业管理员批准。

## 登录和权限

- 飞书内识别到客户端或主页 `feishu=1` 参数时自动发起 OAuth。普通浏览器显示 Sign in with Feishu 按钮，可通过飞书扫码/登录进入。
- 使用 OAuth authorization code + PKCE S256，服务端通过 v3 token 接口及 user_info 获取真实身份；不直接信任浏览器上送的用户 ID。
- 保存 tenant_key、open_id、union_id、可用时的 user_id 和姓名。用户邮箱及手机号不作为身份关联凭据；不要求其敏感权限。一次性 code 和飞书 access_token 不入库、不返回浏览器。
- 使用企业标识及稳定飞书 ID 关联本地身份。当前 App ID 下 open_id 是应用范围标识；union_id 的范围以飞书官方定义为准。
- Invoice 使用独立 invoice_staff actor：可创建、列出账单、查看及复制付款链接。当前授权范围允许查看全部账单，并非仅本人账单；若需要按人员隔离，应在开放前扩展过滤规则。
- Invoice 角色不能访问 `/admin/*`、不能修改 Ocean 额度豁免。管理员必须在 Staff access 中显式分配新账号或绑定已有 Medusa user，才可通过后台登录页的飞书按钮进入完整管理后台。不得自动按照同名或同邮箱绑定管理员。
- 权限在每次业务请求时重新检查；账号禁用、页面权限移除后，已有邮箱及飞书后台会话同样受到限制。
- 账单 created_by / invoice_created_by 记录稳定飞书 actor ID，可通过对应 auth_identity 的 provider metadata 查到身份。
- 本站 Sign out 清除本站会话，并暂停当前标签自动免登；不会退出整个飞书客户端。

## 私有配置

后端 `.env`：

```dotenv
STAFF_ACCESS_ENABLED=true
FEISHU_ENABLED=false
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_TENANT_KEY=
FEISHU_BRIDGE_SECRET=
FEISHU_INVOICE_ACCESS=allowlist
FEISHU_INVOICE_ALLOWLIST=[]
FEISHU_ADMIN_BINDINGS={}
```

白名单示例为 `["union:on_example","open:ou_example","user:employee_id"]`；管理员绑定示例为 `{"union:on_example":"user_existing_medusa_id"}`。白名单和绑定的 JSON 配置在 env 中使用单引号包裹原始 JSON（例如 FEISHU_ADMIN_BINDINGS='{"union:on_example":"user_existing_id"}'），不要依赖 dotenv 解析反斜杠转义的双引号。FEISHU_BRIDGE_SECRET 使用至少 32 字符随机密钥，仅前后端服务共享。

若用户批准应用可见范围内所有员工使用 Invoice，设置 FEISHU_INVOICE_ACCESS=app，仍强制校验 FEISHU_TENANT_KEY。不要在人员范围未确定时开启。

前端 `.env` 仅需 FEISHU_ENABLED、FEISHU_APP_ID 和相同的 FEISHU_BRIDGE_SECRET；App Secret 仅保存在后端。STOREFRONT_URL 必须是实际 HTTPS 域名。

## 部署及验证

1. 后端执行 `npm run test:payments` 和 `npm run build`，发布变更源码与 `.medusa/server` 对应文件；管理登录页 widget 需要发布本次构建的完整 Admin 资源。
2. 发布 storefront 新登录模块、server、invoice routes、builder JS 和模板；发布前端 `node --test apps/storefront/tests/feishu-login.test.mjs` 验证。
3. Nginx 模板增加 `/api/staff/feishu/` 限流并关闭其 access_log，避免 OAuth code 被写入请求日志。不要更改 WordPress vhost。
4. 应用和授权配置到位后启用；重启 Medusa 和 storefront。分别用允许和未允许的真实飞书账号，在 PC 和手机客户端验证免登、拒绝越权、退出和重新登录。
5. 管理员绑定单独验收；配置 MFA 的身份若需要额外验证，当前 BFF 会拒绝建立会话，不会跳过验证。

自动化测试覆盖企业/人员边界、管理员与 Invoice 隔离、撤销权限、登录请求签名、state、时效、PKCE 绑定、模拟官方 code/user_info 响应和令牌不泄漏。尚未完成真实飞书账号的端到端验收。

## 官方依据

- [网页应用免登流程](https://open.feishu.cn/document/client-docs/h5/development-guide/step-3)
- [获取授权码（飞书客户端内可免确认跳转）](https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code)
- [获取 user_access_token v3](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token-v3)
- [获取登录用户信息与标识范围](https://open.feishu.cn/document/server-docs/authentication-management/login-state-management/get)

既有 `E:\PycharmProjects\feishu_sso` 中心已读源码核对；本实现直接使用飞书官方 OAuth，不修改该 SSO 服务。若复用它的飞书应用，应为新站追加回调配置，不覆盖该应用现有主页、回调或可用范围。

测试部署脚本：`scripts/deploy-feishu-test.py`，更新 SSO、客户认证隔离、员工权限、Invoice UI 和 Admin 构建文件，保留支付及通知配置。2026-09-24 备份：`/var/www/d4u_medusa/shared/backups/feishu-20260924-093826`。已验证测试入口跳转、OAuth client_id/回调/PKCE、伪造请求拒绝、错误 state 拒绝及原管理员登录。


## 后台账户分配与客户隔离（2026-09-24）

- 客户使用 `customer-emailpass` 或历史 `wordpress` provider；员工使用 `emailpass` 或 `feishu` provider。客户 cookie `d4u_customer` 不被后台及 Invoice 登录使用。
- 完整后台登录：`https://testmedusa.365d4u.com/app/login`；分配页面：`https://testmedusa.365d4u.com/app/staff-access`；员工首页：`/app/staff-home`。
- 员工先点后台的 Sign in with Feishu 完成一次身份核验；未分配时会被拒绝进入，但仅将飞书核验过的企业标识、姓名、open_id 等登记为待分配身份。
- 现有超级管理员在 Staff access 选择已核验身份，分配新账号或绑定指定旧账号，勾选可查看页面，保存。允许绑定自己的飞书身份，但不允许自行禁用或移除自己的超级管理员权限。
- 普通分配只授予所选页面查看权限。创建 Invoice、修改单张 Invoice 的 Oceanpayment 限额是独立权限；完整商城写操作仅超级管理员可用。
- 仍保留用户此前确认的独立 Invoice 权限：飞书应用可见员工可以使用独立账单页，不因此拥有完整后台账号。禁用完整后台账号不会撤回这项独立授权。
- 数据存放在已有 d4u_content_record：`staff:<user_id>`、`feishu-seen:<identity>`、`feishu-binding:<identity>` 和 `staff-audit:<uuid>`。每次权限变更保留操作者及前后值。
- 未分配账号、客户 token、未知后台接口均默认拒绝。直接输入未授权页面地址会被页面守卫拦截；服务端权限不依赖菜单是否显示。
- 项目使用独立权限实现，不启用 Medusa 企业 RBAC。构建插件包装固定 2.18.0 dashboard 的菜单和路由组件；上游结构变化会令构建失败，必须重新核对后发布。
- 首次部署必须在数据库备份后执行 initialize-staff-access，仅通过 STAFF_BOOTSTRAP_EMAIL 初始化一个现有管理员；脚本同时迁移历史客户 emailpass 凭据，拆分可能存在的客户/员工混合身份。重复执行不会自动提升其他账号。

本次备份：`/var/www/d4u_medusa/shared/backups/feishu-20260924-100440`，含数据库 dump、原源码、Admin 构建和环境配置。
已通过 32 项后端测试、3 项 OAuth/会话隔离前端测试及构建；线上浏览器/API 验证了管理员邮箱登录、分配界面、客户注册/登录、客户 cookie 与 bearer 无法进入后台、只读账单页面、写入拒绝、旧 token 的权限即时更新/禁用和禁止管理员自行锁死。临时客户和员工测试账号已删除。真实飞书个人账号的 OAuth 验收仍需用户在飞书内完成。

追加验收：逐项打开订单、商品、客户、库存、促销、价格表及 WordPress 历史订单页面，验证菜单及路径限制；分配真实账号的服务端流程使用明确标记的隔离身份完成 API 验证，随后删除测试账号和待分配身份。飞书后台登录按钮已验证可以跳转至官方登录页。完整后台只使用原生后台会话，独立 Invoice 不再自动继承后台会话；客户退出、后台退出和 Invoice 退出互不替代。

最终增量发布备份：`/var/www/d4u_medusa/shared/backups/feishu-20260924-101555`。最终线上烟测已确认完整后台 Invoice 正常、独立 Invoice 不继承后台 cookie、客户不继承员工 cookie、分配界面正常，测试身份及账号均已清理。

自动账单权限版本已部署至测试环境，备份 `/var/www/d4u_medusa/shared/backups/feishu-20260924-103109`。33 项后端测试、4 项前端认证/会话测试通过；数据库首次登录并发幂等、普通用户创建接口授权与查看账单、其他页面/额度越权拒绝及手机账单 UI 已线上验证。四个管理员 user_id 配置逐一验证匹配，显示名称同名不能提权；未使用真实人员身份做虚假登录，隔离测试账号已清理。

用户最终确认：应用 `cli_aa3ec98ab736dbef` 的 `contact:user.employee_id:readonly` 已开通并发布生效。无需再进行后台账号人工分配；真实飞书登录将按官方返回的 user_id 自动区分普通账单人员与四名管理员。

## 真实 OAuth 失败诊断（2026-09-24）

用户真实授权在 11:05 返回 HTTP 400 / Feishu 20049（PKCE 校验失败），发生在换取令牌阶段，早于 user_info、自动开户和角色判断。原先笼统的“授权过期或被拒绝”错误不足以定位原因；现在只记录 HTTP 状态及数字错误码，前端记录 state/authentication/session/permissions 阶段，不记录授权码、verifier、密钥、令牌或上游原始响应。

按[授权码入口文档](https://open.feishu.cn/document/common-capabilities/sso/api/obtain-oauth-code)的 PKCE 配套说明，当前 authen/v1/authorize 改为配合 `https://open.feishu.cn/open-apis/authen/v2/oauth/token`，请求为 JSON。保留 S256、state、签名浏览器流程 cookie、服务端 HMAC bridge、原始 verifier 和精确 redirect_uri。不会在失败后自动重试授权码，也不会降级为不带 verifier 的交换。官方 v2/v3 迁移文档与授权入口兼容说明并不完全一致；不要只凭模拟测试宣称真实登录已成功，也不要未经端到端验收再次升级接口。

新增 PKCE 错误时禁止重试/敏感响应泄漏的测试，验证前端 challenge 与回调 bridge 中 verifier 的一致性。10 项后端认证/权限测试、3 项前端 OAuth 测试与完整构建通过。此次只发布认证模块，使用 `scripts/deploy-feishu-auth-fix.py` 保存源码与编译文件备份；真实账号登录验收待用户再次发起授权。

11:10 用户真实重试确认 Feishu `/auth/user/feishu` 已返回 200，令牌交换问题解决；随后发现 `/auth/session` 虽返回 200，但内部 HTTP 请求缺少 HTTPS 代理信息，Medusa 的 secure session cookie 因而不输出。已在 BFF 会话请求中根据固定配置 STOREFRONT_URL 传入 X-Forwarded-Proto（不信任用户输入）。真实 express-session 中间件回归测试复现旧请求无 Set-Cookie，验证新请求生成 Secure/HttpOnly 的 connect.sid 并转发到浏览器。4 项前端测试通过，storefront 单独发布备份 `/var/www/d4u_medusa/shared/backups/feishu-session-20260924-111213`；认证接口修复备份 `/var/www/d4u_medusa/shared/backups/feishu-auth-20260924-110911`。浏览器最终进入后台仍待用户验收。

11:13 最终真实验收完成：用户确认“已成功进入”；服务器确认浏览器进入 `/app/staff-home` 并持续成功调用 `/admin/users/me` 与 `/admin/staff-access/me`（HTTP 200），访问 Invoice 和各管理页面均保有会话。只读核对真实飞书返回 employee user_id，当前登录身份命中配置的四人管理员白名单，自动后台账号和 super_admin 生效。此前记录的“尚未完成真实 OAuth”限制至此对本次管理员登录链路解除；普通员工权限仍依据已有自动化/API 验证，未冒充其他人员做真实 OAuth 登录。本轮仅修复测试环境，未变更生产环境。
