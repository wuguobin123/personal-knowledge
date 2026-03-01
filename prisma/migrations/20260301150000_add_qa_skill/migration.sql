CREATE TABLE `QaSkill` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `skillKey` VARCHAR(120) NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `description` VARCHAR(400) NOT NULL,
  `instruction` LONGTEXT NOT NULL,
  `modeHint` ENUM('AUTO', 'BLOG', 'WEB') NOT NULL DEFAULT 'AUTO',
  `source` ENUM('MANUAL', 'GITHUB') NOT NULL DEFAULT 'MANUAL',
  `githubUrl` VARCHAR(500) NULL,
  `stars` INTEGER NULL,
  `isEnabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `QaSkill_skillKey_key`(`skillKey`),
  INDEX `QaSkill_isEnabled_createdAt_idx`(`isEnabled`, `createdAt`),
  INDEX `QaSkill_source_stars_idx`(`source`, `stars`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
