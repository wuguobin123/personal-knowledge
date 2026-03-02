-- Add STDIO transport and connection config for command/args MCP servers.
ALTER TABLE `QaMcpModule`
  MODIFY `transport` ENUM('STREAMABLE_HTTP', 'SSE', 'STDIO') NOT NULL DEFAULT 'STREAMABLE_HTTP';

ALTER TABLE `QaMcpModule`
  ADD COLUMN `connectionConfig` JSON NULL AFTER `headers`;
