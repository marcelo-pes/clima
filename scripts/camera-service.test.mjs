import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createCameraService, cameraTiming } from "../runtime/camera-service.mjs";

const secret = "camera-test-secret-never-log";
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
let now = 1_791_309_700_000;
let capturedAt = Math.floor(now / 1000);
let rainRate = "0.0";
let sensorTime = capturedAt;
let imageRequests = 0;
let apiRequests = [];
const logs = [];
const cacheDirectory = mkdtempSync(join(process.cwd(), ".sites-runtime", "camera-service-test-"));
const service = createCameraService({
  env: { ECOWITT_APPLICATION_KEY: secret, ECOWITT_API_KEY: secret, ECOWITT_DEVICE_ID: "251816", ECOWITT_CAMERA_DEVICE_ID: "360893" },
  now: () => now,
  setIntervalImpl: () => ({ unref() {} }),
  logger: (entry) => logs.push(entry),
  cacheDirectory,
  fetchImpl: async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.ecowitt.net") {
      apiRequests.push(url.pathname);
      if (url.pathname.endsWith("/device/list")) return Response.json({ code: 0, data: { devices: [
        { id: 360893, name: "HP10", type: 2, mac: "camera-mac" },
        { id: 251816, name: "BAURU SUL", type: 1, mac: "station-mac" },
      ] } });
      if (url.searchParams.get("call_back") === "camera") return Response.json({ code: 0, data: { camera: { photo: { time: String(capturedAt), url: "https://osswww.ecowitt.net/images/test.jpg" } } } });
      return Response.json({ code: 0, time: String(sensorTime), data: { rainfall_piezo: { rain_rate: { value: rainRate, unit: "mm/hr", time: String(sensorTime) } } } });
    }
    imageRequests++;
    return new Response(jpeg, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) } });
  },
});

assert.deepEqual(cameraTiming, { pollIntervalMs: 300_000, maxPhotoAgeMs: 1_200_000 });
await service.refresh();
assert.equal(service.current().status, "fresh");
assert.equal(service.current().capturedAt, capturedAt);
assert.equal(service.current().analysisStatus, "classifier_not_configured");
assert.equal(service.current().visualCondition, null, "must not invent image classification");
assert.equal(service.current().rainConfirmed, false);
assert.equal(imageRequests, 1);
const upstreamCount = apiRequests.length;
const meta = await service.handle("/api/camera", new Request("https://clima2.antaisolar.com.br/api/camera")).json();
assert.equal(meta.imageUrl, "/api/camera/image");
assert.ok(!JSON.stringify(meta).includes(secret));
assert.ok(!JSON.stringify(meta).includes("ecowitt.net"), "upstream image URL stays server-side");
const imageResponse = service.handle("/api/camera/image", new Request("https://clima2.antaisolar.com.br/api/camera/image"));
assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), jpeg);
assert.equal(service.handle("/api/other", new Request("https://clima2.antaisolar.com.br/api/other")), null);
assert.equal(apiRequests.length, upstreamCount, "visitor requests must not trigger Ecowitt calls");

await service.refresh();
assert.equal(imageRequests, 1, "same capture must reuse cached pixels and not reanalyze/redownload");
assert.equal(apiRequests.filter((path) => path.endsWith("/device/real_time")).length, 4);
rainRate = "0.7";
sensorTime = capturedAt - 500;
await service.refresh();
assert.equal(service.current().rainConfirmed, false, "stale station rain cannot confirm current rain");
sensorTime = capturedAt;
await service.refresh();
assert.equal(service.current().rainConfirmed, true, "rain can only be confirmed from a recent sensor rate");
assert.equal(imageRequests, 1);

capturedAt += 300;
now += 300_000;
await service.refresh();
assert.equal(imageRequests, 2, "a new capture is fetched exactly once");
assert.equal(service.current().capturedAt, capturedAt);
assert.equal(apiRequests.filter((path) => path.endsWith("/device/list")).length, 1, "device discovery is cached");
assert.ok(logs.every((event) => !JSON.stringify(event).includes(secret)));

const restored = createCameraService({ env: {}, fetchImpl: async () => { throw new Error("unexpected fetch"); }, now: () => now, setIntervalImpl: () => ({ unref() {} }), cacheDirectory });
await restored.start();
assert.equal(restored.current().status, "fresh", "a restart restores a fresh cached photo before the next refresh");
assert.equal(restored.current().capturedAt, capturedAt);

now = capturedAt * 1000 + cameraTiming.maxPhotoAgeMs + 1;
assert.equal(service.current().status, "stale");
assert.equal(service.current().imageUrl, null);
assert.equal(service.handle("/api/camera/image", new Request("https://clima2.antaisolar.com.br/api/camera/image")).status, 503);
rmSync(cacheDirectory, { recursive: true, force: true });
console.log("camera service cache, upstream privacy, rain confirmation and stale fallback: ok");
