import { getChatGPTUser } from "@/app/chatgpt-auth";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type RangeKey = "24h" | "7d" | "30d" | "1y";
type Point = { time: number; value: number };
type EnergyData = { time?: string[]; produced?: string[]; consumed?: string[]; imported?: string[]; power?: Record<string, string[]> | string[]; energy?: Record<string, string[]> | string[]; today?: Record<string, string> | string };
const API_BASE = "https://api.apsystemsema.com:9282";
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const responseCache = new Map<string, { expiresAt: number; payload: unknown }>();

function brazilDate(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
function nonce() { return crypto.randomUUID().replaceAll("-", ""); }
function base64(bytes: ArrayBuffer) { let value = ""; new Uint8Array(bytes).forEach((byte) => { value += String.fromCharCode(byte); }); return btoa(value); }
async function sign(path: string, method: string, timestamp: string, requestNonce: string, appId: string, secret: string) {
  // APsystems signs only the final path segment (as specified in the OpenAPI manual),
  // not the entire URL or its query string.
  const requestPath = path.split("?")[0].split("/").filter(Boolean).at(-1) ?? "";
  const message = `${timestamp}/${requestNonce}/${appId}/${requestPath}/${method}/HmacSHA256`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function ema<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const appId = env.APSYSTEMS_APP_ID, secret = env.APSYSTEMS_APP_SECRET;
  if (!appId || !secret) throw new Error("Credenciais da APsystems não configuradas");
  const timestamp = String(Date.now()), requestNonce = nonce();
  const response = await fetch(`${API_BASE}${path}`, { method, headers: { Accept: "application/json", "Content-Type": "application/json", "X-CA-AppId": appId, "X-CA-Timestamp": timestamp, "X-CA-Nonce": requestNonce, "X-CA-Signature-Method": "HmacSHA256", "X-CA-Signature": await sign(path, method, timestamp, requestNonce, appId, secret) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("A APsystems não respondeu à consulta");
  const payload = await response.json() as { code?: number; message?: string; data?: T };
  if (payload.code !== 0 || payload.data === undefined) throw new Error(payload.message || "A APsystems recusou a consulta");
  return payload.data;
}
function powerPoints(time: string[] | undefined, values: string[] | undefined, day: string) {
  return (time ?? []).map((item, index) => ({ time: Date.parse(`${day}T${item}:00-03:00`), raw: values?.[index] }))
    .filter((point) => point.raw !== null && point.raw !== undefined)
    .map((point) => ({ time: point.time, value: Number(point.raw) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
}
function calendarPoints(time: string[] | undefined, values: string[] | undefined, yearMonth: string) {
  return (time ?? []).map((item, index) => ({ time: Date.parse(`${yearMonth}-${item.padStart(2, "0")}T00:00:00-03:00`), raw: values?.[index] }))
    .filter((point) => point.raw !== null && point.raw !== undefined)
    .map((point) => ({ time: point.time, value: Number(point.raw) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
}
function asMap(values: Record<string, string[]> | string[] | undefined): Record<string, string[]> {
  return values && !Array.isArray(values) ? values : {};
}
function ecuGenerationPoints(result: EnergyData, day: string) {
  // The ECU endpoint is the inverter-reported source of PV generation. The
  // meter also exposes a "produced" field, but it is a meter-energy total;
  // it must not be used as the generation power curve.
  const power = Array.isArray(result.power) ? result.power : asMap(result.power).produced;
  return powerPoints(result.time, power, day);
}
function responseFor(range: RangeKey, result: EnergyData, date: string) {
  const source = asMap(result.power);
  const make = (key: string): Point[] => {
    if (range === "24h") return powerPoints(result.time, source[key], date);
    const values = result[key as keyof EnergyData];
    return calendarPoints(result.time, Array.isArray(values) ? values : undefined, range === "1y" ? date.slice(0, 4) : date.slice(0, 7));
  };
  const lastWeek = (points: Point[]) => range === "7d" ? points.filter((point) => point.time >= Date.now() - 7 * 86400000) : points;
  const generation = lastWeek(make("produced"));
  const consumption = lastWeek(make("consumed"));
  const netGrid = make("imported_exported");
  // In EMA's minutely payload this is a signed net power: positive is drawn
  // from the grid and negative is injected into it. Split it into two curves
  // so neither import nor export disappears from the chart.
  const gridImport = lastWeek(make("imported").length ? make("imported") : netGrid.map((point) => ({ ...point, value: Math.max(0, point.value) })));
  const gridExport = lastWeek(make("exported").length ? make("exported") : netGrid.map((point) => ({ ...point, value: Math.max(0, -point.value) })));
  return { connected: true, updatedAt: Date.now(), metrics: { generationPower: range === "24h" ? generation.at(-1)?.value : undefined, consumptionPower: range === "24h" ? consumption.at(-1)?.value : undefined, importPower: range === "24h" ? gridImport.at(-1)?.value : undefined, generationToday: Number((typeof result.today === "object" ? result.today?.produced : undefined) ?? generation.reduce((total, point) => total + point.value, 0)) }, history: { generation: { unit: range === "24h" ? "W" : "kWh", points: generation }, consumption: { unit: range === "24h" ? "W" : "kWh", points: consumption }, gridImport: { unit: range === "24h" ? "W" : "kWh", points: gridImport }, gridExport: { unit: range === "24h" ? "W" : "kWh", points: gridExport } } };
}
async function collect(range: RangeKey) {
  const systems = await ema<{ systems?: { sid?: string }[] }>("/installer/api/v2/systems", "POST", { page: 1, size: 10 });
  const sid = systems.systems?.[0]?.sid;
  if (!sid) throw new Error("Nenhuma instalação APsystems foi encontrada");
  const meters = await ema<string[]>(`/installer/api/v2/systems/meters/${sid}`, "GET");
  if (!meters[0]) throw new Error("O medidor de consumo da instalação não foi encontrado");
  const date = brazilDate();
  const meterPath = `/installer/api/v2/systems/${sid}/devices/meter/period/${meters[0]}`;
  const ecuPath = `/installer/api/v2/systems/${sid}/devices/ecu/energy/${meters[0]}`;
  if (range === "1y") {
    const result = await ema<EnergyData>(`${meterPath}?${new URLSearchParams({ energy_level: "monthly", date_range: date.slice(0, 4) })}`, "GET");
    return responseFor(range, result, date);
  }
  // EMA returns the full five-minute telemetry of a requested day. Fetch each
  // day in the selected window so a week/month is a continuous curve, not an
  // aggregation of daily totals.
  const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  const dates = Array.from({ length: days }, (_, index) => brazilDate(new Date(Date.now() - (days - index - 1) * 86400000)));
  const samples: Array<{ date: string; meter: EnergyData; ecu: EnergyData }> = [];
  for (let start = 0; start < dates.length; start += 4) {
    const batch = await Promise.all(dates.slice(start, start + 4).map(async (day) => {
      const query = new URLSearchParams({ energy_level: "minutely", date_range: day });
      const [meter, ecu] = await Promise.all([
        ema<EnergyData>(`${meterPath}?${query}`, "GET"),
        ema<EnergyData>(`${ecuPath}?${query}`, "GET"),
      ]);
      return { date: day, meter, ecu };
    }));
    samples.push(...batch);
  }
  const series = samples.map(({ date: day, meter, ecu }) => {
    const meterSeries = responseFor("24h", meter, day);
    return { ...meterSeries, history: { ...meterSeries.history, generation: { unit: "W", points: ecuGenerationPoints(ecu, day) } } };
  });
  const join = (key: "generation" | "consumption" | "gridImport" | "gridExport") => series.flatMap((item) => item.history[key].points).sort((a, b) => a.time - b.time);
  const generation = join("generation"), consumption = join("consumption"), gridImport = join("gridImport"), gridExport = join("gridExport");
  return { connected: true, updatedAt: Date.now(), metrics: { generationPower: generation.at(-1)?.value, consumptionPower: consumption.at(-1)?.value, importPower: gridImport.at(-1)?.value }, history: { generation: { unit: "W", points: generation }, consumption: { unit: "W", points: consumption }, gridImport: { unit: "W", points: gridImport }, gridExport: { unit: "W", points: gridExport } } };
}
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Acesso restrito" }, { status: 401 });
  const requested = new URL(request.url).searchParams.get("range");
  const range: RangeKey = requested === "7d" || requested === "30d" || requested === "1y" ? requested : "24h";
  const cached = responseCache.get(range);
  if (cached && cached.expiresAt > Date.now()) return Response.json(cached.payload);
  try {
    const payload = await collect(range);
    responseCache.set(range, { expiresAt: Date.now() + CACHE_SECONDS * 1000, payload });
    return Response.json(payload, { headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` } });
  } catch (error) { return Response.json({ connected: false, message: error instanceof Error ? error.message : "Não foi possível consultar a APsystems." }, { status: 502 }); }
}
