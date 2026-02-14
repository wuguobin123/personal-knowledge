# Next.js Blog (MySQL + Docker)

一个可部署到阿里云服务器的博客项目模板，特点：

- Next.js 16（App Router）
- Prisma + MySQL 存储文章内容
- Docker Compose 一键部署
- 内置文章列表页、文章详情页、文章创建 API
- 内置后台管理页（`/admin`）可视化发布文章
- 文章支持分类、标签与来源信息（原创 / 爬虫采集 / 转录总结）
- 后台登录鉴权（Cookie Session）
- 支持 Markdown 渲染与代码高亮
- 支持图片上传（本地 / 阿里云 OSS）
- 内置种子文章数据

## 1. 本地开发（不使用 Docker）

1. 准备 MySQL 数据库（例如本地 `127.0.0.1:3306`）。
2. 复制环境变量模板并修改连接信息：

```bash
cp .env.example .env
```

3. 安装依赖并初始化数据库：

```bash
npm install
npm run db:push
npm run db:seed
```

4. 启动开发环境：

```bash
npm run dev
```

访问 `http://localhost:3000`。

后台地址：

- 登录页：`http://localhost:3000/admin/login`
- 管理页：`http://localhost:3000/admin`

## 2. Docker 一键部署（推荐阿里云）

在服务器项目目录执行：

```bash
docker compose up -d --build
```

启动后：

- 博客网站：`http://服务器IP:3000`
- MySQL：`服务器IP:3306`

停止服务：

```bash
docker compose down
```

如果需要删除数据库数据卷：

```bash
docker compose down -v
```

### 本地 Docker 开发（支持热更新）

生产部署不受影响。仅在本地开发时使用 dev 覆盖文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

热更新原理：

- `app` 容器运行 `npm run dev`
- 项目源码目录挂载到容器 `/app`
- `.next` 使用独立数据卷（`app_next`），避免宿主机挂载导致的缓存损坏
- `dev` 使用 `next dev --webpack`，提升容器场景稳定性
- 保存代码后，Next.js 会自动重新编译并刷新

查看日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f app
```

停止开发环境：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## 3. 文章接口

如果你是已有数据库，先执行下面任一方式升级表结构：

```bash
npm run db:push
```

或直接执行 `prisma/migrations/20260214135000_add_article_meta_fields/migration.sql`。

### 读取文章列表

```bash
curl http://localhost:3000/api/articles
```

### 新建文章

需要先登录后台拿到会话 Cookie（浏览器访问 `/admin/login` 登录即可）。

```bash
curl -X POST http://localhost:3000/api/articles \
  -H "Content-Type: application/json" \
  -d '{
    "title": "我的新文章",
    "category": "AI 工程",
    "tags": ["Next.js", "实践"],
    "sourceType": "TRANSCRIPT",
    "sourceDetail": "视频转录整理：https://example.com/video",
    "excerpt": "文章摘要",
    "content": "这是正文内容",
    "published": true
  }'
```

## 4. 后台管理发布

1. 打开 `http://localhost:3000/admin/login`。
2. 输入 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
3. 填写标题、分类、标签、来源信息、摘要和 Markdown 正文。
4. 可直接上传图片，系统会自动插入 Markdown 图片链接。
5. 右侧实时预览无误后发布。

## 5. 图片上传配置

默认使用本地存储：

- 设置 `STORAGE_PROVIDER=local`
- 图片会存储到 `public/uploads`
- Docker 场景已在 `docker-compose.yml` 中挂载 `uploads_data` 数据卷持久化

使用阿里云 OSS：

- 设置 `STORAGE_PROVIDER=oss`
- 必填：`OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- 可选：`OSS_PUBLIC_URL`（建议填 CDN/自定义域名）

## 6. 阿里云上线建议

1. 在安全组放行 `3000`（Web）和按需放行 `3306`（MySQL，建议仅内网或白名单）。
2. 修改 `docker-compose.yml` 里的默认数据库密码、后台账号密码、`AUTH_SECRET`。
3. 使用 Nginx 反向代理到 `3000` 并配置 HTTPS（可接入 Let’s Encrypt）。
