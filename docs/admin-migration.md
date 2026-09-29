# 后台业务迁移进度

当前后台功能已部署测试环境，插件等价迁移仍有下文列明的待办。最后更新：2026-09-24。

## 用户确认的边界

- 全站 Reviews 与商品讨论评论是不同的数据源、管理入口、审核和展示，不能混合统计。
- 原 WooCommerce 已关闭的状态邮件必须保持关闭。内部付款成功邮件 / 队列、独立 Email 触发 Invoice 邮件沿用现有规则。Note 不再解析邮箱。
- 图片和视频只上传腾讯 COS。测试前缀与正式、旧 WordPress 分开。
- 前台付款无需登录，日志操作人是 User；后台记录已认证飞书登录名。普通飞书员工仍仅可创建和查看 Invoice。
- 多维表格同步暂不迁移；不能因目录有文件就重放旧同步或旧通知。

## 已核对的源站事实

- 正式 active_plugins 确认 home365d-config、myshop、woocommerce-365d4u-payment-control、custom365d-reviews、wpdiscuz、Email Log、PDF Invoices 等启用。
- d365_customizations_enabled：feishu-semi-materials（排除本轮同步）、home-fresh-drops、ready-to-ship-badge、ready-to-ship-copy、single-option-defaults。
- Woo 新订单、失败（管理员与客户）、取消、客户挂起、完成、退款邮件明确 enabled=no。处理邮件设置缺省，但 myshop 支付完成状态改为 paid，不应凭空当作 processing 发邮件。
- 全站 Reviews 原迁移 882 条；商品 wp_comments 只读导出 1,429 条，其中 561 条有 parent，rating 均空。须保留讨论回复而非编造星级；63 条 wpd_comment_images 元数据中的 71 个附件已迁移到商品评论。
- payment_date 源表 wp_postmeta，以 GMT 保存；送货号来自 wp_wc_order_delivery_numbers。

## 已部署测试环境

- 独立 Reviews（Store reviews）、Product comments 管理入口，审核/编辑/回收站/回复/JSON 导入导出。数据、审核设置、作者邮箱、统计、前台展示分开；带类型导出文件拒绝导入另一入口。商品 ID 统一映射，回复拒绝跨商品或循环引用。商品评论无星级。
- Store settings：支付顺序、启停、标签、Ocean 阈值，网站已有内容编辑；服务端 provider / invoice API 读取实际设置。
- 商品详情 365D4U 属性 widget；价格、库存、选项继续走原生 Medusa。
- Orders：原生和历史订单聚合（已合并原 Orders / WordPress orders 入口）、状态与日期/方式/搜索筛选、详情；原生编辑入口；PDF 单个/多订单下载接口。
- Email log 和模板编辑、预览；修改后的模板接入现有 Invoice 和 paid 通知入队；服务端拒绝开启原关闭的状态邮件。
- 53 项测试通过，后端和管理端构建通过。测试库验证独立数量/审核/同 ID 邮箱隔离/回复关系/错误导入，所有测试写入及审计行已回滚。PDF 中英文样例及真实原生+历史两订单导出（2 页）已渲染复核。

## 仍须完成

- 审查并完成三插件剩余生效逻辑（自动账单规则、Respond 接口、网站促销、商品说明/排序/显示规则等），排除 Base 同步。
- PDF 超长备注与极长商品标题的跨页边界；订单其他复杂退款组合的业务验收。
- 网站/支付设置、商品属性对完整旧站业务流程的进一步验收，不能把新增配置入口等同于所有旧插件完整迁移。
- 更新验收文档，明确实际完成与仍待业务验收内容，不称所有插件已完整迁移。

## 本轮已上线的小改动

- COS 原生上传、单对象删除、前台 PNG / MP4 上传及 Range 已验证。最终备份 cos-media-20260924-161720。
- Terms & Conditions 条款末尾加入用户指定 object；HTTP 内容与手机页面检查完成。9-bill.com/index/text 本次返回 HTTP 500，外部内容未能显示。备份 terms-20260924-162052。

## 本次数据与隔离验收

- 全站 Reviews 882 条；商品评论 1,429 条（公开 1,428，另 1 条非公开），其中 561 条回复、71 个媒体附件。没有跨商品 parent、没有孤立 parent。
- 源站 comment_moderation / comment_previously_approved 均关闭，因此两类新提交默认直接发布；分别在各自 Settings 中选择是否要求审核。全站原屏蔽词规则独立保留，不施加到商品评论。
- 2,311 条私有作者联系信息已按 reviews / product-reviews 分开存储，公开响应不返回邮箱/IP。
- 历史订单已补录 52,689 条允许字段；查询返回 52,881 笔 WordPress shop_order + 24 笔原生订单。退款归档不是独立销售订单，因此与原归档总数不同。查询约 0.1–0.4 秒；补录未发送邮件或队列消息。
- 5 个新后台路由均完成实际加载检查，无 JavaScript 异常；原关闭状态邮件 7 类仍全部关闭。
- 首次后台部署备份：admin-management-20260924-165110；评论隔离备份：review-separation-20260924-170908。均位于测试站 shared/backups。正式环境未更新。

- 商品页补齐 metadata 与 options.values 字段；公开商品评论接口同时支持 Medusa ID 和旧商品 ID。375px 手机验证 29 条评论/回复展示、回复目标、无星级、无整页横向溢出及无 JavaScript 异常。882 条全站评价、1,429 条商品评论均通过导出后再导入的数据校验。最后关联修复备份：product-comment-link-20260924-171549。
- 手机评论表单输入框已修正为整行布局，附件继续上传 COS。最后表单样式备份：comment-form-20260924-171815。

## Orders 入口合并（2026-09-24）

- 原生 `/app/orders` 列表替换为新订单 + WooCommerce 历史订单聚合列表；只有一个 Orders 菜单。原生 `/app/orders/:id` 的编辑/收款/履约详情保留。
- 移除重复的 Order management / WordPress orders 菜单；旧页面 URL 重定向到 Orders，保留订单 ID / 来源筛选。Email log 的订单链接也改指向 Orders。
- 隐藏 Promotions、Price Lists、Your pages 侧栏项；管理员登录默认 Orders，普通飞书员工仍为 Invoice。未删除促销/价格数据或底层支付组件。
- 合并为 Orders 页面权限；普通 Invoice 员工不能访问新订单或历史订单接口，查看 Orders 的权限不增加写权限。54 项测试、构建通过。
- 实际浏览器验证侧栏只有一个 Orders、两类订单详情/PDF、原生订单详情、返回保持筛选和旧入口重定向；计数为 24 + 52,881 = 52,905。未发起付款或邮件。
- 默认按创建时间倒序，仍可切换按付款时间排序。
- 最终上线备份：`/var/www/d4u_medusa/shared/backups/unified-orders-20260924-180650`。上线后确认创建时间默认排序、最新订单排首位、侧栏仅一个 Orders。
