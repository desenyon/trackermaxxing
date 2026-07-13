CREATE TABLE `ai_daily_rollups` (
	`date` text NOT NULL,
	`provider` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_daily_rollups_date_provider_unique` ON `ai_daily_rollups` (`date`,`provider`);--> statement-breakpoint
CREATE TABLE `ai_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`session_path` text NOT NULL,
	`first_activity` integer NOT NULL,
	`last_activity` integer NOT NULL,
	`model` text,
	`cwd` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_cost_usd` real DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`source_file_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_sessions_source_hash_unique` ON `ai_sessions` (`source_file_hash`);--> statement-breakpoint
CREATE INDEX `ai_sessions_provider_index` ON `ai_sessions` (`provider`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `codex_account_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`account_id` text DEFAULT 'default' NOT NULL,
	`plan_type` text,
	`primary_used_pct` real,
	`secondary_used_pct` real,
	`primary_reset_at` integer,
	`secondary_reset_at` integer,
	`credits_balance` real,
	`lifetime_tokens` integer,
	`peak_daily_tokens` integer,
	`streak_days` integer
);
--> statement-breakpoint
CREATE INDEX `codex_snapshots_timestamp_index` ON `codex_account_snapshots` (`timestamp`);--> statement-breakpoint
CREATE TABLE `gh_activity_daily` (
	`day` text NOT NULL,
	`login` text NOT NULL,
	`commits` integer DEFAULT 0 NOT NULL,
	`prs_opened` integer DEFAULT 0 NOT NULL,
	`prs_merged` integer DEFAULT 0 NOT NULL,
	`prs_reviewed` integer DEFAULT 0 NOT NULL,
	`issues_opened` integer DEFAULT 0 NOT NULL,
	`push_events` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gh_activity_daily_unique` ON `gh_activity_daily` (`day`,`login`);--> statement-breakpoint
CREATE TABLE `gh_sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`day` text,
	`status` text NOT NULL,
	`rows_ingested` integer DEFAULT 0 NOT NULL,
	`error` text,
	`completed_at` integer NOT NULL
);
