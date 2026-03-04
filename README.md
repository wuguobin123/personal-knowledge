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
- 内置 AI 新闻定时抓取（每天早上 7 点，入库待审核）
- Q&A 助手支持 MCP 模块注册与自动工具调用（HTTP MCP）
- 内置种子文章数据

## 1. 本地开发（不使用 Docker）

1. 准备 MySQL 数据库（例如本地 `127.0.0.1:3306`）。
2. 复制环境变量模板并修改连接信息：

```bash
cp .env.example .env
```

如果本地开发希望直接连接远程 MySQL（不依赖本地 Docker），可在 `.env.local` 中设置：

```bash
DATABASE_URL="mysql://blog_user:blog_password@47.94.76.216:3306/blog_db"
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

## 2. 生产一键部署（可直接上线）

### 第一次部署

1. 准备环境变量：

```bash
cp .env.example .env
```

2. 修改 `.env` 的生产参数（至少要改）：

- `ADMIN_PASSWORD`
- `AUTH_SECRET`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_PASSWORD`
- `SILICONFLOW_API_KEY`（启用后台 AI 助手 / AI 新闻中文本地化时必填）

如果你的生产环境暂时只跑 HTTP（未启用 HTTPS），可设置：

- `COOKIE_SECURE=false`

网络拉取 Docker Hub 不稳定时，可额外设置：

- `NODE_IMAGE`（默认 `node:20-alpine`）
- `MYSQL_IMAGE`（默认 `mysql:8.0`）
- `NGINX_IMAGE`（默认 `nginx:1.21-alpine`）

服务器内存较小（`next build` 出现 `SIGKILL`）时，可设置：

- `NODE_MAX_OLD_SPACE_SIZE`（默认 `768`，如出现 `JavaScript heap out of memory` 再调高到 `1024` / `1536`）

阿里云加速地址 `https://him7zrbc.mirror.aliyuncs.com` 请配置为 Docker daemon mirror（不要直接写到 `NODE_IMAGE`）：

```bash
sudo mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://him7zrbc.mirror.aliyuncs.com"]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

如果不能修改 Docker daemon，再使用可直接拉取的镜像站前缀（示例）：

```bash
NODE_IMAGE=docker.1ms.run/library/node:20-alpine
MYSQL_IMAGE=docker.1ms.run/library/mysql:8.0
NGINX_IMAGE=docker.1ms.run/library/nginx:1.21-alpine
```

3. 一键部署：

```bash
./scripts/deploy.sh
```

部署完成后访问：

- `http://服务器IP`（默认 Nginx 映射 `80` 端口）

AI 新闻抓取调度器（`scheduler` 服务）会在部署后随 compose 一起启动，默认每天 `07:00`（`AI_NEWS_TIMEZONE` 时区）抓取并入库。

如果需要在首次部署时写入种子数据：

```bash
./scripts/deploy.sh --seed
```

### 日常发布（代码更新后）

```bash
./scripts/deploy.sh
```

脚本会自动执行：

1. 构建最新应用镜像
2. 启动并等待 MySQL 健康
3. 执行 `prisma migrate deploy`
4. 启动应用并做健康检查

### 常用运维命令

查看服务状态：

```bash
docker compose --env-file .env ps
```

查看日志：

```bash
docker compose --env-file .env logs -f nginx app
```

查看 AI 新闻调度日志：

```bash
docker compose --env-file .env logs -f scheduler
```

停止服务：

```bash
docker compose --env-file .env down
```

删除数据卷（危险操作）：

```bash
docker compose --env-file .env down -v
```

## 3. 数据库迁移与迁站

仅执行数据库结构迁移：

```bash
./scripts/migrate.sh
```

迁移并补一次种子数据：

```bash
./scripts/migrate.sh --seed
```

导出数据库（迁站前备份）：

```bash
./scripts/db-dump.sh
```

导入数据库（迁站后恢复）：

```bash
./scripts/db-restore.sh --input backups/mysql-YYYYmmdd-HHMMSS.sql.gz
```

## 4. 本地 Docker 开发（支持热更新）

仅在本地开发时使用 dev 覆盖文件：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

查看日志：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f app
```

停止开发环境：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## 5. 文章接口

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

## 6. 后台管理发布

1. 打开 `http://localhost:3000/admin/login`。
2. 输入 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
3. 填写标题、分类、标签、来源信息、摘要和 Markdown 正文。
4. 可直接上传图片，系统会自动插入 Markdown 图片链接。
5. 右侧实时预览无误后发布。

Q&A MCP 配置（后台 `/admin` -> Q&A Assistant -> 添加 Skill -> MCP 模块）：

1. 支持三种接入格式：
   - `Streamable HTTP`：填写 `endpointUrl`（或 `url`）和可选 `headers`
   - `SSE (Legacy)`：填写 `endpointUrl`（或 `url`）和可选 `headers`
   - `STDIO`：填写 `command`、可选 `args/env/cwd`（兼容 Cursor/Claude Desktop 常见 `command + args + env` 结构）
2. 可配置关键词提示、工具白名单和 mode 偏好（Auto/Blog/Web）。
3. 问答时系统会先自动评估是否需要调用 MCP 工具，再把结果注入回答上下文。

Q&A Excel/CSV 上传与分析（后台 `/admin` -> Q&A Assistant）：

1. 在输入框下方点击“上传 Excel/CSV”，可上传 `.xlsx/.xls/.csv`（单文件最大 20MB）。
2. 上传后文件会显示在“最近文件”，点击可附加到当前问答请求（最多 8 个）。
3. 后端会自动抽取 sheet、列名、行数和样例行，作为上下文注入问答模型。
4. 需要图形结果时，可让模型输出 `chart` 代码块（JSON），前端会自动渲染柱状图/折线图。
5. 可选：启用本地 MCP Excel Profile 服务（stdio）：

```bash
npm run mcp:excel-profile
```

在 MCP 模块中配置示例：
- `transport`: `stdio`
- `command`: `node`
- `args`: `["scripts/mcp-excel-profile-server.mjs"]`
- 建议关键词：`excel,xlsx,csv,表格,数据分析,fileId`
- 工具白名单：`excel_profile`

## 7. 图片上传配置

默认使用本地存储：

- 设置 `STORAGE_PROVIDER=local`
- 图片会存储到 `public/uploads`
- Docker 场景已挂载 `uploads_data` 数据卷持久化

使用阿里云 OSS：

- 设置 `STORAGE_PROVIDER=oss`
- 必填：`OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- 可选：`OSS_PUBLIC_URL`（建议填 CDN/自定义域名）

## 8. 阿里云上线建议

1. 安全组至少放行 `80`（启用 HTTPS 时放行 `443`）。
2. 不建议放行 `3306` 到公网；如必须开放，请限制白名单。
3. 生产必须修改 `.env` 里的默认密码与 `AUTH_SECRET`。
4. 可通过 `NGINX_PORT` 调整对外端口，默认是 `80`。

## 9. AI 新闻抓取

手动执行一次抓取：

```bash
npm run ai-news:collect
```

本地启动调度器（每天 07:00 执行）：

```bash
npm run ai-news:scheduler
```

手动触发接口（需管理员登录态）：

```bash
# 1) 登录并保存 cookie
curl -i -c /tmp/pk_admin.cookie \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"你的后台密码"}' \
  http://127.0.0.1:3000/api/auth/login

# 2) 触发抓取（默认抓今天）
curl -b /tmp/pk_admin.cookie -X POST \
  http://127.0.0.1:3000/api/admin/ai-news/collect

# 3) 指定日期/时区触发（用于回归测试）
curl -b /tmp/pk_admin.cookie -X POST \
  -H "Content-Type: application/json" \
  -d '{"targetDateKey":"2026-02-27","timeZone":"Asia/Shanghai"}' \
  http://127.0.0.1:3000/api/admin/ai-news/collect

# 4) 查看是否仍在执行
curl -b /tmp/pk_admin.cookie \
  http://127.0.0.1:3000/api/admin/ai-news/collect
```

可用环境变量（可选）：

- `AI_NEWS_TIMEZONE`：默认 `Asia/Shanghai`
- `AI_NEWS_RUN_AT`：默认 `07:00`
- `AI_NEWS_RUN_ON_START`：默认 `false`
- `AI_NEWS_MAX_NEWS_ITEMS`：默认 `25`
- `AI_NEWS_MAX_GITHUB_ITEMS`：默认 `20`
- `AI_NEWS_TRANSLATE_TIMEOUT_MS`：翻译请求超时（毫秒），默认 `45000`
- `AI_NEWS_TRANSLATE_BATCH_SIZE`：每批翻译条数，默认 `8`
- `AI_NEWS_GITHUB_HIGH_STAR_THRESHOLD`：高星 GitHub 项目阈值，默认 `200`
- `GITHUB_TOKEN`：可选，提升 GitHub API 配额

抓取流程会把新闻标题和摘要统一改写成中文；当 GitHub 项目星标高于阈值时，摘要会优先说明项目具体用途与解决问题。
新闻源会优先抓取最新 AI 热点，包含 Hacker News（最新+热榜）与 36 氪 AI 频道。
