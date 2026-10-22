export function formatCameraRainReading(camera) {
  if (!camera?.sensorFresh || camera.sensorTime === null || !Number.isFinite(camera.sensorTime) || camera.rainRate === null || !Number.isFinite(camera.rainRate)) {
    return "Leitura do sensor de chuva indisponível";
  }

  const timestamp = new Date(camera.sensorTime * 1000).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const rate = camera.rainRate.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const unit = typeof camera.rainUnit === "string" ? camera.rainUnit.trim() : "";
  return `Sensores de chuva lidos ${timestamp} · ${rate}${unit ? ` ${unit}` : ""}`;
}
