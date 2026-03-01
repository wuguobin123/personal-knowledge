CREATE TABLE `QaConversation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` VARCHAR(120) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `status` ENUM('ACTIVE', 'ARCHIVED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
  `mode` ENUM('AUTO', 'BLOG', 'WEB') NOT NULL DEFAULT 'AUTO',
  `skillId` VARCHAR(120) NOT NULL DEFAULT 'none',
  `meta` JSON NULL,
  `messageCount` INTEGER NOT NULL DEFAULT 0,
  `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `archivedAt` DATETIME(3) NULL,
  `deletedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `QaConversation_userId_status_lastMessageAt_idx`(`userId`, `status`, `lastMessageAt`),
  INDEX `QaConversation_status_lastMessageAt_idx`(`status`, `lastMessageAt`),
  INDEX `QaConversation_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `QaConversationMessage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `conversationId` INTEGER NOT NULL,
  `parentMessageId` INTEGER NULL,
  `userId` VARCHAR(120) NOT NULL,
  `role` ENUM('USER', 'ASSISTANT', 'SYSTEM', 'TOOL') NOT NULL,
  `status` ENUM('COMPLETED', 'ERROR') NOT NULL DEFAULT 'COMPLETED',
  `content` LONGTEXT NOT NULL,
  `mode` ENUM('AUTO', 'BLOG', 'WEB') NOT NULL DEFAULT 'AUTO',
  `skillId` VARCHAR(120) NOT NULL DEFAULT 'none',
  `provider` VARCHAR(80) NULL,
  `model` VARCHAR(160) NULL,
  `finishReason` VARCHAR(80) NULL,
  `promptTokens` INTEGER NULL,
  `completionTokens` INTEGER NULL,
  `totalTokens` INTEGER NULL,
  `latencyMs` INTEGER NULL,
  `errorMessage` VARCHAR(1000) NULL,
  `meta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `QaConversationMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
  INDEX `QaConversationMessage_conversationId_role_createdAt_idx`(`conversationId`, `role`, `createdAt`),
  INDEX `QaConversationMessage_conversationId_status_createdAt_idx`(`conversationId`, `status`, `createdAt`),
  INDEX `QaConversationMessage_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `QaConversationMessage_parentMessageId_idx`(`parentMessageId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QaConversationMessage`
  ADD CONSTRAINT `QaConversationMessage_conversationId_fkey`
  FOREIGN KEY (`conversationId`) REFERENCES `QaConversation`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `QaConversationMessage`
  ADD CONSTRAINT `QaConversationMessage_parentMessageId_fkey`
  FOREIGN KEY (`parentMessageId`) REFERENCES `QaConversationMessage`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
