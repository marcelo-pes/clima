"use client";

import { useEffect, useState } from "react";
import { EcowittSeriesChart, LightningChart, GROUPS, type WeatherData } from "../weather-dashboard";
import { confereHttpError, shouldQueryConfereDatabase, weeklyWindowLabelDates } from "@/lib/confere-response";

type RangeKey = "24h" | "7d" | "30d" | "1y";
const periods: { value: RangeKey; label: string }[] = [
  { value: "24h", label: "24 horas" }, { value: "7d", label: "Semanal" },
  { value: "30d", label: "Mensal" }, { value: "1y", label: "Anual" },
];
const chartGroups = [
  { title: "Ambiente externo", lines: GROUPS.outdoor.lines.slice(0, 4) },
  { title: "VPD", lines: GROUPS.outdoor.lines.slice(4) },
  { title: "Ambiente interno", lines: GROUPS.indoor.lines },
  { title: "Solar e UV", lines: GROUPS.solar.lines },
  { title: "Ventos", lines: GROUPS.wind.lines },
  { title: "Pressão", lines: GROUPS.pressure.lines },
  { title: "Raios", lines: GROUPS.lightning.lines },
  { title: "Chuvas", lines: GROUPS.rain.lines.slice(0, 5) },
  { title: "Acumulados de chuva", lines: GROUPS.rain.lines.slice(5) },
  { title: "Bateria", lines: GROUPS.battery.lines },
];

export default function ConfereDashboard() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  const [results, setResults] = useState<{ database: WeatherData | null; api: WeatherData | null }>({ database: null, api: null });
  const [errors, setErrors] = useState<{ database?: string; api?: string }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResults({ database: null, api: null });
    setErrors({});
    const query = (source: "database" | "api") => fetch(`/api/weather?view=history&range=${range}&date=${date}&source=${source}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.ok) return await response.json() as WeatherData;
        let body: { code?: string } = {};
        try { body = await response.json() as { code?: string }; } catch { /* A resposta pode não ser JSON. */ }
        throw new Error(confereHttpError(response.status, body.code, source));
      });
    const databaseRequest = shouldQueryConfereDatabase(range) ? query("database") : Promise.resolve(null);
    void Promise.allSettled([databaseRequest, query("api")]).then(([stored, live]) => {
      if (controller.signal.aborted) return;
      setResults({ database: stored.status === "fulfilled" ? stored.value : null, api: live.status === "fulfilled" ? live.value : null });
      setErrors({ database: stored.status === "rejected" ? stored.reason.message : undefined, api: live.status === "rejected" ? live.reason.message : undefined });
      setLoading(false);
    });
    return () => controller.abort();
  }, [range, date]);

  const panel = (source: "database" | "api") => {
    const data = results[source];
    return <section className="confere-column" aria-label={source === "database" ? "Dados do SQLite" : "Dados da Ecowitt"}>
      <h2>{source === "database" ? "SQLite" : "API Ecowitt"}</h2>
      {source === "database" && range === "24h" ? <p role="status">Para 24 horas, a fonte prevista é a API Ecowitt; esse período não é consultado no SQLite.</p> : null}
      {data?.historyStoredAt && <p>Consulta: {new Date(data.historyStoredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
      {data?.historyIncomplete && <p className="confere-alert">A fonte contém apenas parte do período.</p>}
      {data && !Object.values(data.history).some((series) => series.points.length > 0) && <p role="status">Consulta concluída sem pontos para este período.</p>}
      {loading ? <p>Consultando…</p> : errors[source] ? <p className="confere-alert">{errors[source]}</p> : data ? chartGroups.map((group) => group.title === "Raios" ? <LightningChart key={group.title} history={data.history} range={range} /> : <EcowittSeriesChart key={group.title} title={group.title} history={data.history} lines={group.lines} areaKey={group.title === "Ventos" ? "windGust" : undefined} range={range} />) : null}
    </section>;
  };

  const weeklyDates = weeklyWindowLabelDates(date);
  return <main className="confere-shell"><header className="confere-header"><a href="/">← Estação Bauru Sul</a><h1>Confere</h1><p>Comparação dos mesmos sensores e do mesmo período nas duas fontes.</p><div className="confere-controls"><label>Período <select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>{range === "7d" ? "Data de referência" : "Data final"} <input type="date" value={date} max={new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })} onChange={(event) => setDate(event.target.value)} /></label>{range === "7d" && <p role="status">Janela semanal: {new Date(`${weeklyDates.startDate}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })} a {new Date(`${weeklyDates.endDate}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })} (America/Sao_Paulo)</p>}</div></header><div className="confere-grid">{panel("database")}{panel("api")}</div></main>;
}
