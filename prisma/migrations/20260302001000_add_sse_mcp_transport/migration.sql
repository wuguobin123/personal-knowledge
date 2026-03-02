-- Add SSE transport to support legacy MCP SSE endpoints.
ALTER TABLE `QaMcpModule`
  MODIFY `transport` ENUM('STREAMABLE_HTTP', 'SSE') NOT NULL DEFAULT 'STREAMABLE_HTTP';
