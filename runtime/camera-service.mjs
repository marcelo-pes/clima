import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const API = "https://api.ecowitt.net/api/v3";
const POLL_MS = 5 * 60_000; // Match the HP10 cloud capture cadence.
const PHOTO_MAX_AGE_MS = 20 * 60_000; // Four server polling intervals.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = new Set(["osswww.ecowitt.net", "oss.ecowitt.net"]);

function findObjects(value, predicate, found = []) {
  if (Array.isArray(value)) value.forEach((item) => findObjects(item, predicate, found));
  else if (value && typeof value === "object") {
    if (predicate(value)) found.push(value);
    Object.values(value).forEach((item) => findObjects(item, predicate, found));
  }
  return found;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentImageUrl(photo) {
  try {
    const url = new URL(photo?.url);
    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function createCameraService({ env, fetchImpl = fetch, now = () => Date.now(), setIntervalImpl = setInterval, logger = () => {}, cacheDirectory = process.env.CLIMA_CAMERA_CACHE_DIR }) {
  let snapshot = null;
  let image = null;
  let macs = null;
  let inFlight = null;
  let timer = null;
  let startPromise = null;

  async function persistCache() {
    if (!cacheDirectory || !snapshot || !image) return;
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    const imageName = `hp10-${image.capturedAt}.jpg`;
    const imageTemporary = join(cacheDirectory, `${imageName}.tmp`);
    await writeFile(imageTemporary, image.bytes, { mode: 0o600 });
    await rename(imageTemporary, join(cacheDirectory, imageName));
    const metadata = { ...snapshot, cachedImageName: imageName };
    const metadataTemporary = join(cacheDirectory, "hp10-current.json.tmp");
    await writeFile(metadataTemporary, JSON.stringify(metadata), { mode: 0o600 });
    await rename(metadataTemporary, join(cacheDirectory, "hp10-current.json"));
    const files = await readdir(cacheDirectory);
    await Promise.all(files.filter((name) => /^hp10-\d+\.jpg$/.test(name) && name !== imageName).map((name) => rm(join(cacheDirectory, name), { force: true })));
  }

  async function restoreCache() {
    if (!cacheDirectory) return;
    try {
      const metadata = JSON.parse(await readFile(join(cacheDirectory, "hp10-current.json"), "utf8"));
      const capturedAt = numberOrNull(metadata.capturedAt);
      if (!capturedAt || metadata.cachedImageName !== `hp10-${capturedAt}.jpg`) return;
      const bytes = new Uint8Array(await readFile(join(cacheDirectory, metadata.cachedImageName)));
      if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return;
      const restored = { ...metadata };
      delete restored.cachedImageName;
      snapshot = { ...restored, restoredFromCache: true };
      image = { capturedAt, bytes };
    } catch {
      // Empty/partial cache is normal on first run; the scheduled poll will fill it.
    }
  }

  async function ecowitt(path, params) {
    const url = new URL(`${API}${path}`);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`ecowitt_http_${response.status}`);
    const result = await response.json();
    if (Number(result?.code) !== 0) throw new Error(`ecowitt_code_${String(result?.code ?? "unknown")}`);
    return result;
  }

  async function devices(auth) {
    if (macs) return macs;
    const result = await ecowitt("/device/list", auth);
    const all = findObjects(result.data, (item) => typeof (item.mac ?? item.mac_address) === "string");
    const camera = all.find((item) => String(item.id ?? item.device_id) === String(env.ECOWITT_CAMERA_DEVICE_ID ?? "360893"))
      ?? all.find((item) => String(item.name ?? item.device_name ?? "").trim().toUpperCase() === "HP10");
    const station = all.find((item) => String(item.id ?? item.device_id) === String(env.ECOWITT_DEVICE_ID ?? "251816"))
      ?? all.find((item) => String(item.name ?? item.device_name ?? "").toUpperCase().includes("BAURU SUL"));
    if (!camera || !station) throw new Error("configured_devices_unavailable");
    macs = { camera: camera.mac ?? camera.mac_address, station: station.mac ?? station.mac_address };
    return macs;
  }

  async function loadImage(url) {
    const response = await fetchImpl(url, { headers: { Accept: "image/jpeg" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`camera_image_http_${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "image/jpeg") throw new Error("camera_image_not_jpeg");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) throw new Error("camera_image_too_large");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("camera_image_invalid");
    return bytes;
  }

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const applicationKey = env.ECOWITT_APPLICATION_KEY;
        const apiKey = env.ECOWITT_API_KEY;
        if (!applicationKey || !apiKey) throw new Error("ecowitt_credentials_missing");
        const auth = { application_key: applicationKey, api_key: apiKey };
        const ids = await devices(auth);
        const [cameraData, stationData] = await Promise.all([
          ecowitt("/device/real_time", { ...auth, mac: ids.camera, call_back: "camera" }),
          ecowitt("/device/real_time", { ...auth, mac: ids.station, call_back: "rainfall_piezo,rainfall", rainfall_unitid: "12" }),
        ]);
        const photo = cameraData?.data?.camera?.photo;
        const capturedAt = numberOrNull(photo?.time);
        const sourceUrl = currentImageUrl(photo);
        if (!capturedAt || !sourceUrl) throw new Error("camera_photo_metadata_invalid");
        const sensor = stationData?.data?.rainfall_piezo ?? stationData?.data?.rainfall ?? {};
        const rate = numberOrNull(sensor?.rain_rate?.value);
        const rateUnit = sensor?.rain_rate?.unit ?? "mm/hr";
        const sensorTime = numberOrNull(sensor?.rain_rate?.time ?? stationData?.time);
        const sensorFresh = sensorTime !== null && now() - sensorTime * 1000 >= -60_000 && now() - sensorTime * 1000 <= 3 * 60_000;
        const checkedAt = now();

        const isNewCapture = !snapshot || snapshot.capturedAt !== capturedAt;
        if (isNewCapture) {
          const downloaded = await loadImage(sourceUrl);
          image = { capturedAt, bytes: downloaded };
          // No computer-vision model is configured in the existing project/runtime.
          // Keep the result explicitly indeterminate; never infer sky state from darkness.
          snapshot = { capturedAt, checkedAt, sensorTime, sensorFresh, rainRate: rate, rainUnit: rateUnit, rainConfirmed: sensorFresh && rate !== null && rate > 0, visualCondition: null, analysisStatus: "classifier_not_configured" };
        } else {
          snapshot = { ...snapshot, checkedAt, sensorTime, sensorFresh, rainRate: rate, rainUnit: rateUnit, rainConfirmed: sensorFresh && rate !== null && rate > 0 };
        }
        await persistCache();
        logger({ event: "camera_refresh_ok", capturedAt, newCapture: isNewCapture, imageBytes: image?.bytes.length ?? 0 });
      } catch (error) {
        logger({ event: "camera_refresh_failed", reason: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown" });
        if (snapshot) snapshot = { ...snapshot, checkedAt: now(), refreshFailed: true };
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function current() {
    if (!snapshot || !image) return { status: "unavailable", capturedAt: null, sensorTime: snapshot?.sensorTime ?? null, sensorFresh: false, rainRate: snapshot?.rainRate ?? null, rainUnit: snapshot?.rainUnit ?? "mm/hr", rainConfirmed: false, visualCondition: null, analysisStatus: "classifier_not_configured", imageUrl: null };
    const ageMs = now() - snapshot.capturedAt * 1000;
    const fresh = ageMs >= -60_000 && ageMs <= PHOTO_MAX_AGE_MS;
    return { ...snapshot, status: fresh ? "fresh" : "stale", ageMs: Math.max(0, ageMs), imageUrl: fresh ? "/api/camera/image" : null };
  }

  function handle(path, request) {
    if (path === "/api/camera") {
      const metadata = current();
      return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/api/camera/image") {
      const metadata = current();
      if (metadata.status !== "fresh" || !image) return new Response("Camera image unavailable or stale", { status: 503, headers: { "Cache-Control": "no-store" } });
      const etag = `"hp10-${image.capturedAt}"`;
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "public, max-age=60" } });
      return new Response(image.bytes, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(image.bytes.length), "Cache-Control": "public, max-age=60", ETag: etag, "X-Capture-Time": String(image.capturedAt) } });
    }
    return null;
  }

  function start() {
    if (startPromise) return startPromise;
    startPromise = (async () => {
      await restoreCache();
      void refresh();
      timer = setIntervalImpl(() => void refresh(), POLL_MS);
      timer?.unref?.();
    })();
    return startPromise;
  }

  return { current, handle, refresh, start, pollIntervalMs: POLL_MS, maxPhotoAgeMs: PHOTO_MAX_AGE_MS };
}

export const cameraTiming = { pollIntervalMs: POLL_MS, maxPhotoAgeMs: PHOTO_MAX_AGE_MS };
