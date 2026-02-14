import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const articles = [
  {
    title: "欢迎来到我的技术博客",
    slug: "welcome-to-my-blog",
    category: "项目日志",
    tags: ["Next.js", "Prisma", "MySQL"],
    sourceType: "ORIGINAL",
    sourceDetail: "作者原创内容",
    excerpt: "这是第一篇文章，用于验证 Next.js + MySQL 的博客流程是否正常。",
    content: `你好，世界。\n\n这个博客由 Next.js + Prisma + MySQL 驱动，支持 Docker 一键部署到阿里云服务器。\n\n后续我会在这里记录开发经验、部署技巧和实战踩坑。`,
    published: true,
  },
  {
    title: "阿里云 Docker 部署实践",
    slug: "aliyun-docker-deploy",
    category: "运维部署",
    tags: ["Docker", "阿里云", "部署"],
    sourceType: "TRANSCRIPT",
    sourceDetail: "由部署录屏转录后整理",
    excerpt: "记录如何通过 docker compose 快速上线一个可持续更新的博客站点。",
    content: `部署步骤建议：\n1. 安装 Docker 与 Docker Compose。\n2. 拉取代码并配置环境变量。\n3. 执行 docker compose up -d --build。\n\n之后可以通过 docker compose logs -f 查看运行状态。`,
    published: true,
  },
];

async function main() {
  for (const article of articles) {
    await prisma.article.upsert({
      where: { slug: article.slug },
      update: {
        title: article.title,
        category: article.category,
        tags: article.tags,
        sourceType: article.sourceType,
        sourceDetail: article.sourceDetail,
        excerpt: article.excerpt,
        content: article.content,
        published: article.published,
      },
      create: article,
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed completed.");
  })
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
