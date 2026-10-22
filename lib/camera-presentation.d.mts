export type CameraRainReading = {
  sensorFresh: boolean;
  sensorTime: number | null;
  rainRate: number | null;
  rainUnit: string;
} | null;

export function formatCameraRainReading(camera: CameraRainReading): string;
