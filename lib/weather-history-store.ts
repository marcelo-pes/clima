import { env } from "cloudflare:workers";

type StoredHistory = { data: Record<string, unknown>; incomplete: boolean };

export async function readWeatherHistory(key: string): Promise<StoredHistory | null> {
  try {
    const db = env.DB;
    if (!db) return null;
    const row = await db.prepare("SELECT payload FROM weather_history WHERE key = ? AND expires_at > ?")
      .bind(key, Date.now()).first<{ payload: string }>();
    if (!row) return null;
    const data = JSON.parse(row.payload) as Record<string, unknown>;
    return { data, incomplete: false };
  } catch (error) {
    console.error("Falha ao ler o histórico armazenado", error);
    return null;
  }
}

export async function saveWeatherHistory(key: string, data: Record<string, unknown>, expiresAt: number) {
  try {
    const db = env.DB;
    if (!db) return;
    await db.prepare("INSERT INTO weather_history (key, payload, updated_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, expires_at = excluded.expires_at")
      .bind(key, JSON.stringify(data), Date.now(), expiresAt).run();
  } catch (error) {
    console.error("Falha ao gravar o histórico armazenado", error);
  }
}
