# WooCommerce 前台与业务迁移复核（2026-09-29）

本次范围：修复用户列出的 8 类前台差异，并对 6 个定制插件及根目录 `custom-api.php` 建立可执行的迁移清单。发布目标仅为 `testmedusa.365d4u.com`。完整插件迁移不能用页面能打开或支付按钮存在来验收。

## 核实方法与关键发现

对照本地 WordPress 源码、线上 HTML/公开商品 API、线上只读插件配置和商品元数据。原始数据与比对截图保存在忽略目录 `.private/storefront-parity/`，不作为静态资源发布。

- 线上启用上述 6 个插件；`365d-customizations` 实际启用 `feishu-semi-materials`、`home-fresh-drops`、`ready-to-ship-badge`、`ready-to-ship-copy`、`single-option-defaults`。线上新增模块与本地目录不完全一致，已只读获取线上源码。
- 全站主体字体是 DM Sans，正文默认 500、行高 1.4、字距 −0.1px；部分页脚链接明确使用 Manrope 500。测试站 CSS 中虽已有 DM Sans 声明，浏览器的 400/500/600/700 字重加载均失败，退回 sans-serif。本次托管原站相同的 18 个 WOFF2 文件，保留原站字体分工。
- 原 Fresh Drops 仅在 `context=d365_home_fresh_drops` 时排除 Ready To Ship 根分类及后代，按商品日期降序取 12 条。旧适配器缺少这个 context，且按 ID 排序，不能复制原结果。
- 原标签卡片读取数字 `type`；导入文件只有字符串 `display_type`，导致展示分支完全未命中。
- 导入把列表 `price` 和 `regular_price` 都写成最低常规价；商品页默认选中了第一条订金规格，并遗漏查询 `title/description/handle` 等基础字段。因此 Hamsa 显示 $100 订金而不是原站初始的 From $159 / 划线 $799。
- Customer Says 首页不是最新评论列表。`custom-api.php?action=reviews` 调用 `getRandomReviewsAfter2025`：2025-01-01 以后、已批准、至少有图片或视频，随机最多 10 条。评价总列表和商品评论是另外两条数据链路。
- 测试站 PayPal、Apple Pay 均已启用，Oceanpayment 为 sandbox。原简化结账把全部支付方式隐藏到“提交地址 → 手动选运费”之后，且订单摘要缺少缩略图/规格/单价。

## 本轮改动

| 用户问题 | 实现与验收重点 |
|---|---|
| 字体、页脚差异 | 原字体文件同源加载；保留 DM Sans 与原页脚 Manrope 设置；浏览器校验真实字体加载状态 |
| 顶部购物车 | 使用原站购物车 SVG；接入 Medusa 购物袋抽屉，显示商品、规格、数量、金额和结账入口 |
| Fresh Drops | 后端过滤现货及后代后再排序、截取；首页显式传递 context |
| 原价/特价/tag | 补齐商品促销、变体原价/覆盖价、限量/截止时间及标签类型；建立原生 Medusa sale price list |
| Customer Says | 首页随机媒体评价；保留媒体优先卡片、横向浏览、图片放大、静音视频；列表仍分页，商品评论仍独立 |
| 商品详情 | 正确标题、初始 From 价格、划线价、库存进度、截止倒计时、材料/付款方式/颜色、PayPal 入口、保障图、详情页签；迁移全局政策与现货标签专用政策 |
| 黑色结账按钮无字 | 修复 `.d4u-main a` 对按钮白字的覆盖，并实测背景色与文字色 |
| 结账明细/支付方式 | 缩略图、规格、单价、数量、行小计、运费/折扣/税费/总额；提前展示支付方式及不可用原因，确认地址后自动选首个运费；Apple Pay 仍校验设备能力 |

## 价格、库存与付款边界

`catalog-pricing.ts` 对照原实现：全款参与限时特价，订金保留原订金金额；变体特价覆盖父级；活动截止时间以 Unix 时间判断；`total` 是剩余促销额度，不是总库存。展示和原生 price list 使用相同来源。常规库存继续由 Medusa inventory 管理。

付款 provider 发起会话前从数据库反查实际购物车，校验当前规格价格、付款模式和剩余额度，不接受浏览器传入的优惠金额或豁免。价格过期时要求刷新购物袋；购物袋使用 Medusa 原生 refresh workflow 重新计价。既有已发起交易的真实回执继续处理，不通过页面倒计时撤销真实收款。

独立付款订阅器仅统计启用后新建、已足额收款、带商品行的订单；以订单唯一标记及数据库事务防重，同步扣减活动余额，余额为零时停用对应 price list。历史 Woo 订单和旧账单不回填销量，不触发收款/发货/邮件。此实现延续原站“付款后扣促销额度”的模型；严格限制并发待付款订单争抢最后额度需要另加支付会话预占与超时回收，不能把它称为已经实现的库存锁。

## 6 个插件的职责与后续迁移

| 源模块 | 真实职责 | Medusa 当前对应与缺口 |
|---|---|---|
| `365d-customizations` / home-fresh-drops | 首页专用查询、分类后代排除、独立缓存身份 | 本轮迁移，普通商品列表不受首页排除影响 |
| ready-to-ship-badge / ready-to-ship-copy | 现货保障图、标签匹配的发货说明、Process/FAQs/Refund/Shipping 政策 | 本轮迁移展示；旧订单摘要/所有邮件重渲染规则仍需单独核对 |
| single-option-defaults | 只有所有属性都唯一时默认选择；不按动态缩减结果自动选择 | 单规格商品默认可选；多规格保留选择入口；应继续覆盖全部源商品类型 |
| feishu-semi-materials | 半定制飞书材料映射与同步补丁 | 商品数据已导入；飞书新增/修改/下架/价格同步任务尚需迁移，不可把静态导入当成同步 |
| `custom365d-reviews` | 店铺评价表、媒体、审核/屏蔽词、helpful、导入导出、分页、统计、转码媒体 | 已有独立 Reviews 管理、审核、提交和 COS；本轮补首页抽样。helpful 去重、全部统计/导出、压缩视频与原视频映射仍需验收 |
| `customer-collect` | 后台按客户邮箱检索收藏并分页，不是前台收藏插件 | 已有客户收藏记录和管理基础；需核对邮箱筛选、分页、商品下架处理与权限的完整等价性 |
| `home365d-config` | 首页广告/标签/品牌/轮播配置、直播/秒杀配置、额度/截止/已售、失效购物车清理 | 现有 Store settings 管内容；本轮接入实时商品促销。批量活动编辑、变体独立额度后台、缓存失效和失效商品清理仍需专项实现/验收 |
| home365d-config 飞书/优惠券 | 每日出货、优惠资格/邮箱绑定、领券次数、优惠券邮件、飞书回写 | 出货展示已有快照；同步、资格绑定、邮件与回写不能以静态内容替代，需独立服务和幂等队列 |
| `myshop` 商品 | 分类树、标签显示/排序、品牌、产品族路由、视频、规格、订金/全款、飞书同步 | 目录兼容层、商品/规格已原生化；本轮补标签/活动。High custom、personalized 的专用表单/报价规则及外部同步仍未全量迁移 |
| myshop 客户 | 登录、旧密码、收藏/分享、收藏数、互动统计、身份 hash | 已有登录、收藏、分享、历史订单；重置密码、账户地址编辑、统计与身份验证需继续对照 |
| myshop 支付/事件 | 自定义 PayPal 建单、买家更新、收款确认、购物事件/广告事件 | 新支付统一经 Medusa provider；不要同时启用旧收款代码。广告事件应单独设计去重与同意状态 |
| `woocommerce-365d4u-payment-control` | Ocean 金额限制/豁免、账单、费用建单、付款链接、Respond/CRM、SSO/角色、收款通知 | 既有 invoices/payment-policy/paid-notifications/Woo 兼容路由已实现较多；沿用独立文档中的实际验收状态 |
| 同插件摘要/邮件/管理 | 订金和全款商品摘要、结账附加说明、客户邮件/PDF、导出、博客/wpDiscuz、聊天、Pixel | 本轮只补商品展示/结账明细。`_personal_summary`、`_checkout_summary` 已保留但全类型解释器、全部旧邮件与事件仍需迁移，参见 email-parity-audit.md |

## custom-api.php 接口清单

应拆成“公开查询 → 登录客户操作 → 内部同步/回调”三类，保留必要的路径兼容层。不能照搬一个无需认证的 PHP 总入口，也不能把历史一次性修数据入口自动上线。

| Action | 迁移目标 / 状态 |
|---|---|
| `products`, `products_by_date`, `product` | 原生 Product 数据的公开兼容查询；本轮修复 Fresh Drops、价格、tag |
| `products_by_tags`, `products_by_collection`, `products_by_high_custom_name` | 兼容层已存在；属性组合、分类排序、所有分页边界需继续样本对照 |
| `category_tree`, `category_tree_all`, `all_tags` | 已有内容记录；后台修改分类后需要统一失效/重建，不能永久依赖初次快照 |
| `flash_sale_products`, `live_sale_products` | 本轮切换原生商品活动；Flash 与 Live 分开筛选，不再共用同一快照 |
| `homepage_settings`, `top_ads`, `waterfall_ads` | 已有内容接口；必须核对全部启停/排序/媒体参数 |
| `homepage_tags` | 使用标签 `_myshop_tag_show_on_homepage`；目前单独兼容 action 仍缺失 |
| `live_ad`, `can_get_price` | 旧站返回独立广告和报价开关；目前单独兼容 action 仍缺失，不应默默当空成功 |
| `related_products_by_product_id` | 原逻辑选第一个二级分类及其后代，排除当前商品，按日期取 8；仍待实现 |
| `reviews` | 本轮恢复首页抽样；评价管理/总列表用独立分页入口 |
| `review_stats` | 平均分、分布、数量需从审核后评价实时聚合；独立兼容 action 待实现 |
| `subscribe_newsletter` | 已保存订阅；确认邮件与邮件系统同步待迁移，不能假称已发信 |
| `feishu_daily_shipments` | 展示内容存在，实时同步和媒体转换待迁移 |
| `feishu_promotion_bind_check` | 涉及资格、邮箱绑定、次数与副作用；必须做认证、去重、事务、限流，待迁移 |
| `chatwoot_identifier_hash` | 应由服务端对已验证客户身份计算；不要公开静态映射或密钥，待迁移 |
| `transcoding` | COS 对象名标准化、转码状态与结果需独立媒体任务/签名回调；待迁移 |
| `create_ready_to_ship_once` | 一次性分类维护，不能作为公开 GET 入口搬迁 |

## 完整迁移顺序与验收门槛

1. 完成本轮前台比对及测试站验收；把其余商品族（全定制/个性化/纯报价/不可售/下架/无价）加入同一矩阵。
2. 将促销、政策、标签排序、报价开关等改为明确的后台字段和版本化配置，编辑后目录、详情、购物车同时生效；补最后额度并发支付预占。
3. 迁移飞书商品/价格/库存、出货、优惠券绑定等服务。每个任务记录外部 ID、游标、幂等键、重试与失败状态；先只读对账，再单向写入测试站，最后切换生产调度。
4. 补齐账号、重置密码、地址、收藏后台、评价 helpful/统计、所有邮件/PDF、聊天身份和广告事件；每项测试权限、重复请求和隐私边界。
5. 正式切换前做商品/变体/价格/库存/评价/收藏/订单映射对账、旧 URL/外部 API 契约回归、真实 Apple 设备验收、退款验收、增量同步/冻结窗口和回退演练。域名与调用方切换另行授权。

发布脚本：`scripts/deploy-storefront-parity.py`。修改前保存测试站代码和数据库备份，保持现有环境配置；导入只补商品元数据、促销 price list 和政策，不重导历史订单/评价/客户。二次执行保留已迁移后的活动销量，避免重置新订单产生的额度变化。

本轮浏览器测试不批准或扣款、不发送客户邮件。Apple Pay 按设备能力展示；真实钱包扣款仍需设备验收。额外跑到的既有 Feishu 登录测试有一条旧断言期望 `/app/staff-home`，现有登录代码返回 `/app/orders`，不属于本轮改动；本轮未修改 SSO 行为。
