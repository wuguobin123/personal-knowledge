SET @reasoning_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'QaConversationMessage'
    AND COLUMN_NAME = 'reasoning'
);

SET @reasoning_sql := IF(
  @reasoning_exists = 0,
  'ALTER TABLE `QaConversationMessage` ADD COLUMN `reasoning` LONGTEXT NULL AFTER `content`',
  'SELECT 1'
);

PREPARE reasoning_stmt FROM @reasoning_sql;
EXECUTE reasoning_stmt;
DEALLOCATE PREPARE reasoning_stmt;
