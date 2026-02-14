-- Add category, tags and source fields for article classification and provenance.
ALTER TABLE `Article`
  ADD COLUMN `category` VARCHAR(80) NOT NULL DEFAULT '未分类' AFTER `slug`,
  ADD COLUMN `tags` JSON NULL AFTER `category`,
  ADD COLUMN `sourceType` ENUM('ORIGINAL', 'CRAWLER', 'TRANSCRIPT') NOT NULL DEFAULT 'ORIGINAL' AFTER `tags`,
  ADD COLUMN `sourceDetail` VARCHAR(500) NULL AFTER `sourceType`;

CREATE INDEX `Article_category_idx` ON `Article`(`category`);
CREATE INDEX `Article_sourceType_idx` ON `Article`(`sourceType`);
