export function sunTime(date: Date, latitude: number, longitude: number, sunrise: boolean) {
  const [civilYear,civilMonth,civilDay] = date.toLocaleDateString("en-CA", {timeZone:"America/Sao_Paulo"}).split("-").map(Number);
  date = new Date(Date.UTC(civilYear,civilMonth-1,civilDay,12));
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
