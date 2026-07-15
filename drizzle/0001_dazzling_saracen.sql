DROP INDEX IF EXISTS `ai_sessions_source_hash_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ai_sessions_provider_path_unique` ON `ai_sessions` (`provider`,`session_path`);
