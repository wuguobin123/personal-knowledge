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

3. 一键部署：

```bash
./scripts/deploy.sh
```

部署完成后访问：

- `http://服务器IP`（默认 Nginx 映射 `80` 端口）

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
