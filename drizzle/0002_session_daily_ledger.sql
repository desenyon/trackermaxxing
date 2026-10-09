CREATE TABLE `ai_session_daily` (
	`provider` text NOT NULL,
	`session_path` text NOT NULL,
	`date` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`provider`,`session_path`) REFERENCES `ai_sessions`(`provider`,`session_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_session_daily_identity` ON `ai_session_daily` (`provider`,`session_path`,`date`);--> statement-breakpoint
CREATE INDEX `ai_session_daily_date` ON `ai_session_daily` (`date`);--> statement-breakpoint
-- Historical caches have no event timestamps. Preserve their totals until rescan.
INSERT INTO ai_session_daily (provider, session_path, date, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, estimated_cost_usd, turn_count)
SELECT provider, session_path, strftime('%Y-%m-%d', first_activity / 1000, 'unixepoch'), input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, estimated_cost_usd, turn_count FROM ai_sessions;
--> statement-breakpoint
DELETE FROM ai_daily_rollups;
--> statement-breakpoint
INSERT INTO ai_daily_rollups (date, provider, input_tokens, output_tokens, cached_tokens, session_count, turn_count, cost_usd)
SELECT date, provider, sum(input_tokens), sum(output_tokens), sum(cached_input_tokens), count(*), sum(turn_count), sum(estimated_cost_usd)
FROM ai_session_daily GROUP BY date, provider;
