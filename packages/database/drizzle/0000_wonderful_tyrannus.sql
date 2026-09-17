CREATE TABLE `workspace_revisions` (
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `revision`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
