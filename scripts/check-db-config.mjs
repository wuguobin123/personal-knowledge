import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// 加载 .env.local
const envLocalPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf8");
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

const rows = await prisma.$queryRaw`
  SELECT moduleKey, connectionConfig, keywordHints 
  FROM QaMcpModule 
  WHERE moduleKey LIKE '%excel%'
`;

console.log("数据库中的 Excel 模块配置:\n");

for (const r of rows) {
  console.log(`模块: ${r.moduleKey}`);
  console.log(`Raw connectionConfig:`);
  console.log(r.connectionConfig);
  
  console.log(`\nParsed:`);
  try {
    const parsed = JSON.parse(r.connectionConfig);
    console.log(JSON.stringify(parsed, null, 2));
    console.log(`\nargs 类型: ${Array.isArray(parsed.args) ? 'array' : typeof parsed.args}`);
  } catch (e) {
    console.log(`解析失败: ${e.message}`);
  }
  
  console.log("\n---\n");
}

await prisma.$disconnect();
