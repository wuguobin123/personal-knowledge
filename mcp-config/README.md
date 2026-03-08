# 🔌 MCP Calculator Server - 客户端配置指南

本文档介绍如何在各种支持 MCP 的客户端中配置和使用 Calculator Server。

## 📋 支持的客户端

| 客户端 | 配置方式 | 状态 |
|--------|----------|------|
| [Claude Desktop](https://claude.ai/download) | JSON 配置文件 | ✅ 已测试 |
| [Cursor](https://cursor.sh/) | JSON 配置文件 | ✅ 已测试 |
| [Cline](https://cline.bot/) | VS Code 设置 | ✅ 已测试 |
| [Kimi Code](https://kimi.moonshot.cn/) | Kimi Code CLI | ✅ 已测试 |
| [Windsurf](https://codeium.com/windsurf) | 设置面板 | ✅ 已测试 |

---

## 🚀 快速配置

### 步骤 1: 获取项目绝对路径

首先获取你的项目绝对路径：

```bash
# Windows (PowerShell)
(Get-Location).Path

# macOS/Linux
pwd
```

假设你的项目路径是 `/path/to/personal-knowledge`，则服务器脚本路径为：
```
/path/to/personal-knowledge/src/mcp/calculator-server.mjs
```

---

## 🤖 Claude Desktop

### 配置文件位置

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### 配置内容

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": [
        "/path/to/personal-knowledge/src/mcp/calculator-server.mjs"
      ],
      "env": {}
    }
  }
}
```

### Windows 示例

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": [
        "D:\\one_person\\personal-knowledge\\src\\mcp\\calculator-server.mjs"
      ]
    }
  }
}
```

### 配置步骤

1. 关闭 Claude Desktop（如果正在运行）
2. 打开/创建配置文件
3. 添加上述配置
4. 保存文件
5. 重启 Claude Desktop
6. 点击输入框的 🔨 图标查看可用工具

---

## ✨ Cursor

### 配置文件位置

- **macOS**: `~/.cursor/mcp.json`
- **Windows**: `%USERPROFILE%/.cursor/mcp.json`
- **Linux**: `~/.cursor/mcp.json`

### 配置内容

```json
{
  "mcpServers": {
    "calculator": {
      "command": "node",
      "args": [
        "/path/to/personal-knowledge/src/mcp/calculator-server.mjs"
      ]
    }
  }
}
```

### 配置步骤

1. 打开 Cursor 设置 (`Cmd/Ctrl + ,`)
2. 找到 MCP 设置
3. 点击 "Add Server"
4. 选择 "Command" 类型
5. 输入命令：`node /path/to/personal-knowledge/src/mcp/calculator-server.mjs`
6. 保存并重启 Cursor

---

## 🔧 Cline (VS Code Extension)

### 配置方式

在 VS Code 设置中搜索 "Cline MCP"，或使用 Cline 侧边栏的 MCP 设置。

### 配置内容

```json
{
  "mcpServers": [
    {
      "name": "calculator",
      "transport": "stdio",
      "command": "node",
      "args": [
        "/path/to/personal-knowledge/src/mcp/calculator-server.mjs"
      ]
    }
  ]
}
```

---

## 🌙 Kimi Code

### 配置方式

在项目根目录创建 `.claude/mcp.json`（或参考 Kimi Code 文档的最新配置方式）。

### 配置内容

```json
{
  "servers": [
    {
      "name": "calculator",
      "command": "node /path/to/personal-knowledge/src/mcp/calculator-server.mjs"
    }
  ]
}
```

---

## 🌊 Windsurf

### 配置方式

Windsurf 通常自动检测项目中的 MCP 配置。确保在项目根目录有 `.windsurf/mcp.json`：

```json
{
  "servers": [
    {
      "name": "calculator",
      "command": "node",
      "args": [
        "/path/to/personal-knowledge/src/mcp/calculator-server.mjs"
      ]
    }
  ]
}
```

---

## ✅ 验证配置

配置完成后，你可以在客户端中测试以下指令：

```
请计算 123 + 456 = ?
```

```
计算 16 的平方根
```

```
5 的阶乘是多少？
```

```
2 的 10 次方是多少？
```

如果配置正确，AI 助手会调用相应的工具并给出准确结果。

---

## 🔍 故障排除

### 问题 1: "无法找到模块"

**解决方案**: 确保路径是绝对路径，并且使用正确的路径分隔符：
- Windows: 使用 `\\` 或 `/`
- macOS/Linux: 使用 `/`

### 问题 2: "命令未找到: node"

**解决方案**: 确保 Node.js 已安装并在 PATH 中：
```bash
node --version  # 应显示版本号
```

### 问题 3: 工具不显示

**解决方案**: 
1. 完全关闭并重启客户端
2. 检查配置文件 JSON 格式是否正确
3. 查看客户端日志获取详细错误信息

### 问题 4: Windows 下的路径问题

**解决方案**: 使用双反斜杠或正斜杠：
```json
"args": ["D:/one_person/personal-knowledge/src/mcp/calculator-server.mjs"]
```
或
```json
"args": ["D:\\one_person\\personal-knowledge\\src\\mcp\\calculator-server.mjs"]
```

---

## 📁 配置文件模板

本项目提供了以下模板文件：

| 文件 | 用途 |
|------|------|
| `claude-desktop.json` | Claude Desktop 配置模板 |
| `cursor.json` | Cursor 配置模板 |
| `mcp-servers.json` | 通用配置模板 |

复制相应模板，替换 `ABSOLUTE_PATH_TO_PROJECT` 为你的实际路径即可使用。
