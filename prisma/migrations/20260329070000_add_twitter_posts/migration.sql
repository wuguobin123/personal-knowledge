CREATE TABLE `TwitterWatchAccount` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `userIdStr` VARCHAR(50) NULL,
  `lastSinceId` VARCHAR(50) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `includeReplies` BOOLEAN NOT NULL DEFAULT false,
  `includeRetweets` BOOLEAN NOT NULL DEFAULT false,
  `lastSyncedAt` DATETIME(3) NULL,
  `lastProfileSyncedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `TwitterWatchAccount_username_key`(`username`),
  UNIQUE INDEX `TwitterWatchAccount_userIdStr_key`(`userIdStr`),
  INDEX `TwitterWatchAccount_enabled_username_idx`(`enabled`, `username`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TwitterPost` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `tweetIdStr` VARCHAR(50) NOT NULL,
  `watchAccountId` INTEGER NULL,
  `userIdStr` VARCHAR(50) NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `fullText` LONGTEXT NULL,
  `url` VARCHAR(500) NOT NULL,
  `lang` VARCHAR(20) NULL,
  `conversationId` VARCHAR(50) NULL,
  `tweetCreatedAt` DATETIME(3) NOT NULL,
  `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `replyCount` INTEGER NULL,
  `retweetCount` INTEGER NULL,
  `favoriteCount` INTEGER NULL,
  `quoteCount` INTEGER NULL,
  `bookmarkCount` INTEGER NULL,
  `viewsCount` INTEGER NULL,
  `raw` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `TwitterPost_tweetIdStr_key`(`tweetIdStr`),
  INDEX `TwitterPost_tweetCreatedAt_idx`(`tweetCreatedAt`),
  INDEX `TwitterPost_username_tweetCreatedAt_idx`(`username`, `tweetCreatedAt`),
  INDEX `TwitterPost_watchAccountId_tweetCreatedAt_idx`(`watchAccountId`, `tweetCreatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TwitterPost`
  ADD CONSTRAINT `TwitterPost_watchAccountId_fkey`
  FOREIGN KEY (`watchAccountId`) REFERENCES `TwitterWatchAccount`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
