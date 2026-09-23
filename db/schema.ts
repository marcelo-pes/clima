import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const weatherHistory = sqliteTable("weather_history", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
