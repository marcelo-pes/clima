CREATE TABLE `weather_history` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
