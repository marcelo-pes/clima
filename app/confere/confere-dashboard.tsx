"use client";

import { useEffect, useState } from "react";
import { EcowittSeriesChart, LightningChart, GROUPS, type WeatherData } from "../weather-dashboard";

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
      .then(async (response) => response.ok ? await response.json() as WeatherData : Promise.reject(new Error(source === "database" ? "Este período ainda não foi importado para o banco." : "A Ecowitt não respondeu à consulta.")));
    void Promise.allSettled([query("database"), query("api")]).then(([stored, live]) => {
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
      {data?.historyStoredAt && <p>Consulta: {new Date(data.historyStoredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
      {data?.historyIncomplete && <p className="confere-alert">A API devolveu apenas parte do período.</p>}
      {loading ? <p>Consultando…</p> : errors[source] ? <p className="confere-alert">{errors[source]}</p> : data ? chartGroups.map((group) => group.title === "Raios" ? <LightningChart key={group.title} history={data.history} range={range} /> : <EcowittSeriesChart key={group.title} title={group.title} history={data.history} lines={group.lines} areaKey={group.title === "Ventos" ? "windGust" : undefined} range={range} />) : null}
    </section>;
  };

  return <main className="confere-shell"><header className="confere-header"><a href="/">← Estação Bauru Sul</a><h1>Confere</h1><p>Comparação dos mesmos sensores e do mesmo período nas duas fontes.</p><div className="confere-controls"><label>Período <select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Data final <input type="date" value={date} max={new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })} onChange={(event) => setDate(event.target.value)} /></label></div></header><div className="confere-grid">{panel("database")}{panel("api")}</div></main>;
}
