# 图片与视频存储

2026-09-24 测试站已切换为腾讯云 COS。原站桶及访问域名从 WordPress 的 `tencent-cloud-cos` 实际配置只读取得；没有修改 WordPress。

- 存储桶：`c365d4ut-1325693478`，地域：`na-siliconvalley`。
- 访问域名：`https://img.365d4u.com`。
- 测试目录：`c365/medusa/test/`，与原站已有资源隔离。
- Medusa File Module 仅配置 COS 的 S3 兼容 provider，原生后台商品媒体上传也使用此 provider。必需配置缺失会拒绝启动，不回退本地文件 provider。
- 评价图片/视频由浏览器提交到同域 `/api/review-media`，应用在内存中转发给后端 `/store/review-media`，由 File Module 上传 COS；应用不写本地媒体文件。COS 不可用返回失败，不产生本地备用地址。
- 评价仍支持 JPG、PNG、WebP、GIF、MP4，保持原有每文件 10 MB 限制。服务端检查文件头和大小；评价保存仅接受当前环境 COS 目录下的上传地址，拒绝外部域名、其他环境目录和类型不符的资源。
- COS SecretId/SecretKey 仅在后端私有环境配置中。前端仅获得媒体 URL，未提供长期密钥。现有桶及 CDN 权限保持原配置。

配置项：后端 `COS_SECRET_ID`、`COS_SECRET_KEY`、`COS_BUCKET`、`COS_REGION`、`COS_PUBLIC_URL`（HTTPS 根域名）、`COS_PREFIX`（以 `/` 结尾的对象目录）。前端 `COS_MEDIA_BASE_URL` 为公开根域名加目录，用于旧评价图片重定向。S3 SDK 使用 virtual-hosted-style 端点，参见[腾讯云域名说明](https://cloud.tencent.com/document/product/436/102489)。

`scripts/migrate-review-media-cos.cjs` 已将测试站原有两张本地测试图片上传 COS，逐个核对 SHA-256，再更新评价引用。旧 `/review-media/<文件名>` 跳转到 COS 的 `legacy-reviews/` 对象。原本地文件保留为回滚备份，不再用于正常媒体访问；验证新上传前后，本地仍仅这两张旧文件，后台 static 无新增文件。

部署脚本：`scripts/deploy-cos-media.py`。备份：`/var/www/d4u_medusa/shared/backups/cos-media-20260924-160822`（配置、代码、旧本地图片及数据库）。本次仅部署测试站；正式站发布此代码前必须配置正式 COS 目录（建议 `c365/medusa/production/`），不能复用测试目录。

验证：46 项后端测试、完整构建通过。真实 PNG 和生成的 MP4 上传成功，公开 HTTPS 地址内容校验一致，视频 Range 请求返回 206；携带 COS 图片/视频的评价可保存，无效文件拒绝。验证文件及临时评价验证后清理，不发送客户邮件。

COS 删除兼容修复：使用单对象 DeleteObject，避免默认 S3 批量删除的 Content-MD5 兼容问题；仅允许删除当前部署前缀内对象，失败向调用方返回错误。原生 Medusa uploadFilesWorkflow 上传、公开读取及 File Module 删除后 HEAD 404 均已实测。最终备份 `cos-media-20260924-161720`。
