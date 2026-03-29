ALTER TABLE `TwitterPost`
  ADD COLUMN `translatedText` LONGTEXT NULL,
  ADD COLUMN `translationModel` VARCHAR(160) NULL,
  ADD COLUMN `translatedAt` DATETIME(3) NULL;
