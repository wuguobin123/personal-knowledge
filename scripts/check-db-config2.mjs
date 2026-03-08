import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const prisma = new PrismaClient();

const rows = await prisma.$queryRaw`
  SELECT moduleKey, connectionConfig, keywordHints 
  FROM QaMcpModule 
  WHERE moduleKey LIKE '%excel%'
`;

console.log("数据库中的 Excel 模块配置:\n");

for (const r of rows) {
  console.log(`模块: ${r.moduleKey}`);
  console.log(`connectionConfig 类型: ${typeof r.connectionConfig}`);
  
  if (typeof r.connectionConfig === 'object') {
    console.log(`connectionConfig (对象):`);
    console.log(JSON.stringify(r.connectionConfig, null, 2));
    console.log(`\nargs 类型: ${Array.isArray(r.connectionConfig.args) ? 'array ✓' : typeof r.connectionConfig.args}`);
  } else {
    console.log(`connectionConfig (字符串): ${r.connectionConfig}`);
  }
  
  console.log("\n---\n");
}

await prisma.$disconnect();
