# MCP 模块（基于 @modelcontextprotocol/sdk）

本项目已升级至使用官方 MCP TypeScript SDK，提供更稳定、标准化的 MCP 客户端实现。

## 架构概览

```
src/lib/mcp/
├── types/           # 类型定义
├── client/          # SDK 客户端封装
│   ├── base-client.ts     # 抽象基类
│   ├── http-client.ts     # Streamable HTTP 客户端
│   ├── sse-client.ts      # SSE 客户端
│   ├── stdio-client.ts    # STDIO 客户端
│   └── factory.ts         # 客户端工厂
└── runtime/         # 运行时管理
    ├── connection-manager.ts  # 连接管理器
    └── tool-executor.ts       # 工具执行器
```

## 支持的传输协议

| 协议 | 类 | 说明 |
|------|-----|------|
| Streamable HTTP | `McpHttpClient` | 推荐的现代传输方式 |
| SSE | `McpSseClient` | Server-Sent Events |
| STDIO | `McpStdioClient` | 本地子进程通信 |

## 使用示例

### 1. 基础使用（兼容原有接口）

```typescript
import { tryAutoRunQaMcpTool } from "@/lib/qa/mcp-runtime";

const result = await tryAutoRunQaMcpTool({
  messages: [{ role: "user", content: "查询天气" }],
  mode: "web",
});

if (result.used) {
  console.log(`使用了工具: ${result.toolName}`);
  console.log(`结果: ${result.contextMessage?.content}`);
}
```

### 2. 使用连接管理器

```typescript
import { 
  getGlobalConnectionManager,
  tryAutoRunMcpTool 
} from "@/lib/mcp/runtime";
import { listEnabledQaMcpModules } from "@/lib/qa/mcp-modules";

const manager = getGlobalConnectionManager();

// 获取模块列表
const modules = await listEnabledQaMcpModules();

// 注册模块
manager.registerModules(modules);

// 连接所有模块
const { success, failed } = await manager.connectAll();
console.log(`连接成功: ${success.length}, 失败: ${failed.length}`);

// 获取连接统计
const stats = manager.getStats();
console.log(`总模块: ${stats.total}, 已连接: ${stats.connected}`);
```

### 3. 直接使用客户端

```typescript
import { McpClientFactory } from "@/lib/mcp/client";
import type { McpModule } from "@/lib/mcp/types";

const module: McpModule = {
  moduleKey: "my-server",
  label: "My MCP Server",
  transport: "streamable_http",
  endpointUrl: "https://example.com/mcp",
  headers: { "Authorization": "Bearer token" },
  // ... 其他配置
};

const client = McpClientFactory.createClient(module);

await client.connect();

// 列出工具
const { tools } = await client.listTools();
console.log("可用工具:", tools.map(t => t.name));

// 调用工具
const result = await client.callTool("get_weather", { city: "Beijing" });
console.log("结果:", result);

await client.disconnect();
```

## 新增 API 端点

### 测试 MCP 连接
```bash
POST /api/admin/qa/mcp-modules/test
Content-Type: application/json

{
  "transport": "streamable_http",
  "endpointUrl": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

### 获取连接统计
```bash
GET /api/admin/qa/mcp-modules/stats
```

响应：
```json
{
  "stats": {
    "total": 3,
    "connected": 2,
    "disconnected": 1,
    "error": 0
  },
  "modules": [
    {
      "moduleKey": "github",
      "label": "GitHub",
      "isConnected": true,
      "status": "connected"
    }
  ]
}
```

## 与原实现的对比

| 特性 | 原实现 | 新实现 (SDK) |
|------|--------|-------------|
| 协议兼容性 | 手动维护 | 自动跟随 SDK 更新 |
| 连接管理 | 单次请求 | 支持会话保持 |
| 错误处理 | 自定义 | SDK 标准化处理 |
| 类型安全 | 部分 | 完整 TypeScript 支持 |
| 代码维护 | 自研实现 | 社区维护 |

## 迁移说明

1. **API 接口保持不变** - 原有的 `tryAutoRunQaMcpTool` 等函数仍然可用
2. **数据库模型不变** - `QaMcpModule` 表结构无需修改
3. **业务逻辑保留** - LLM 路由、工具选择等逻辑完整保留
4. **底层通信替换** - 使用 SDK 替换自研的 JSON-RPC 通信层

## 未来扩展

- [ ] 连接池复用（保持长连接）
- [ ] 健康检查自动重连
- [ ] 多服务负载均衡
- [ ] MCP 服务注册中心
