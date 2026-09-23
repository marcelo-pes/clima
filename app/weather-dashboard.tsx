"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Battery,
  Cloud,
  CloudRain,
  Compass,
  Database,
  Download,
  Droplets,
  Gauge,
  History,
  Home,
  Info,
  List,
  MapPinned,
  Radio,
  RefreshCw,
  Satellite,
  Sun,
  Thermometer,
  Wind,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Reading = { value: number | string; unit: string; time: number | null } | null;
type Point = { time: number; value: number };
type Series = { unit: string; points: Point[] };
type LightningTotal = { value: number | null; start: string; end: string; recordedDays: number; expectedDays: number };
type WeatherData = {
  station: { name: string; location: string; deviceId: string; gateway: string; latitude: number; longitude: number };
  forecast?: { temperature: number; apparentTemperature: number; weatherCode: number; sunrise: string; sunset: string; source?: string } | null;
  insight?: { condition: { key: string; label: string; confidence: number | null }; alert: { key: "normal" | "attention" | "alert"; label: string; confidence: number | null }; source: "Jev" | "Regras locais"; evaluatedAt: number } | null;
  lightningCounts?: { weekly: LightningTotal; monthly: LightningTotal; annual: LightningTotal };
  uvMaxima?: { daily: Point | null; monthly: Point | null; annual: Point | null };
  updatedAt: number;
  range: RangeKey;
  historyIncomplete?: boolean;
  metrics: Record<string, Reading>;
  history: Record<string, Series>;
};
type RangeKey = "24h" | "7d" | "30d" | "1y";
type EcowittPeriod = "daily" | "24h" | "meteorological" | "weekly" | "monthly" | "yearly" | "7d";
type TabKey = "current" | "evolution" | "wind" | "map" | "satellite" | "profile";
type GroupKey = "outdoor" | "indoor" | "solar" | "wind" | "pressure" | "lightning" | "rain" | "battery";

const RANGE_LABELS: Record<RangeKey, string> = { "24h": "Diário", "7d": "Semanal", "30d": "Mensal", "1y": "Anual" };
const ECOWITT_PERIODS: { value: EcowittPeriod; label: string; range: RangeKey }[] = [
  { value: "daily", label: "Diário", range: "24h" },
  { value: "24h", label: "24 horas", range: "24h" },
  { value: "meteorological", label: "Meteorológico", range: "24h" },
  { value: "weekly", label: "Semanal", range: "7d" },
  { value: "monthly", label: "Mensal", range: "30d" },
  { value: "yearly", label: "Anual", range: "1y" },
  { value: "7d", label: "7 dias", range: "7d" },
];

function WeatherStationMark() {
  return <img src="/station-logo.png" alt="" aria-hidden="true" />;
}
const CARDINAL = ["N", "NE", "L", "SE", "S", "SO", "O", "NO"];
const CARDINAL_16 = ["N", "NNE", "NE", "ENE", "L", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
const GROUPS: Record<GroupKey, { label: string; lines: { key: string; label: string; color: string; digits?: number }[] }> = {
  outdoor: { label: "Ambiente externo", lines: [{ key: "temperature", label: "Temperatura", color: "#fbbf24", digits: 1 }, { key: "feelsLike", label: "Sensação", color: "#38bdf8", digits: 1 }, { key: "dewPoint", label: "Ponto de orvalho", color: "#84cc16", digits: 1 }, { key: "humidity", label: "Umidade", color: "#c4e67a" }, { key: "vpd", label: "VPD", color: "#fb873e", digits: 3 }] },
  indoor: { label: "Ambiente interno", lines: [{ key: "indoorTemperature", label: "Temperatura", color: "#fbbf24", digits: 1 }, { key: "indoorFeelsLike", label: "Sensação", color: "#38bdf8", digits: 1 }, { key: "indoorDewPoint", label: "Ponto de orvalho", color: "#84cc16", digits: 1 }, { key: "indoorHumidity", label: "Umidade", color: "#c4e67a" }] },
  solar: { label: "Solar e UV", lines: [{ key: "solar", label: "Radiação solar", color: "#f59e0b", digits: 1 }, { key: "uv", label: "Índice UV", color: "#8ee56b" }] },
  wind: { label: "Vento", lines: [{ key: "windSpeed", label: "Velocidade", color: "#22d3ee", digits: 1 }, { key: "windGust", label: "Rajada", color: "#fbbf24", digits: 1 }, { key: "windDirection", label: "Direção", color: "#4ade80" }] },
  pressure: { label: "Pressão", lines: [{ key: "pressureRelative", label: "Relativa", color: "#a78bfa", digits: 1 }, { key: "pressureAbsolute", label: "Absoluta", color: "#22d3ee", digits: 1 }] },
  lightning: { label: "Raios", lines: [{ key: "lightning", label: "Distância", color: "#a78bfa" }, { key: "lightningCount", label: "Contagem", color: "#fbbf24" }] },
  rain: { label: "Chuvas", lines: [{ key: "rainRate", label: "Intensidade", color: "#ffd21a", digits: 1 }, { key: "rainEvent", label: "Evento", color: "#8b5cf6", digits: 1 }, { key: "rainHourly", label: "Por hora", color: "#2e9cff", digits: 1 }, { key: "rain24h", label: "24 horas", color: "#83bd16", digits: 1 }, { key: "rainDaily", label: "Diário", color: "#16d5df", digits: 1 }, { key: "rainWeekly", label: "Semanal", color: "#ffd21a", digits: 1 }, { key: "rainMonthly", label: "Mensal", color: "#2e9cff", digits: 1 }, { key: "rainYearly", label: "Anual", color: "#83bd16", digits: 1 }] },
  battery: { label: "Bateria", lines: [{ key: "hapticBattery", label: "Conjunto háptico (Bateria)", color: "#34d399", digits: 2 }, { key: "hapticCapacitor", label: "Capacitor", color: "#84cc16", digits: 2 }, { key: "lightningBattery", label: "Sensor de raios", color: "#22d3ee" }] },
};

function value(reading: Reading, digits = 0) {
  if (!reading) return "—";
  const numeric = Number(reading.value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : String(reading.value);
}
function unit(reading: Reading, fallback = "") { return reading?.unit?.replace("º", "°") || fallback; }
function cardinal(reading: Reading) {
  const degree = Number(reading?.value);
  return Number.isFinite(degree) ? CARDINAL_16[Math.round(degree / 22.5) % 16] : "—";
}
function fullCardinal(reading: Reading) {
  const degree = Number(reading?.value);
  if (!Number.isFinite(degree)) return "Sem leitura";
  return ["Norte", "Nordeste", "Leste", "Sudeste", "Sul", "Sudoeste", "Oeste", "Noroeste"][Math.round(degree / 45) % 8];
}
function TimelineTick({ x = 0, y = 0, payload, range }: { x?: number; y?: number; payload?: { value: number }; range: RangeKey }) {
  const date = new Date(Number(payload?.value));
  if (!Number.isFinite(date.getTime())) return null;
  const options = { timeZone: "America/Sao_Paulo" };
  return <text x={x} y={y} textAnchor="middle" fill="#a6a8ad" fontSize={12}>
    {range !== "24h" && <tspan x={x} dy="14">{date.toLocaleDateString("pt-BR", options)}</tspan>}
    <tspan x={x} dy={range === "24h" ? 16 : 15}>{date.toLocaleTimeString("pt-BR", { ...options, hour: "2-digit", minute: "2-digit" })}</tspan>
  </text>;
}

type ChartLine = { key: string; label: string; color: string };
function WeatherChartTooltip({ active, payload, label, lines, history }: {
  active?: boolean; payload?: readonly { payload?: Record<string, number> }[]; label?: unknown;
  lines: ChartLine[]; history: Record<string, Series>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="weather-chart-tooltip"><strong>{pointTime(Number(row.time ?? label))}</strong>
    {lines.map((line) => {
      const amount = row[line.key];
      if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
      const formatted = amount.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
      const display = line.key === "windDirection" ? `${formatted}° · ${CARDINAL_16[Math.round(((amount % 360) + 360) % 360 / 22.5) % 16]}` : `${formatted} ${history[line.key]?.unit || (line.key === "lightning" ? "km" : "")}`;
      return <div key={line.key}><i style={{ backgroundColor: line.color }} /><span>{line.label}: {display}</span></div>;
    })}
  </div>;
}

function readingTime(reading: Reading) {
  return reading?.time ? new Date(reading.time * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem registro recente";
}
function pointTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function seriesAverage(points: Point[]) {
  return points.length ? points.reduce((sum, point) => sum + point.value, 0) / points.length : null;
}

function forecastLabel(code: number) {
  if (code === 0) return "Céu limpo";
  if (code <= 3) return code === 1 ? "Pouco nublado" : "Nublado";
  if (code <= 48) return "Neblina";
  if (code <= 67) return "Chuva";
  if (code <= 77) return "Granizo ou neve";
  if (code <= 82) return "Pancadas de chuva";
  return "Trovoadas";
}

function forecastTime(time: string) {
  return time ? new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function SectionCard({ title, icon: Icon, group, onGraph, className = "", children }: { title: React.ReactNode; icon: typeof Thermometer; group?: GroupKey; onGraph?: (group: GroupKey) => void; className?: string; children: React.ReactNode }) {
  return <article className={`sensor-card ${className}`}><header className="sensor-card-header"><div><Icon size={17} /><h2>{title}</h2></div>{group && onGraph ? <UiTooltip><TooltipTrigger asChild><button className="graph-link" onClick={() => onGraph(group)} aria-label={`Abrir histórico de ${title}`}><Activity size={18} /></button></TooltipTrigger><TooltipContent side="left">Ver histórico</TooltipContent></UiTooltip> : <Activity size={16} className="pulse-icon" />}</header>{children}</article>;
}

function BigReading({ label, reading, digits = 0, tone = "cyan" }: { label: string; reading: Reading; digits?: number; tone?: string }) {
  return <div className="big-reading"><span>{label}</span><UiTooltip><TooltipTrigger asChild><strong className={`${tone} timed-value`}>{value(reading, digits)} <small>{unit(reading)}</small></strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(reading)}</TooltipContent></UiTooltip></div>;
}

function Detail({ label, reading, digits = 0, help }: { label: string; reading: Reading; digits?: number; help?: React.ReactNode }) {
  return <div className="detail-row"><span className="detail-label">{label}{help}</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(reading, digits)} <small>{unit(reading)}</small></strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(reading)}</TooltipContent></UiTooltip></div>;
}

function InfoDialog({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return <Dialog><DialogTrigger asChild><button className="inline-info" aria-label={label}><Info size={12} /></button></DialogTrigger><DialogContent className="info-dialog"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription asChild><div>{children}</div></DialogDescription></DialogHeader></DialogContent></Dialog>;
}

function VpdHelp() {
  return <InfoDialog label="Entender o VPD" title="O que significa VPD?"><p>VPD é o déficit de pressão de vapor: indica quanto mais vapor de água o ar ainda consegue reter na temperatura atual.</p><p>Ele é importante para plantas porque influencia a transpiração. VPD alto indica ar mais seco e maior perda de água; VPD baixo indica ar mais úmido e menor transpiração.</p></InfoDialog>;
}

function BatteryHelp() {
  return <InfoDialog label="Entender o estado das baterias" title="Estado da bateria"><div className="battery-help-table"><div><b className="normal">Normal</b><span>O dispositivo atualizou seu estado nas últimas 2 horas e a bateria está dentro da faixa normal.</span></div><div><b className="low">Baixa</b><span>O dispositivo está online, mas a bateria está abaixo da faixa normal. Recomenda-se substituí-la em breve.</span></div><div><b className="offline">Offline</b><span>O dispositivo não atualiza o estado há mais de 2 horas. Verifique o sensor e sua conexão.</span></div></div><p className="battery-note">Após 7 dias sem atualização, alguns dispositivos deixam de exibir informações de bateria.</p></InfoDialog>;
}

function MetricStats({ series, digits = 1 }: { series?: Series; digits?: number }) {
  if (!series?.points.length) return <div className="metric-stats empty">Sem extremos registrados</div>;
  const points = series.points; const last = points.at(-1)!; const hourStart = points.find((point) => point.time >= last.time - 3600000) ?? points[0];
  const delta = last.value - hourStart.value; const maximum = points.reduce((best, point) => point.value > best.value ? point : best); const minimum = points.reduce((best, point) => point.value < best.value ? point : best);
  const number = (amount: number) => amount.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return <div className="metric-stats"><UiTooltip><TooltipTrigger asChild><span className={delta >= 0 ? "stat-up timed-value" : "stat-down timed-value"}>{delta >= 0 ? "↗" : "↘"} {number(Math.abs(delta))} {series.unit}/h</span></TooltipTrigger><TooltipContent>Variação entre {pointTime(hourStart.time)} e {pointTime(last.time)}</TooltipContent></UiTooltip><div><UiTooltip><TooltipTrigger asChild><span className="stat-max timed-value">↑ {number(maximum.value)} {series.unit}</span></TooltipTrigger><TooltipContent>Máxima em {pointTime(maximum.time)}</TooltipContent></UiTooltip><UiTooltip><TooltipTrigger asChild><span className="stat-min timed-value">↓ {number(minimum.value)} {series.unit}</span></TooltipTrigger><TooltipContent>Mínima em {pointTime(minimum.time)}</TooltipContent></UiTooltip></div></div>;
}

function circularAverage(points?: Point[]) {
  if (!points?.length) return null;
  const last = points.at(-1)!.time;
  const recent = points.filter((point) => point.time >= last - 10 * 60 * 1000);
  const x = recent.reduce((sum, point) => sum + Math.cos(point.value * Math.PI / 180), 0);
  const y = recent.reduce((sum, point) => sum + Math.sin(point.value * Math.PI / 180), 0);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function WindHelp() {
  return <Dialog><DialogTrigger asChild><button className="wind-info" aria-label="Entender as setas da direção do vento"><Info size={13} /></button></DialogTrigger><DialogContent className="wind-dialog"><DialogHeader><DialogTitle>Direção do vento</DialogTitle><DialogDescription>A direção em tempo real é exibida por padrão. A média considera as leituras recebidas nos últimos 10 minutos.</DialogDescription></DialogHeader><div className="wind-key"><div><span className="arrow-sample filled" /><p><strong>Seta colorida</strong><small>Direção do vento em tempo real.</small></p></div><div><span className="arrow-sample outline" /><p><strong>Seta vazia</strong><small>Direção média do vento nos últimos 10 minutos.</small></p></div></div></DialogContent></Dialog>;
}

function WindCompass({ direction, average, speed, gust, compact = false }: { direction: Reading; average: number | null; speed: Reading; gust: Reading; compact?: boolean }) {
  const degrees = Number(direction?.value) || 0;
  const averageDegrees = average ?? degrees;
  return <div className={`wind-module ${compact ? "compact" : ""}`}>
    <div className="wind-side"><span>Vento</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(speed, 1)}</strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(speed)}</TooltipContent></UiTooltip><small>{unit(speed, "km/h")}</small></div>
    <div className="compass-dial" aria-label={`Direção do vento ${value(direction)} graus, ${fullCardinal(direction)}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="88" className="compass-ring" />
        {Array.from({ length: 36 }, (_, index) => <line key={`tick-${index}`} x1="100" y1="12" x2="100" y2={index % 3 === 0 ? "20" : "17"} className={index % 3 === 0 ? "compass-tick major" : "compass-tick"} transform={`rotate(${index * 10} 100 100)`} />)}
        {Array.from({ length: 12 }, (_, index) => { const angle = index * 30; const radians = (angle - 90) * Math.PI / 180; return <text key={`degree-${angle}`} x={100 + Math.cos(radians) * 69} y={100 + Math.sin(radians) * 69} className="degree-label" textAnchor="middle" dominantBaseline="middle">{angle}</text>; })}
        <g transform={`rotate(${averageDegrees} 100 100)`} className="average-arrow"><path d="M100 2 L89 25 L100 19 L111 25 Z" /></g>
        <g transform={`rotate(${degrees} 100 100)`} className="current-arrow"><path d="M100 2 L89 25 L100 19 L111 25 Z" /></g>
      </svg>
      <div className="compass-center"><span>Tempo real</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(direction)}<sup className="wind-degree">°</sup></strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(direction)}</TooltipContent></UiTooltip><small>{cardinal(direction)}</small><WindHelp /></div>
    </div>
    <div className="wind-side"><span>Rajada</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(gust, 1)}</strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(gust)}</TooltipContent></UiTooltip><small>{unit(gust, "km/h")}</small></div>
  </div>;
}

function BatteryBar({ reading, label }: { reading: Reading; label: string }) {
  const numeric = Number(reading?.value);
  const percent = Number.isFinite(numeric) ? Math.min(100, Math.max(12, numeric <= 5 ? (numeric / 3) * 100 : numeric)) : 0;
  return <div className="battery-row"><div><span>{label}</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(reading, 2)} {unit(reading)}</strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(reading)}</TooltipContent></UiTooltip></div><div className="battery-track"><i style={{ width: `${percent}%` }} /></div></div>;
}

function LightningBattery({ reading }: { reading: Reading }) {
  const numeric = Number(reading?.value);
  const raw = String(reading?.value ?? "").toLowerCase();
  const percent = Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric <= 4 ? numeric / 4 * 100 : numeric <= 5 ? 100 : numeric)) : raw.includes("normal") ? 100 : raw.includes("low") || raw.includes("baix") ? 34 : 0;
  const activeBars = Math.max(0, Math.ceil(percent / 25));
  return <div className="lightning-battery-row"><span>Sensor de raios</span><div className="lightning-battery-value"><strong>{reading ? `${Math.round(percent)}%` : "—"}</strong><UiTooltip><TooltipTrigger asChild><div className="battery-icon timed-value" role="img" aria-label={`Bateria do sensor de raios: ${Math.round(percent)}%`}><div>{[0,1,2,3].map((bar) => <i key={bar} className={bar < activeBars ? "active" : ""} />)}</div><b /></div></TooltipTrigger><TooltipContent>{reading ? `${Math.round(percent)}% · leitura de ${readingTime(reading)}` : "Bateria ainda não localizada"}</TooltipContent></UiTooltip></div></div>;
}

function moonData(date: Date) {
  const cycle = 29.530588853; const age = ((date.getTime() / 86400000 + 2440587.5 - 2451550.1) % cycle + cycle) % cycle;
  const illumination = (1 - Math.cos(2 * Math.PI * age / cycle)) / 2 * 100;
  const phases = ["Lua nova", "Lua crescente", "Quarto crescente", "Gibosa crescente", "Lua cheia", "Gibosa minguante", "Quarto minguante", "Lua minguante"];
  return { age, illumination, name: phases[Math.round(age / cycle * 8) % 8] };
}
function MoonPhaseIcon({ age, illumination }: { age: number; illumination: number }) {
  const fraction = illumination / 100;
  const radius = Math.abs(10 * (1 - 2 * fraction));
  const phase = `M12 2 A10 10 0 0 0 12 22 A${Math.max(.01, radius)} 10 0 0 ${fraction < .5 ? 1 : 0} 12 2 Z`;
  return <svg className="moon-phase-icon" viewBox="0 0 24 24" role="img" aria-label={`Lua com ${Math.round(illumination)}% de iluminação`}><title>{Math.round(illumination)}% iluminada</title><circle cx="12" cy="12" r="10" fill="#34424b" /><path d={phase} fill="#aeb8bf" transform={age > 29.530588853 / 2 ? "translate(24 0) scale(-1 1)" : undefined} /></svg>;
}

function MoonHelp() {
  const phases = [["🌑", "Lua nova", "0%"], ["🌒", "Lua crescente", "1–49%"], ["🌓", "Quarto crescente", "50%"], ["🌔", "Gibosa crescente", "51–99%"], ["🌕", "Lua cheia", "100%"], ["🌖", "Gibosa minguante", "99–51%"], ["🌗", "Quarto minguante", "50%"], ["🌘", "Lua minguante", "49–1%"]];
  return <Dialog><DialogTrigger asChild><button className="moon-info" aria-label="Entender as fases da Lua"><Info size={13} /></button></DialogTrigger><DialogContent className="wind-dialog"><DialogHeader><DialogTitle>Fases da Lua</DialogTitle><DialogDescription>A iluminação cresce da Lua nova até a Lua cheia e diminui durante a fase minguante.</DialogDescription></DialogHeader><div className="moon-phases">{phases.map(([icon, name, percent]) => <div key={name}><span>{icon}</span><strong>{name}</strong><small>{percent} iluminada</small></div>)}</div></DialogContent></Dialog>;
}
function sunTime(date: Date, latitude: number, longitude: number, sunrise: boolean) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0); const day = Math.floor((date.getTime() - yearStart) / 86400000); const lngHour = longitude / 15;
  const t = day + ((sunrise ? 6 : 18) - lngHour) / 24; const m = .9856 * t - 3.289;
  let longitudeSun = m + 1.916 * Math.sin(m * Math.PI / 180) + .02 * Math.sin(2 * m * Math.PI / 180) + 282.634; longitudeSun = (longitudeSun + 360) % 360;
  let ascension = Math.atan(.91764 * Math.tan(longitudeSun * Math.PI / 180)) * 180 / Math.PI; ascension = (ascension + 360) % 360; ascension += Math.floor(longitudeSun / 90) * 90 - Math.floor(ascension / 90) * 90; ascension /= 15;
  const sinDeclination = .39782 * Math.sin(longitudeSun * Math.PI / 180); const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour = (Math.cos(90.833 * Math.PI / 180) - sinDeclination * Math.sin(latitude * Math.PI / 180)) / (cosDeclination * Math.cos(latitude * Math.PI / 180)); if (cosHour > 1 || cosHour < -1) return "—";
  let hour = sunrise ? 360 - Math.acos(cosHour) * 180 / Math.PI : Math.acos(cosHour) * 180 / Math.PI; hour /= 15;
  let utcHour = hour + ascension - .06571 * t - 6.622 - lngHour; utcHour = (utcHour + 24) % 24;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, Math.round(utcHour * 60))).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

function LightningTotalRow({ label, total }: { label: string; total?: LightningTotal }) {
  const formatDay = (day: string) => day.split("-").reverse().join("/");
  return <div className="detail-row"><span>{label}</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{total?.value == null ? "—" : total.value.toLocaleString("pt-BR")}</strong></TooltipTrigger><TooltipContent>{total?.value == null ? "Histórico indisponível para este período." : <>{label === "Ano" ? "Últimos 365 dias · " : ""}{formatDay(total.start)} a {formatDay(total.end)} · horário de Bauru.<br />Soma dos totais diários de raios registrados na Ecowitt.<br />Dias com registros: {total.recordedDays} de {total.expectedDays}. Lacunas no histórico podem reduzir o total.</>}</TooltipContent></UiTooltip></div>;
}

function CurrentPanel({ data, onGraph, selectedDate, onDateChange, range, onRangeChange }: { data: WeatherData; onGraph: (group: GroupKey) => void; selectedDate: string; onDateChange: (date: string) => void; range: RangeKey; onRangeChange: (range: RangeKey) => void }) {
  const m = data.metrics;
  const windAverage = circularAverage(data.history.windDirection?.points);
  const moon = moonData(new Date());
  const rainState = Number(m.rainRate?.value) > 0 ? "Chovendo agora" : "Sem chuva agora";
  const distance = Number(m.lightningDistance?.value);
  const risk = !Number.isFinite(distance) || distance > 40 ? ["Seguro", "safe"] : distance <= 10 ? ["Perigo", "danger"] : distance <= 20 ? ["Alerta", "alert"] : ["Atenção", "attention"];
  return <><div className="sensor-grid">
    <SectionCard title="Ambiente externo" icon={Thermometer} group="outdoor" onGraph={onGraph} className="outdoor-card"><div className="dual-reading"><BigReading label="Temperatura" reading={m.temperature} digits={1} tone="amber" /><BigReading label="Umidade" reading={m.humidity} tone="white" /></div><div className="metric-stats-grid"><MetricStats series={data.history.temperature} /><MetricStats series={data.history.humidity} digits={0} /></div><div className="details"><Detail label="Sensação" reading={m.feelsLike} digits={1} /><Detail label="Ponto de orvalho" reading={m.dewPoint} digits={1} /><Detail label="VPD" reading={m.vpd} digits={3} help={<VpdHelp />} /></div></SectionCard>
    <SectionCard title="Ambiente interno" icon={Home} group="indoor" onGraph={onGraph}><div className="dual-reading"><BigReading label="Temperatura" reading={m.indoorTemperature} digits={1} tone="amber" /><BigReading label="Umidade" reading={m.indoorHumidity} tone="white" /></div><div className="metric-stats-grid"><MetricStats series={data.history.indoorTemperature} /><MetricStats series={data.history.indoorHumidity} digits={0} /></div><div className="details"><Detail label="Sensação" reading={m.indoorFeelsLike} digits={1} /><Detail label="Ponto de orvalho" reading={m.indoorDewPoint} digits={1} /></div></SectionCard>
    <SectionCard title="Solar e UV" icon={Sun} group="solar" onGraph={onGraph} className="solar-card"><div className="moon-line"><MoonPhaseIcon age={moon.age} illumination={moon.illumination} /><span>{moon.name}</span><MoonHelp /></div><div className="solar-primary"><div className="solar-reading"><BigReading label="Radiação solar" reading={m.solar} digits={1} tone="amber" /></div><div className="live-uv"><span>Índice UV</span><UvDial current={m.uv} compact /></div></div><div className="metric-stats-grid solar-stats"><MetricStats series={data.history.solar} /><MetricStats series={data.history.uv} digits={0} /></div><div className="sun-times"><div><span className="sun-event-label">Nascer do sol <i className="sun-event-icon sunrise" aria-hidden="true" /></span><span>Hoje {sunTime(new Date(), data.station.latitude, data.station.longitude, true)}</span></div><div><span className="sun-event-label"><i className="sun-event-icon sunset" aria-hidden="true" /> Pôr do sol</span><span>Hoje {sunTime(new Date(), data.station.latitude, data.station.longitude, false)}</span></div></div></SectionCard>
    <SectionCard title="Vento" icon={Wind} group="wind" onGraph={onGraph} className="wind-card"><WindCompass direction={m.windDirection} average={windAverage} speed={m.windSpeed} gust={m.windGust} compact /><div className="wind-average">Média 10 min <strong>{windAverage === null ? "—" : `${Math.round(windAverage)}° · ${CARDINAL[Math.round(windAverage / 45) % 8]}`}</strong></div><div className="metric-stats-grid wind-stats"><MetricStats series={data.history.windSpeed} /><MetricStats series={data.history.windGust} /></div></SectionCard>
    <SectionCard title="Pressão" icon={Gauge} group="pressure" onGraph={onGraph}><div className="dual-reading"><BigReading label="Relativa" reading={m.pressureRelative} digits={1} tone="amber" /><BigReading label="Absoluta" reading={m.pressureAbsolute} digits={1} tone="white" /></div><div className="metric-stats-grid"><MetricStats series={data.history.pressureRelative} /><MetricStats series={data.history.pressureAbsolute} /></div></SectionCard>
    <SectionCard title="Raios · WH57" icon={Zap} group="lightning" onGraph={onGraph}><div className="lightning-top"><BigReading label="Última distância" reading={m.lightningDistance} tone="amber" /><span className={`risk-chip ${risk[1]}`}>{risk[0]}</span></div><div className="details"><Detail label="Contagem diária" reading={m.lightningCount} /><div className="detail-row"><span>Última detecção</span><strong>{readingTime(m.lightningDistance)}</strong></div><LightningTotalRow label="Semana" total={data.lightningCounts?.weekly} /><LightningTotalRow label="Último mês" total={data.lightningCounts?.monthly} /><LightningTotalRow label="Ano" total={data.lightningCounts?.annual} /></div></SectionCard>
    <SectionCard title="Chuvas" icon={CloudRain} group="rain" onGraph={onGraph} className="rain-card"><div className="rain-status"><span>{rainState}</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(m.rainRate, 1)} <small>{unit(m.rainRate)}</small></strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(m.rainRate)}</TooltipContent></UiTooltip></div><MetricStats series={data.history.rainRate} /><div className="rain-totals"><Detail label="Evento" reading={m.rainEvent} digits={1} /><Detail label="Por hora" reading={m.rainHourly} digits={1} /><Detail label="24 horas" reading={m.rain24h} digits={1} /><Detail label="Hoje" reading={m.rainDaily} digits={1} /><Detail label="Semana" reading={m.rainWeekly} digits={1} /><Detail label="Mês" reading={m.rainMonthly} digits={1} /><Detail label="Ano" reading={m.rainYearly} digits={1} /></div></SectionCard>
    <SectionCard title={<span className="title-with-info">Bateria <BatteryHelp /></span>} icon={Battery} group="battery" onGraph={onGraph} className="battery-card"><BatteryBar label="Conjunto háptico (Bateria)" reading={m.hapticBattery} /><BatteryBar label="Capacitor" reading={m.hapticCapacitor} /><LightningBattery reading={m.lightningBattery} /><div className="system-ok"><Radio size={15} /> Gateway online</div></SectionCard>
  </div><EcowittGraphSequence data={data} selectedDate={selectedDate} onDateChange={onDateChange} range={range} onRangeChange={onRangeChange} /></>;
}

function buildChartData(history: Record<string, Series>, keys: string[]) {
  const rows = new Map<number, Record<string, number>>();
  keys.forEach((key) => history[key]?.points.forEach((point) => rows.set(point.time, { ...(rows.get(point.time) ?? {}), time: point.time, [key]: point.value })));
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

function WindDirectionArrow({ cx, cy, payload, index = 0, stride = 1, active = false }: { cx?: number; cy?: number; payload?: Record<string, number>; index?: number; stride?: number; active?: boolean }) {
  if (cx === undefined || cy === undefined || !payload || (!active && index % stride !== 0)) return null;
  const degrees = Number(payload.windDirection);
  if (!Number.isFinite(degrees)) return null;
  const size = active ? 10 : 7;
  return <g transform={`translate(${cx} ${cy}) rotate(${degrees})`} className={active ? "wind-direction-arrow active" : "wind-direction-arrow"} aria-hidden="true"><path d={`M0 ${-size} L${size * .58} ${size * .25} L0 ${-size * .08} L${-size * .58} ${size * .25} Z`} /></g>;
}

function LightningMarker({ cx, cy, index = 0, stride = 1, active = false }: { cx?: number; cy?: number; index?: number; stride?: number; active?: boolean }) {
  if (cx === undefined || cy === undefined || (!active && index % stride !== 0)) return null;
  return <text x={cx} y={cy + 5} textAnchor="middle" className={active ? "lightning-marker active" : "lightning-marker"} aria-hidden="true">⚡</text>;
}

function paddedChartDomain([minimum, maximum]: readonly [number, number]): [number, number] {
  const span = Math.max(maximum - minimum, Math.abs(maximum) * 0.1, 0.1);
  return [minimum - span * 0.12, maximum + span * 0.28];
}

function HistoryChart({ title, subtitle, history, range, lines, variant = "line", stacked = false }: { title: string; subtitle: string; history: Record<string, Series>; range: RangeKey; lines: { key: string; label: string; color: string }[]; variant?: "line" | "bar" | "lightning"; stacked?: boolean }) {
  const chartData = useMemo(() => buildChartData(history, lines.map((line) => line.key)), [history, lines]);
  const extrema = lines.filter((line) => line.key !== "windDirection" && !line.key.startsWith("rain")).map((line) => { const points = history[line.key]?.points ?? []; if (!points.length) return null; const minimum = points.reduce((best, point) => point.value < best.value ? point : best); const maximum = points.reduce((best, point) => point.value > best.value ? point : best); return { ...line, minimum, maximum, average: seriesAverage(points), unit: history[line.key]?.unit || "" }; }).filter(Boolean) as { key: string; label: string; color: string; minimum: Point; maximum: Point; average: number | null; unit: string }[];
  const units = useMemo(() => [...new Set(lines.map((line) => history[line.key]?.unit || line.key))], [history, lines]);
  const arrowStride = Math.max(1, Math.ceil(chartData.length / 28));
  return <article className={`chart-card ${variant === "lightning" ? "lightning-chart" : ""}`}><div className="chart-heading"><div><span>{subtitle}</span><h3>{title}</h3></div><div className="chart-legend">{lines.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}</div></div>{extrema.length > 0 && <div className="extrema-strip">{extrema.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}: mín. <b>{item.minimum.value.toLocaleString("pt-BR")} {item.unit}</b> · média <b>{item.average?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} {item.unit}</b> · máx. <b>{item.maximum.value.toLocaleString("pt-BR")} {item.unit}</b></span>)}</div>}
    {chartData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="rgba(148,180,199,.10)" vertical={false} /><XAxis dataKey="time" tick={<TimelineTick range={range} />} height={range === "24h" ? 32 : 48} minTickGap={38} interval="preserveStartEnd" axisLine={{ stroke: "#74838d" }} tickLine={false} />{units.map((axisUnit) => <YAxis key={axisUnit} yAxisId={axisUnit} hide domain={paddedChartDomain} />)}<Tooltip content={<WeatherChartTooltip lines={lines} history={history} />} />{extrema.flatMap((item) => [<ReferenceDot key={item.key + "-history-min"} yAxisId={history[item.key]?.unit || item.key} x={item.minimum.time} y={item.minimum.value} shape={(props) => <ExtremumPin cx={Number(props.cx)} cy={Number(props.cy)} value={item.minimum.value} color="#22a9d6" />} />, <ReferenceDot key={item.key + "-history-max"} yAxisId={history[item.key]?.unit || item.key} x={item.maximum.time} y={item.maximum.value} shape={(props) => <ExtremumPin cx={Number(props.cx)} cy={Number(props.cy)} value={item.maximum.value} color="#ff6842" />} />])}{lines.map((line) => line.key === "windDirection" ? <Line key={line.key} yAxisId={history[line.key]?.unit || line.key} type="linear" dataKey={line.key} name={line.label} stroke="rgba(74,222,128,.22)" strokeWidth={1} dot={(props) => <WindDirectionArrow {...props} stride={arrowStride} />} activeDot={(props) => <WindDirectionArrow {...props} active />} connectNulls /> : variant === "lightning" && line.key === "lightning" ? <Line key={line.key} yAxisId={history[line.key]?.unit || line.key} type="linear" dataKey={line.key} name={line.label} stroke="#a855f7" strokeWidth={2} dot={(props) => <LightningMarker {...props} stride={arrowStride} />} activeDot={(props) => <LightningMarker {...props} active />} connectNulls /> : variant === "bar" || variant === "lightning" ? <Bar key={line.key} yAxisId={history[line.key]?.unit || line.key} dataKey={line.key} name={line.label} fill={variant === "lightning" ? "#fbbf24" : line.color} fillOpacity={stacked ? 1 : .92} stackId={variant === "bar" && lines.length > 1 ? `stack-${history[line.key]?.unit || line.key}` : undefined} radius={stacked ? [1,1,0,0] : [2,2,0,0]} maxBarSize={32} /> : <Line key={line.key} yAxisId={history[line.key]?.unit || line.key} type="linear" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={1.7} dot={false} connectNulls />)}</ComposedChart></ResponsiveContainer></div> : <div className="empty-chart">Histórico ainda não disponível para este período.</div>}
  </article>;
}

function LightningChart({ history, range }: { history: Record<string, Series>; range: RangeKey }) {
  const chartData = useMemo(() => {
    const rows = buildChartData(history, ["lightning", "lightningCount"]);
    let previousCount: number | null = null;
    return rows.map((row) => {
      const cumulative = typeof row.lightningCount === "number" ? row.lightningCount : null;
      const eventCount = cumulative === null || previousCount === null ? 0 : Math.max(0, cumulative - previousCount);
      if (cumulative !== null) previousCount = cumulative;
      return { ...row, eventCount };
    });
  }, [history]);
  const stride = Math.max(1, Math.ceil(chartData.length / 18));
  const distances = history.lightning?.points ?? [];
  const minimum = distances.length ? Math.min(...distances.map((point) => point.value)) : null;
  const maximum = distances.length ? Math.max(...distances.map((point) => point.value)) : null;
  return <article className="chart-card ecowitt-lightning"><div className="chart-heading"><div><span>{RANGE_LABELS[range]} · dados reais da estação</span><h3>Raios</h3></div><div className="chart-legend ecowitt-legend"><span><i className="bolt-key">⚡</i>Distância</span><span><i className="count-key" />Contagem</span></div></div><div className="extrema-strip"><span><i style={{ background:"#a72eea" }} />Distância: mín. <b>{minimum ?? "—"} km</b> · máx. <b>{maximum ?? "—"} km</b></span></div><div className="lightning-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} syncId="weather-timeline" syncMethod="value" margin={{ top: 18, right: 8, left: 8, bottom: 0 }} barCategoryGap="8%"><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="time" tick={<TimelineTick range={range} />} height={range === "24h" ? 32 : 48} minTickGap={38} interval="preserveStartEnd" axisLine={{ stroke: "#74838d" }} tickLine={false} /><YAxis yAxisId="distance" orientation="right" domain={[0, "auto"]} tick={{ fill: "#b8bac0", fontSize: 10 }} axisLine={{ stroke: "#b8bac0" }} tickLine={{ stroke: "#b8bac0" }} width={34} /><YAxis yAxisId="count" hide domain={[0, "auto"]} /><Tooltip content={<WeatherChartTooltip lines={[{ key: "lightning", label: "Distância", color: "#a72eea" }, { key: "eventCount", label: "Contagem", color: "#ffd21a" }]} history={history} />} /><Bar yAxisId="count" dataKey="eventCount" name="Contagem" fill="#ffd21a" barSize={9} minPointSize={2} /><Line yAxisId="distance" type="linear" dataKey="lightning" name="Distância" stroke="#a72eea" strokeWidth={2} dot={(props) => <LightningMarker {...props} stride={stride} />} activeDot={(props) => <LightningMarker {...props} active />} connectNulls /></ComposedChart></ResponsiveContainer></div></article>;
}

function ExtremumPin({ cx = 0, cy = 0, value, color }: { cx?: number; cy?: number; value: number; color: string }) {
  const label = value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return <g transform={`translate(${cx} ${cy})`} className="extremum-pin"><path d="M0 0 L-6 -8 C-14 -18 -8 -32 0 -32 C8 -32 14 -18 6 -8 Z" fill={color} /><text x="0" y="-17" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="9" fontWeight="700">{label}</text></g>;
}

function EcowittSeriesChart({ title, history, lines, areaKey, range }: { title: string; history: Record<string, Series>; lines: { key: string; label: string; color: string }[]; areaKey?: string; range: RangeKey }) {
  const chartData = useMemo(() => buildChartData(history, lines.map((line) => line.key)), [history, lines]);
  const extrema = lines.filter((line) => line.key !== "windDirection" && !line.key.startsWith("rain")).map((line) => { const points = history[line.key]?.points ?? []; if (!points.length) return null; const minimum = points.reduce((best, point) => point.value < best.value ? point : best); const maximum = points.reduce((best, point) => point.value > best.value ? point : best); return { ...line, minimum, maximum, average: seriesAverage(points), unit: history[line.key]?.unit || "" }; }).filter(Boolean) as { key: string; label: string; color: string; minimum: Point; maximum: Point; average: number | null; unit: string }[];
  const axisUnits = [...new Set(lines.map((line) => history[line.key]?.unit || line.key))];
  return <article className="ecowitt-series"><div className="ecowitt-series-title">{title}</div><div className="chart-legend">{lines.map((line) => <span key={line.key}><i style={{ background: line.color }} />{line.label}</span>)}</div>{extrema.length > 0 && <div className="extrema-strip">{extrema.map((item) => <span key={item.key}><i style={{ background:item.color }} />{item.label}: mín. <b>{item.minimum.value.toLocaleString("pt-BR")} {item.unit}</b> · média <b>{item.average?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} {item.unit}</b> · máx. <b>{item.maximum.value.toLocaleString("pt-BR")} {item.unit}</b></span>)}</div>}<div className="ecowitt-series-plot">{chartData.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} syncId="weather-timeline" syncMethod="value" margin={{ top: 28, right: 24, left: 0, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} /><XAxis dataKey="time" tick={<TimelineTick range={range} />} height={range === "24h" ? 32 : 48} minTickGap={38} interval="preserveStartEnd" axisLine={{ stroke: "#74838d" }} tickLine={false} />{axisUnits.map((axisUnit, index) => <YAxis key={axisUnit} yAxisId={axisUnit} hide={index > 0} tick={{ fill: "#a6a8ad", fontSize: 10 }} axisLine={{ stroke: "#a7a9ae" }} tickLine={false} width={index === 0 ? 40 : 0} domain={paddedChartDomain} />)}<Tooltip content={<WeatherChartTooltip lines={lines} history={history} />} />{lines.flatMap((line) => { const item = extrema.find((entry) => entry.key === line.key); return item ? [<ReferenceDot key={line.key + "-min"} yAxisId={history[item.key]?.unit || item.key} x={item.minimum.time} y={item.minimum.value} shape={(props) => <ExtremumPin cx={Number(props.cx)} cy={Number(props.cy)} value={item.minimum.value} color="#22a9d6" />} />, <ReferenceDot key={line.key + "-max"} yAxisId={history[item.key]?.unit || item.key} x={item.maximum.time} y={item.maximum.value} shape={(props) => <ExtremumPin cx={Number(props.cx)} cy={Number(props.cy)} value={item.maximum.value} color="#ff6842" />} />] : []; })}{lines.map((line) => line.key === "windDirection" ? <Line key={line.key} yAxisId={history[line.key]?.unit || line.key} dataKey={line.key} name={line.label} stroke="transparent" dot={(props) => <WindDirectionArrow {...props} stride={Math.max(1, Math.ceil(chartData.length / 55))} />} activeDot={(props) => <WindDirectionArrow {...props} active />} /> : areaKey === line.key ? <Area key={line.key} yAxisId={history[line.key]?.unit || line.key} type="linear" dataKey={line.key} name={line.label} stroke={line.color} fill={line.color} fillOpacity={.42} strokeWidth={1.3} connectNulls /> : <Line key={line.key} yAxisId={history[line.key]?.unit || line.key} type="linear" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={1.35} dot={false} connectNulls />)}</ComposedChart></ResponsiveContainer> : <div className="empty-chart">Sem dados no período.</div>}</div></article>;
}

function EcowittGraphSequence({ data, selectedDate, onDateChange, range, onRangeChange }: { data: WeatherData; selectedDate: string; onDateChange: (date: string) => void; range: RangeKey; onRangeChange: (range: RangeKey) => void }) {
  const h = data.history;
  const [mode, setMode] = useState<"chart" | "table">("chart");
  const [period, setPeriod] = useState<EcowittPeriod>("daily");
  const moveDay = (amount: number) => { const date = new Date(`${selectedDate}T12:00:00`); date.setDate(date.getDate() + amount); onDateChange(date.toISOString().slice(0,10)); };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const groups: GroupKey[] = ["outdoor", "indoor", "solar", "wind", "pressure", "lightning", "rain", "battery"];
  return <section className="ecowitt-sequence"><div className="ecowitt-history-menu"><div className="ecowitt-menu-title"><span>Histórico completo · {selectedDate.split("-").reverse().join("/")}</span><h2>{mode === "chart" ? "Gráficos da estação" : "Valores registrados"}</h2><small>{mode === "chart" ? "Todos os sensores" : "Dados numéricos por horário"}</small></div><div className="ecowitt-mode"><button className={mode === "chart" ? "active" : ""} onClick={() => setMode("chart")} aria-label="Visualização em gráficos"><BarChart3 size={20} /></button><button className={mode === "table" ? "active" : ""} onClick={() => setMode("table")} aria-label="Visualização em valores"><List size={20} /></button></div><Select value={period} onValueChange={(next) => { const selected = next as EcowittPeriod; setPeriod(selected); onRangeChange(ECOWITT_PERIODS.find((item) => item.value === selected)?.range ?? "24h"); }}><SelectTrigger className="ecowitt-period" aria-label="Selecionar período"><SelectValue /></SelectTrigger><SelectContent className="range-menu">{ECOWITT_PERIODS.map((item) => <SelectItem value={item.value} key={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><div className="ecowitt-calendar"><button onClick={() => moveDay(-1)} aria-label="Dia anterior">‹</button><input type="date" value={selectedDate} max={today} onChange={(event) => onDateChange(event.target.value)} /><button onClick={() => moveDay(1)} disabled={selectedDate >= today} aria-label="Próximo dia">›</button></div><button className="ecowitt-export" onClick={() => downloadCsv(data, "outdoor", range)}>Exportar</button></div>{data.historyIncomplete && <div className="error-banner" role="status">Parte do histórico não respondeu. Os gráficos mostram apenas os registros recebidos; tente atualizar novamente.</div>}{mode === "table" ? <div className="ecowitt-tables">{groups.map((group) => <section key={group}><h3>{GROUPS[group].label}</h3><HistoryTable data={data} group={group} range={range} /></section>)}</div> : <><EcowittSeriesChart range={range} title="Ambiente externo" history={h} lines={GROUPS.outdoor.lines.slice(0,4)} /><EcowittSeriesChart range={range} title="Ambiente externo · VPD" history={h} lines={[GROUPS.outdoor.lines[4]]} /><EcowittSeriesChart range={range} title="Ambiente interno" history={h} lines={GROUPS.indoor.lines.slice(0,4)} /><EcowittSeriesChart range={range} title="Solar e UVI" history={h} lines={GROUPS.solar.lines} /><EcowittSeriesChart range={range} title="Vento · velocidade, rajadas e direção" history={h} lines={GROUPS.wind.lines} areaKey="windGust" /><EcowittSeriesChart range={range} title="Pressão" history={h} lines={GROUPS.pressure.lines} /><LightningChart history={h} range={range} /><EcowittSeriesChart range={range} title="Chuvas" history={h} lines={GROUPS.rain.lines.slice(0,5)} /><EcowittSeriesChart range={range} title="Chuvas · Acumulados" history={h} lines={GROUPS.rain.lines.slice(5)} /><EcowittSeriesChart range={range} title="Bateria" history={h} lines={GROUPS.battery.lines} /></>}</section>;
}

function UvDial({ current, compact = false }: { current: Reading; compact?: boolean }) {
  const uv = current == null ? NaN : Number(current.value);
  const safeUv = Number.isFinite(uv) ? Math.max(0, Math.min(11, uv)) : 0;
  const angle = -135 + (safeUv + .5) * 22.5;
  const colors = ["#64d900", "#87e000", "#c5ef00", "#ffe237", "#ffbf17", "#ff8b0b", "#ff5a08", "#ff1717", "#df003f", "#b00079", "#9220c5", "#7429f2"];
  const point = (radius: number, degrees: number) => ({ x: 120 + Math.cos((degrees - 90) * Math.PI / 180) * radius, y: 120 + Math.sin((degrees - 90) * Math.PI / 180) * radius });
  const arc = (start: number, end: number) => { const a = point(94, start); const b = point(94, end); return `M ${a.x} ${a.y} A 94 94 0 0 1 ${b.x} ${b.y}`; };
  return <UiTooltip><TooltipTrigger asChild><div className={`uv-meter ${compact ? "compact" : ""} timed-value`} tabIndex={0}>
    <svg viewBox="0 0 240 240" role="img" aria-label={`Índice UV atual ${Number.isFinite(uv) ? uv : "indisponível"}`}>
      <circle cx="120" cy="120" r="109" className="uv-outer" />
      {colors.map((color, index) => <path key={color} d={arc(-135 + index * 22.5 + 1.2, -135 + (index + 1) * 22.5 - 1.2)} stroke={color} className="uv-segment" />)}
      {colors.map((_, index) => { const label = point(70, -135 + (index + .5) * 22.5); return <text key={index} x={label.x} y={label.y} dominantBaseline="middle" className="uv-scale-number">{index === 11 ? "11+" : index}</text>; })}
      {Number.isFinite(uv) && <g transform={`rotate(${angle} 120 120)`}><path d="M120 6 L107 46 L120 37 L133 46 Z" className="uv-pointer" /></g>}
      <text x="120" y="84" className="uv-live-label">Tempo real</text>
      <text x="120" y="126" className="uv-current">{Number.isFinite(uv) ? uv.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}</text>
      <g className="uv-current-dots" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <circle key={index} cx={96 + index * 6} cy="145" r="1.35" />)}</g>
    </svg>
  </div></TooltipTrigger><TooltipContent>Leitura de {readingTime(current)}</TooltipContent></UiTooltip>;
}

function UvGauge({ current, maxima }: { current: Reading; maxima?: WeatherData["uvMaxima"] }) {
  const format = (pointValue: Point | null | undefined) => pointValue ? pointValue.value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";
  return <article className="uv-gauge-card"><div className="chart-heading"><div><span>Medição real e máximas registradas</span><h3>Índice UV</h3></div></div><UvDial current={current} /><div className="uv-maxima"><span>⌃ Máx</span>{([['Diária', maxima?.daily], ['Mensal', maxima?.monthly], ['Anual', maxima?.annual]] as const).map(([label, maximum]) => <div key={label}><small>{label}</small><UiTooltip><TooltipTrigger asChild><b className="timed-value">{format(maximum)}</b></TooltipTrigger><TooltipContent>{maximum ? pointTime(maximum.time) : "Sem registro"}</TooltipContent></UiTooltip></div>)}</div></article>;
}

const TEMP_LINES = [{ key: "temperature", label: "Temperatura", color: "#fbbf24" }, { key: "feelsLike", label: "Sensação", color: "#38bdf8" }, { key: "dewPoint", label: "Ponto de orvalho", color: "#84cc16" }];
const PRESSURE_LINES = [{ key: "pressureRelative", label: "Relativa", color: "#a78bfa" }, { key: "pressureAbsolute", label: "Absoluta", color: "#22d3ee" }];
const RAIN_LINES = [{ key: "rainRate", label: "Intensidade", color: "#38bdf8" }, { key: "rainDaily", label: "Acumulado diário", color: "#22c55e" }];
const SOLAR_LINES = [{ key: "solar", label: "Radiação solar", color: "#f59e0b" }, { key: "uv", label: "Índice UV", color: "#f472b6" }];

function HistoryTable({ data, group, range }: { data: WeatherData; group: GroupKey; range: RangeKey }) {
  const config = GROUPS[group];
  const rows = buildChartData(data.history, config.lines.map((line) => line.key)).reverse();
  return <div className="history-table"><Table><TableHeader><TableRow><TableHead>Data e hora</TableHead>{config.lines.map((line) => <TableHead key={line.key}>{line.label}<small>{data.history[line.key]?.unit || ""}</small></TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.time}><TableCell>{new Date(row.time).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</TableCell>{config.lines.map((line) => <TableCell key={line.key}>{typeof row[line.key] === "number" ? row[line.key].toLocaleString("pt-BR", { maximumFractionDigits: line.digits ?? 0 }) : "—"}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}

function downloadCsv(data: WeatherData, group: GroupKey, range: RangeKey) {
  const config = GROUPS[group];
  const rows = buildChartData(data.history, config.lines.map((line) => line.key));
  const csv = [["Data e hora", ...config.lines.map((line) => `${line.label} (${data.history[line.key]?.unit || ""})`)], ...rows.map((row) => [new Date(row.time).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), ...config.lines.map((line) => row[line.key] ?? "")])].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ecowitt-${group}-${range}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function EvolutionPanel({ data, range, setRange, group, setGroup }: { data: WeatherData; range: RangeKey; setRange: (range: RangeKey) => void; group: GroupKey; setGroup: (group: GroupKey) => void }) {
  const [mode, setMode] = useState<"chart" | "table">("chart"); const config = GROUPS[group];
  const charts = group === "solar" ? <div className="uv-history-layout"><HistoryChart title="Radiação solar e índice UV" subtitle={RANGE_LABELS[range]} history={data.history} range={range} lines={config.lines} /><UvGauge current={data.metrics.uv} maxima={data.uvMaxima} /></div> : group === "lightning" ? <LightningChart history={data.history} range={range} /> : group === "rain" ? <><HistoryChart title="Chuva recente" subtitle={`${RANGE_LABELS[range]} · intensidade e acumulados recentes`} history={data.history} range={range} lines={config.lines.slice(0, 5)} variant="bar" /><HistoryChart title="Acumulados de chuva" subtitle={`${RANGE_LABELS[range]} · semana, mês e ano`} history={data.history} range={range} lines={config.lines.slice(5)} variant="bar" stacked /></> : <HistoryChart title={config.label} subtitle={`${RANGE_LABELS[range]} · todos os dados da categoria`} history={data.history} range={range} lines={config.lines} />;
  return <div><div className="history-toolbar"><div className="view-toggle"><button className={mode === "chart" ? "active" : ""} onClick={() => setMode("chart")} aria-label="Exibir gráfico"><BarChart3 size={18} /></button><button className={mode === "table" ? "active" : ""} onClick={() => setMode("table")} aria-label="Exibir tabela"><List size={18} /></button></div><Select value={group} onValueChange={(value) => setGroup(value as GroupKey)}><SelectTrigger className="group-select" aria-label="Selecionar grupo"><SelectValue /></SelectTrigger><SelectContent className="range-menu">{Object.entries(GROUPS).map(([key, item]) => <SelectItem value={key} key={key}>{item.label}</SelectItem>)}</SelectContent></Select><RangeSelect range={range} setRange={setRange} /><button className="export-button" onClick={() => downloadCsv(data, group, range)}><Download size={15} /> Exportar CSV</button></div><div className="history-heading"><div><span>Séries meteorológicas</span><h2>{config.label}</h2></div><strong>{RANGE_LABELS[range]}</strong></div>{mode === "chart" ? <div className="charts-grid">{charts}</div> : <HistoryTable data={data} group={group} range={range} />}</div>;
}

function RangeSelect({ range, setRange }: { range: RangeKey; setRange: (range: RangeKey) => void }) {
  return <Select value={range} onValueChange={(value) => setRange(value as RangeKey)}><SelectTrigger className="range-select" aria-label="Selecionar período"><History size={15} /><SelectValue /></SelectTrigger><SelectContent className="range-menu"><SelectItem value="24h">Diário · 24 horas</SelectItem><SelectItem value="7d">Semanal · 7 dias</SelectItem><SelectItem value="30d">Mensal · 30 dias</SelectItem><SelectItem value="1y">Anual · 1 ano</SelectItem></SelectContent></Select>;
}

function WindRose({ direction, speed }: { direction: Series; speed: Series }) {
  const bins = useMemo(() => {
    const speedByMinute = new Map(speed.points.map((point) => [Math.round(point.time / 60000), point.value]));
    const groups = Array.from({ length: 16 }, () => ({ speedTotal: 0, count: 0, speedCount: 0 }));
    direction.points.forEach((point) => {
      const index = Math.round(point.value / 22.5) % 16;
      const wind = speedByMinute.get(Math.round(point.time / 60000));
      groups[index].count += 1;
      if (wind !== undefined) { groups[index].speedTotal += speed.unit.toLowerCase().includes("m/s") ? wind : wind / 3.6; groups[index].speedCount += 1; }
    });
    const total = Math.max(direction.points.length, 1);
    return groups.map((group, index) => ({ label: CARDINAL_16[index], angle: index * 22.5, percent: group.count / total * 100, speed: group.speedCount ? group.speedTotal / group.speedCount : 0 }));
  }, [direction, speed]);
  const [hovered, setHovered] = useState<number | null>(null);
  const dominant = bins.reduce((best, bin, index) => bin.percent > bins[best].percent ? index : best, 0);
  const selected = bins[hovered ?? dominant];
  const maxPercent = Math.max(...bins.map((bin) => bin.percent), 1);
  const maxSpeed = Math.max(...bins.map((bin) => bin.speed), 1);
  const point = (radius: number, degrees: number) => ({ x: 110 + Math.cos((degrees - 90) * Math.PI / 180) * radius, y: 110 + Math.sin((degrees - 90) * Math.PI / 180) * radius });
  const sector = (inner: number, outer: number, start: number, end: number) => { const a = point(outer, start); const b = point(outer, end); const c = point(inner, end); const d = point(inner, start); return `M ${a.x} ${a.y} A ${outer} ${outer} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`; };
  return <div className="wind-rose"><svg viewBox="0 0 220 220" role="img" aria-label="Rosa dos ventos com frequência da direção e velocidade média"><circle cx="110" cy="110" r="88" /><circle cx="110" cy="110" r="68" /><circle cx="110" cy="110" r="48" />{bins.map((bin, index) => { const percentRadius = 38 + bin.percent / maxPercent * 50; const speedRadius = 38 + bin.speed / maxSpeed * 50; const labelPoint = point(101, bin.angle); return <g key={bin.label} className={hovered === index ? "rose-sector active" : "rose-sector"} tabIndex={0} role="button" aria-label={`${bin.label}: ${bin.percent.toFixed(1)}%, ${bin.speed.toFixed(1)} m/s`} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><path className="rose-frequency" d={sector(38, percentRadius, bin.angle - 9.5, bin.angle + 9.5)} /><path className="rose-speed" d={sector(38, speedRadius, bin.angle - 5.2, bin.angle + 5.2)} /><path className="rose-hit" d={sector(35, 92, bin.angle - 11.25, bin.angle + 11.25)} />{index % 2 === 0 && <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle">{bin.label}</text>}</g>; })}<circle cx="110" cy="110" r="34" className="rose-center-disc" /><text x="110" y="96" className="rose-center-direction" textAnchor="middle">{selected.label}</text><text x="110" y="109" className="rose-center-percent" textAnchor="middle">{selected.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</text><text x="110" y="122" className="rose-center-speed" textAnchor="middle">{selected.speed.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m/s</text></svg><div className="rose-legend"><span><i className="frequency" />Frequência da direção (%)</span><span><i className="speed" />Velocidade média (m/s)</span></div></div>;
}

function WindPanel({ data, range, setRange }: { data: WeatherData; range: RangeKey; setRange: (range: RangeKey) => void }) {
  const m = data.metrics;
  const windAverage = circularAverage(data.history.windDirection?.points);
  const windLines = [{ key: "windSpeed", label: "Vento", color: "#22d3ee" }, { key: "windGust", label: "Rajada", color: "#fbbf24" }, { key: "windDirection", label: "Direção", color: "#4ade80" }];
  return <div><div className="section-toolbar"><div><span className="section-eyebrow">Anemometria</span><h2>Ventos em Bauru</h2></div><RangeSelect range={range} setRange={setRange} /></div><div className="wind-analysis"><article className="wind-focus-card"><WindCompass direction={m.windDirection} average={windAverage} speed={m.windSpeed} gust={m.windGust} /><div className="wind-facts"><div><span>Direção em tempo real</span><strong>{fullCardinal(m.windDirection)} · {value(m.windDirection)}°</strong></div><div><span>Média de 10 minutos</span><strong>{windAverage === null ? "—" : `${CARDINAL[Math.round(windAverage / 45) % 8]} · ${Math.round(windAverage)}°`}</strong></div></div></article><article className="rose-card"><div className="chart-heading"><div><span>Distribuição direcional</span><h3>Rosa dos ventos</h3></div></div><WindRose direction={data.history.windDirection} speed={data.history.windSpeed} /></article></div><div className="wind-chart-full"><HistoryChart title="Velocidade, rajadas e direção" subtitle={RANGE_LABELS[range]} history={data.history} range={range} lines={windLines} /></div></div>;
}

function ForecastGlyph({ code }: { code: number }) {
  if (code === 0) return <Sun size={62} />;
  if (code >= 51 && code <= 82) return <CloudRain size={62} />;
  return <Cloud size={62} />;
}

function MapReading({ icon: Icon, label, reading, digits = 0, suffix }: { icon: typeof Wind; label: string; reading: Reading; digits?: number; suffix?: string }) {
  return <div className="map-reading-row"><Icon size={16} /><span>{label}</span><UiTooltip><TooltipTrigger asChild><strong className="timed-value">{value(reading, digits)} {unit(reading)}{suffix}</strong></TooltipTrigger><TooltipContent>Leitura de {readingTime(reading)}</TooltipContent></UiTooltip></div>;
}

function MapPanel({ data, forecastPending }: { data: WeatherData; forecastPending: boolean }) {
  const m = data.metrics;
  const lat = data.station.latitude; const lon = data.station.longitude;
  const map = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(`${lon - .08},${lat - .06},${lon + .08},${lat + .06}`)}&layer=mapnik&marker=${lat}%2C${lon}`;
  const forecast = data.forecast;
  const moon = moonData(new Date());
  const bauruHour = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date()));
  const isNight = bauruHour >= 18 || bauruHour < 6;
  const isRainy = Boolean(forecast && forecast.weatherCode >= 51);
  const isCloudy = Boolean(forecast && forecast.weatherCode > 0);
  const forecastTheme = isNight ? isRainy ? "night-rainy" : isCloudy ? "night-cloudy" : "night" : isRainy ? "rainy" : isCloudy ? "cloudy" : "sunny";
  return <div><div className="section-toolbar"><div><span className="section-eyebrow">Previsão e condições locais</span><h2>Estação Bauru Sul</h2></div></div><div className="map-layout"><aside className="map-summary"><div className={`map-forecast weather-${forecastTheme}`}><div className="forecast-main"><div className="forecast-condition">{forecast ? <><ForecastGlyph code={forecast.weatherCode} /><small>{forecastLabel(forecast.weatherCode)}</small></> : <small>{forecastPending ? "Carregando previsão…" : "Condição indisponível"}</small>}</div><div className="forecast-temperature"><strong>{value(m.temperature)}<sup>°C</sup></strong><small>Sensação {value(m.feelsLike)}°</small></div></div>{forecast && <div className="forecast-astro"><span>☼ {forecastTime(forecast.sunrise)}</span><span>☀ {forecastTime(forecast.sunset)}</span><span>◐ {moon.name}</span></div>}</div><div className="map-readings"><MapReading icon={Wind} label="Vento" reading={m.windSpeed} digits={1} suffix={` / ${cardinal(m.windDirection)}`} /><MapReading icon={Thermometer} label="Temperatura" reading={m.temperature} digits={1} /><MapReading icon={Droplets} label="Umidade" reading={m.humidity} /><MapReading icon={Gauge} label="Pressão atmosférica" reading={m.pressureRelative} digits={1} /><MapReading icon={CloudRain} label="Chuva" reading={m.rainDaily} digits={1} /><MapReading icon={Droplets} label="Intensidade de chuva" reading={m.rainRate} digits={1} /><MapReading icon={Sun} label="Radiação solar" reading={m.solar} digits={1} /><MapReading icon={Sun} label="Índice UV" reading={m.uv} digits={1} /></div></aside><article className="map-card"><iframe title="Mapa da estação em Bauru" src={map} loading="lazy" /><div className="map-badge"><span><i /> Estação online</span><strong>{lat.toFixed(5)}, {lon.toFixed(5)}</strong><small>Localização informada pela estação Ecowitt</small></div></article></div></div>;
}

function ProfilePanel({ data }: { data: WeatherData }) {
  const m = data.metrics;
  return <div><div className="section-toolbar"><div><span className="section-eyebrow">Perfil técnico</span><h2>Sobre a estação</h2></div></div><div className="profile-layout"><article className="profile-hero"><div className="station-emblem"><Radio size={34} /></div><h2>Bauru Sul</h2><h3>Monitoramento independente das condições meteorológicas em Bauru–SP</h3><p>Estação mantida por um entusiasta de meteorologia, com dados disponibilizados ao público para acompanhar o clima local e contribuir com estudos e análises meteorológicas.</p><div className="profile-live"><i /> Transmissão ativa</div></article><div className="profile-details"><article><Database size={20} /><div><span>Gateway</span><strong>{data.station.gateway}</strong><small>Estação Ecowitt GW3000</small></div></article><article><Activity size={20} /><div><span>Atualização</span><strong>Aproximadamente 1 minuto</strong><small>Dados provenientes da Ecowitt Cloud</small></div></article><article><Wind size={20} /><div><span>Medições</span><strong>Atmosfera, vento e chuva</strong><small>Inclui temperatura, umidade, pressão, radiação solar e UV</small></div></article><article><MapPinned size={20} /><div><span>Localização</span><strong>{data.station.latitude.toFixed(5)}, {data.station.longitude.toFixed(5)}</strong><small>Coordenadas informadas pela estação</small></div></article><article className="network-card"><Radio size={20} /><div><span>Redes meteorológicas</span><strong className="network-links"><a href="https://www.ecowitt.net/" target="_blank" rel="noreferrer">Ecowitt</a><a href="https://www.windy.com/" target="_blank" rel="noreferrer">Windy</a><a href="https://www.wunderground.com/" target="_blank" rel="noreferrer">Weather Underground</a><a href="https://weathercloud.net/" target="_blank" rel="noreferrer">Weathercloud</a></strong><small>Clique em uma rede para acessar a plataforma.</small></div></article><article><Gauge size={20} /><div><span>Última leitura</span><strong>{new Date(data.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}</strong><small>{value(m.pressureRelative, 1)} {unit(m.pressureRelative)} · {value(m.temperature, 1)} {unit(m.temperature)}</small></div></article></div></div></div>;
}

function SatellitePanel() {
  const layers = [{ label: "Satélite", path: "satelite" }, { label: "Chuva", path: "chuva" }, { label: "Infravermelho", path: "satelite/infravermelha" }, { label: "Visível", path: "satelite/visivel" }, { label: "Vapor d’água", path: "satelite/vapor-dagua" }];
  const [layer, setLayer] = useState("satelite/infravermelha");
  const climatempoUrl = `https://www.climatempo.com.br/mapas/${layer}`;
  const selected = layers.find((item) => item.path === layer)?.label ?? "Satélite";
  return <section className="satellite-panel"><header><div><span>{selected} · Brasil</span><h2>Satélite meteorológico</h2><p>A data e o horário aparecem na barra de reprodução do mapa.</p></div><div className="satellite-actions"><a href={climatempoUrl} target="_blank" rel="noreferrer">Abrir no Climatempo ↗</a></div></header><div className="satellite-frame satellite-crop"><iframe key={layer} title={`${selected} do Climatempo`} src={climatempoUrl} loading="lazy" allow="fullscreen" referrerPolicy="strict-origin-when-cross-origin" /><div className="satellite-menu-mask" aria-hidden="true" /><div className="satellite-layer-switch" aria-label="Camadas do mapa">{layers.map((item) => <button key={item.path} className={layer === item.path ? "active" : ""} onClick={() => setLayer(item.path)} aria-pressed={layer === item.path}>{item.label}</button>)}</div><div className="satellite-credit"><strong>Fonte: Climatempo</strong><span>Imagem e evolução recente observada.</span></div></div><p className="satellite-fallback">Se o provedor bloquear a visualização incorporada no seu navegador, use <a href={climatempoUrl} target="_blank" rel="noreferrer">Abrir no Climatempo</a>.</p></section>;
}

function LoadingDashboard() {
  return <div className="loading-grid">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="loading-card" />)}</div>;
}

function ContextualNotice({ insight }: { insight: NonNullable<WeatherData["insight"]> }) {
  const confidence = insight.condition.confidence == null ? null : `${Math.round(insight.condition.confidence * 100)}%`;
  return <aside className={`contextual-notice ${insight.alert.key}`} aria-label="Condições predominantes e nível de alerta"><AlertTriangle size={20} /><div><span>Condições predominantes</span><strong>{insight.condition.label}</strong></div><div><span>Nível de alerta</span><strong>{insight.alert.label}</strong></div><small>{insight.source}{confidence ? ` · confiança ${confidence}` : ""}</small></aside>;
}

export default function WeatherDashboard() {
  const [storedData, setData] = useState<WeatherData | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState(false);
  const [forecastPending, setForecastPending] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeKey>("24h");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
  const [tab, setTab] = useState<TabKey>("map");
  const [historyGroup, setHistoryGroup] = useState<GroupKey>("outdoor");

  const requestId = useRef(0);
  const responseCache = useRef(new Map<string, { data: WeatherData; receivedAt: number }>());
  const extrasCache = useRef<Pick<WeatherData, "forecast" | "insight"> | null>(null);
  const needsHistory = tab === "current" || tab === "evolution" || tab === "wind";
  const requestView = needsHistory ? (tab === "current" ? "current" : "history") : "summary";
  const requestKey = `${requestView}:${range}:${selectedDate}`;
  const data = loadedKey === requestKey ? storedData : null;
  const load = useCallback(async (selectedRange: RangeKey, selectedDay: string, quiet = false, signal?: AbortSignal) => {
    const id = ++requestId.current;
    if (!quiet) setRefreshing(true);
    try {
      const view = needsHistory ? (tab === "current" ? "current" : "history") : "summary";
      const cacheKey = `${view}:${selectedRange}:${selectedDay}`;
      const cached = responseCache.current.get(cacheKey);
      const maxAge = view === "summary" ? 45_000 : 120_000;
      if (cached && Date.now() - cached.receivedAt < maxAge) {
        setData({ ...cached.data, ...extrasCache.current }); setError(false);
        setLoadedKey(cacheKey);
        return;
      }
      const response = await fetch(`/api/weather?range=${selectedRange}&date=${encodeURIComponent(selectedDay)}&view=${view}`, { signal });
      if (!response.ok) throw new Error("unavailable");
      const next = await response.json() as WeatherData;
      if (signal?.aborted || id !== requestId.current) return;
      responseCache.current.set(cacheKey, { data: next, receivedAt: Date.now() });
      setData({ ...next, ...extrasCache.current }); setError(false);
      setLoadedKey(cacheKey);
    } catch { if (!signal?.aborted && id === requestId.current) setError(true); }
    finally { if (id === requestId.current) setRefreshing(false); }
  }, [needsHistory, tab]);

  useEffect(() => {
    const hash = window.location.hash.slice(1) as TabKey;
    if (["current", "evolution", "wind", "map", "satellite", "profile"].includes(hash)) setTab(hash);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(range, selectedDate, false, controller.signal);
    const timer = window.setInterval(() => load(range, selectedDate, true, controller.signal), needsHistory && range !== "24h" ? 300_000 : 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load, range, selectedDate, needsHistory]);
  useEffect(() => {
    if (tab !== "map" || loadedKey !== requestKey) return;
    const controller = new AbortController();
    const loadExtras = async () => {
      try {
        const response = await fetch("/api/weather?view=extras", { signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const extras = await response.json() as Pick<WeatherData, "forecast" | "insight">;
        if (controller.signal.aborted) return;
        extrasCache.current = extras;
        setData((current) => current ? { ...current, ...extras } : current);
      } catch { /* The live readings remain available if a forecast source fails. */ }
      finally { if (!controller.signal.aborted) setForecastPending(false); }
    };
    void loadExtras();
    const timer = window.setInterval(() => void loadExtras(), 300_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [tab, loadedKey, requestKey]);

  const handleTab = (next: string) => { const selected = next as TabKey; setTab(selected); if (selected === "current" && range !== "24h") setRange("24h"); window.history.replaceState(null, "", `#${selected}`); };
  const openHistory = (group: GroupKey) => { setHistoryGroup(group); setTab("evolution"); window.history.replaceState(null, "", "#evolution"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const condition = data?.insight?.condition.label ?? (data && Number(data.metrics.rainRate?.value) > 0 ? "Chuva em curso" : data && Number(data.metrics.windSpeed?.value) > 30 ? "Vento forte" : data && Number(data.metrics.uv?.value) >= 8 ? "UV elevado" : "Condições estáveis");

  return <TooltipProvider><main className="dashboard-shell"><header className="topbar"><a className="brand" href="#map" onClick={() => handleTab("map")}><span className="brand-mark"><WeatherStationMark /></span><span><strong>Estação Meteorológica Bauru Sul</strong><small>{data ? `Bauru–SP · ${data.station.latitude.toFixed(4)}, ${data.station.longitude.toFixed(4)}` : "Bauru–SP"}</small></span></a><div className="header-status"><div className="reported"><span>{condition}</span><small>{data ? `Atualizado ${new Date(data.updatedAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}` : "Conectando…"}</small></div><span className={`live-pill ${error ? "offline" : ""}`}><i />{error ? "Dados indisponíveis" : "Ao vivo"}</span><button className="refresh-button" onClick={() => load(range, selectedDate)} disabled={refreshing} aria-label="Atualizar dados"><RefreshCw size={17} className={refreshing ? "spin" : ""} /></button></div></header>

    <Tabs value={tab} onValueChange={handleTab} className="dashboard-tabs"><nav className="nav-wrap" aria-label="Seções da estação"><TabsList className="nav-tabs"><TabsTrigger value="map"><MapPinned />Previsão</TabsTrigger><TabsTrigger value="satellite"><Satellite />Satélite</TabsTrigger><TabsTrigger value="current"><Activity />Dados Atuais</TabsTrigger><TabsTrigger value="wind"><Wind />Ventos</TabsTrigger><TabsTrigger value="evolution"><History />Histórico</TabsTrigger><TabsTrigger value="profile"><Radio />Perfil</TabsTrigger></TabsList></nav>
      <div className="dashboard-content">{data?.insight && <ContextualNotice insight={data.insight} />}{error && <div className="error-banner">A última consulta falhou. Os dados exibidos podem não estar atualizados; tentaremos novamente automaticamente.</div>}{tab === "satellite" ? <SatellitePanel /> : !data ? <LoadingDashboard /> : <><TabsContent value="current"><CurrentPanel data={data} onGraph={openHistory} selectedDate={selectedDate} onDateChange={setSelectedDate} range={range} onRangeChange={setRange} /></TabsContent><TabsContent value="evolution"><EvolutionPanel data={data} range={range} setRange={setRange} group={historyGroup} setGroup={setHistoryGroup} /></TabsContent><TabsContent value="wind"><WindPanel data={data} range={range} setRange={setRange} /></TabsContent><TabsContent value="map"><MapPanel data={data} forecastPending={forecastPending} /></TabsContent><TabsContent value="satellite"><SatellitePanel /></TabsContent><TabsContent value="profile"><ProfilePanel data={data} /></TabsContent></>}</div>
    </Tabs>
    <footer className="site-footer"><span>Dados observacionais da estação Ecowitt GW3000</span><span>Atualização automática</span></footer>
  </main></TooltipProvider>;
}
