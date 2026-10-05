declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ECOWITT_APPLICATION_KEY?: string;
    ECOWITT_API_KEY?: string;
    ECOWITT_MAC?: string;
    ECOWITT_DEVICE_ID?: string;
    ECOWITT_LOCAL_ARCHIVE_TOKEN?: string;
    WEATHER_HISTORY_READ_ONLY?: string;
    APSYSTEMS_APP_ID?: string;
    APSYSTEMS_APP_SECRET?: string;
  }
}
