import assert from "node:assert/strict";
import { formatCameraRainReading } from "../lib/camera-presentation.mjs";

const sensorTime = Date.parse("2026-10-06T18:52:00Z") / 1000;
const base = { sensorFresh: true, sensorTime, rainRate: 0, rainUnit: "mm/hr" };

assert.equal(
  formatCameraRainReading(base),
  "Sensores de chuva lidos 06/10/2026, 15:52 · 0,0 mm/hr",
  "the line uses the sensor timestamp converted to Brasília and preserves a real zero",
);
assert.equal(
  formatCameraRainReading({ ...base, rainRate: 0.7 }),
  "Sensores de chuva lidos 06/10/2026, 15:52 · 0,7 mm/hr",
  "the line shows the sensor value and unit without using the photo timestamp",
);
for (const missing of [null, { ...base, rainRate: null }, { ...base, rainRate: 0, sensorFresh: false }, { ...base, sensorTime: null }]) {
  const label = formatCameraRainReading(missing);
  assert.equal(label, "Leitura do sensor de chuva indisponível");
  assert.ok(!label.includes("0 mm/hr"), "missing or stale data must not be represented as zero");
}

console.log("PASS camera rain presentation: BRT sensor time, source unit, true zero and unavailable states");
