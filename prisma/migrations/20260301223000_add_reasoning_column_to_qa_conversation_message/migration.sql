ALTER TABLE `QaConversationMessage`
  ADD COLUMN IF NOT EXISTS `reasoning` LONGTEXT NULL AFTER `content`;
