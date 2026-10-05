export const LIGHTNING_ALERT_MAX_AGE_MS = 30 * 60 * 1000;
export function recentLightning(distance: number | null, detectionSeconds: number | null, now = Date.now()) {
  if (distance === null || detectionSeconds === null || !Number.isFinite(detectionSeconds)) return false;
  const age = now - detectionSeconds * 1000;
  return distance >= 0 && distance <= 20 && age >= 0 && age <= LIGHTNING_ALERT_MAX_AGE_MS;
}
export const COMPASS_NAMES = ["Norte", "Norte-nordeste", "Nordeste", "Leste-nordeste", "Leste", "Leste-sudeste", "Sudeste", "Sul-sudeste", "Sul", "Sul-sudoeste", "Sudoeste", "Oeste-sudoeste", "Oeste", "Oeste-noroeste", "Noroeste", "Norte-noroeste"];
export function compassSector(degrees: number) { return Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16; }
export function circularDirection(points: { time: number; value: number }[], now = Date.now()): number | null {
  const recent = points.filter(p => Number.isFinite(p.value) && p.time <= now && p.time >= now - 600000);
  if (!recent.length) return null;
  const x = recent.reduce((sum,p) => sum + Math.cos(p.value * Math.PI/180),0);
  const y = recent.reduce((sum,p) => sum + Math.sin(p.value * Math.PI/180),0);
  if (Math.hypot(x,y) < 1e-8) return null;
  return (Math.atan2(y,x)*180/Math.PI + 360)%360;
}
