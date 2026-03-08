-- Excel MCP 模块配置 SQL
-- 将此配置插入到远程数据库的 QaMcpModule 表中
-- 
-- 使用方法:
--   方法1: 在数据库客户端中直接执行此 SQL（连接远程数据库）
--   方法2: 运行 npm run mcp:excel:setup
--
-- 注意: 
--   - 请先确认 DATABASE_URL 指向远程数据库
--   - 确保当前主机可以访问远程数据库
--   - 确认项目路径是否正确

-- 检查当前数据库连接
SELECT DATABASE() as current_database, @@hostname as server_host;

-- 检查是否已存在 Excel 模块
SELECT id, moduleKey, label, isEnabled 
FROM QaMcpModule 
WHERE moduleKey LIKE 'mcp-excel%' OR label LIKE '%Excel%'
ORDER BY createdAt DESC;

-- 如果已存在，可以先删除旧版本（可选）
-- DELETE FROM QaMcpModule WHERE moduleKey LIKE 'mcp-excel%';

-- 插入 Excel MCP 模块配置
-- 注意: 请根据实际项目路径修改 connectionConfig 中的 args 路径
INSERT INTO QaMcpModule (
  moduleKey,
  label,
  description,
  transport,
  endpointUrl,
  headers,
  connectionConfig,
  keywordHints,
  toolAllowlist,
  modeHint,
  isEnabled,
  createdAt,
  updatedAt
) VALUES (
  'mcp-excel-analysis',
  'Excel 数据分析',
  '分析 Excel/CSV 文件结构，读取数据，执行统计分析（最大值、最小值、平均值、中位数等）',
  'STDIO',
  '',
  NULL,
  '{"command":"node","args":["scripts/mcp-excel-server.mjs"],"env":{},"cwd":"."}',
  '["excel","xlsx","xls","csv","表格","电子表格","spreadsheet","分析","统计","汇总","求和","平均","最大值","最小值","中位数","数据分布","列统计","数值分析","读取","查看","预览","浏览","打开表格","列名","表头","行数","工作表","sheet"]',
  NULL,
  'AUTO',
  1,
  NOW(3),
  NOW(3)
);

-- 验证插入结果
SELECT 
  id,
  moduleKey,
  label,
  transport,
  isEnabled,
  modeHint,
  JSON_EXTRACT(connectionConfig, '$.command') as command,
  JSON_EXTRACT(connectionConfig, '$.args') as args
FROM QaMcpModule
WHERE moduleKey = 'mcp-excel-analysis';

-- 查看所有 MCP 模块
SELECT 
  moduleKey,
  label,
  transport,
  CASE WHEN isEnabled = 1 THEN '✓ 启用' ELSE '✗ 禁用' END as status,
  modeHint
FROM QaMcpModule
ORDER BY createdAt DESC;
