CREATE TABLE `QaMcpModule` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `moduleKey` VARCHAR(120) NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `description` VARCHAR(400) NOT NULL,
  `transport` ENUM('STREAMABLE_HTTP') NOT NULL DEFAULT 'STREAMABLE_HTTP',
  `endpointUrl` VARCHAR(500) NOT NULL,
  `headers` JSON NULL,
  `keywordHints` JSON NULL,
  `toolAllowlist` JSON NULL,
  `modeHint` ENUM('AUTO', 'BLOG', 'WEB') NOT NULL DEFAULT 'AUTO',
  `isEnabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `QaMcpModule_moduleKey_key`(`moduleKey`),
  INDEX `QaMcpModule_isEnabled_createdAt_idx`(`isEnabled`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
