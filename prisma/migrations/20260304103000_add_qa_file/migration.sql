CREATE TABLE `QaFile` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` VARCHAR(120) NOT NULL,
  `fileName` VARCHAR(260) NOT NULL,
  `mimeType` VARCHAR(120) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `storagePath` VARCHAR(500) NOT NULL,
  `sheetMeta` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `QaFile_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `QaFile_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
