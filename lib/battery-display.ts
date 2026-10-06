/** Sensor scale: Ecowitt HTTP API v1.0.5, eWH57_SENSOR, battery level 0–5.
 * https://oss.ecowitt.net/uploads/20260109/HTTP%20API%20interface%20Protocol%20(Generic)-(V1.0.5-2025-10-08)%20.pdf
 * Percent is the normalized reported level, not a voltage-derived state of charge.
 */
export type BatteryReading = { value: number | string; unit: string; time: number | null } | null;
export function batteryDisplay(reading: BatteryReading, sensor: "voltage" | "wh57" = "voltage") {
  const raw = reading?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "" || raw === "-")
    return { percent: null, text: "—", detail: "Sem leitura de bateria", kind: "missing" };
  const n = Number(raw), unit = reading!.unit.trim();
  if (unit === "%" && Number.isFinite(n) && n >= 0 && n <= 100)
    return { percent: n, text: `${n.toLocaleString("pt-BR", {maximumFractionDigits: 2})}%`, detail: "Percentual informado pelo sensor", kind: "percent" };
  if (/^(v|volts?)$/i.test(unit) && Number.isFinite(n) && n >= 0)
    return { percent: null, text: `${n.toLocaleString("pt-BR", {maximumFractionDigits: 2})} V`, detail: "Tensão informada; carga percentual indisponível", kind: "voltage" };
  if (sensor === "wh57" && !unit && Number.isInteger(n) && n >= 0 && n <= 5)
    return { percent: n * 20, text: `${n * 20}%`, detail: `Nível informado ${n}/5; escala normalizada, não estimativa por tensão`, kind: "level" };
  if (unit === "%" || sensor === "wh57" && !unit && Number.isFinite(n))
    return { percent: null, text: "—", detail: `Leitura fora da escala válida: ${String(raw)}${unit}; carga indisponível`, kind: "invalid" };
  const state = String(raw).trim();
  if (/^(normal|low|baixa|baix[oa]|offline)$/i.test(state))
    return { percent: null, text: /^normal$/i.test(state) ? "Normal" : /^offline$/i.test(state) ? "Offline" : "Baixa", detail: "Estado informado; carga percentual indisponível", kind: "status" };
  return { percent: null, text: `${state}${unit ? ` ${unit}` : ""}`, detail: "Carga percentual indisponível para esta leitura", kind: "unknown" };
}
export function batterySegments(percent: number | null) {
  return [0,1,2,3].map(i => percent === null ? 0 : Math.min(100, Math.max(0, (percent - i * 25) * 4)));
}
