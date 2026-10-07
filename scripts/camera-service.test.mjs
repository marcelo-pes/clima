import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createCameraService, cameraTiming } from "../runtime/camera-service.mjs";

const secret = "camera-test-secret-never-log";
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
let now = 1_791_309_700_000;
let capturedAt = Math.floor(now / 1000);
let rainRate = "0.0";
let sensorTime = capturedAt;
let imageRequests = 0;
let failUpstream = false;
let apiRequests = [];
let rainRequests = [];
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
      if (failUpstream) throw new Error("upstream unavailable");
      if (url.pathname.endsWith("/device/list")) return Response.json({ code: 0, data: { devices: [
        { id: 360893, name: "HP10", type: 2, mac: "camera-mac" },
        { id: 251816, name: "BAURU SUL", type: 1, mac: "station-mac" },
      ] } });
      if (url.searchParams.get("call_back") === "camera") return Response.json({ code: 0, data: { camera: { photo: { time: String(capturedAt), url: "https://osswww.ecowitt.net/images/test.jpg" } } } });
      rainRequests.push({ callback: url.searchParams.get("call_back"), unit: url.searchParams.get("rainfall_unitid"), mac: url.searchParams.get("mac") });
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
assert.deepEqual(rainRequests[0], { callback: "rainfall_piezo,rainfall", unit: "12", mac: "station-mac" }, "HP10 service reads the same station rain-rate metric and mm/hr unit as dashboard indicators");
const upstreamCount = apiRequests.length;
const meta = await (await service.handle("/api/camera", new Request("https://clima2.antaisolar.com.br/api/camera"))).json();
assert.equal(meta.imageUrl, "/api/camera/image");
assert.ok(!JSON.stringify(meta).includes(secret));
assert.ok(!JSON.stringify(meta).includes("ecowitt.net"), "upstream image URL stays server-side");
const initialSequence = await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.equal(initialSequence.count, 1);
assert.equal(initialSequence.images[0].capturedAt, capturedAt, "sequence timestamps come from the camera capture");
assert.equal(initialSequence.intervalMs, 0, "a single image reports zero covered interval");
assert.equal(initialSequence.checkedAt, Math.floor(now / 1000), "last successful check is exposed as real Unix seconds");
const imageResponse = await service.handle("/api/camera/image", new Request("https://clima2.antaisolar.com.br/api/camera/image"));
assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), jpeg);
assert.equal(await service.handle("/api/other", new Request("https://clima2.antaisolar.com.br/api/other")), null);
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
rainRate = "-";
await service.refresh();
assert.equal(service.current().rainRate, null, "a missing rain rate must remain unavailable, never become zero");
assert.equal(service.current().sensorFresh, true, "the sensor timestamp remains distinct from a missing rate");
rainRate = "0.0";
await service.refresh();
assert.equal(service.current().rainRate, 0, "a real zero rain-rate reading remains zero");

capturedAt += 300;
now += 300_000;
await service.refresh();
assert.equal(imageRequests, 2, "a new capture is fetched exactly once");
assert.equal(service.current().capturedAt, capturedAt);
assert.equal(apiRequests.filter((path) => path.endsWith("/device/list")).length, 1, "device discovery is cached");
assert.ok(logs.every((event) => !JSON.stringify(event).includes(secret)));

const beforeSequenceRequests = apiRequests.length;
let sequence = await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.deepEqual(sequence.images.map((frame) => frame.capturedAt), [capturedAt - 300, capturedAt]);
const historicalFrame = await service.handle(`/api/camera/sequence/${capturedAt - 300}`, new Request(`https://clima2.antaisolar.com.br/api/camera/sequence/${capturedAt - 300}`));
assert.equal(historicalFrame.status, 200);
assert.equal(historicalFrame.headers.get("x-capture-time"), String(capturedAt - 300));
assert.deepEqual(new Uint8Array(await historicalFrame.arrayBuffer()), jpeg);
const notModified = await service.handle(`/api/camera/sequence/${capturedAt - 300}`, new Request(`https://clima2.antaisolar.com.br/api/camera/sequence/${capturedAt - 300}`, { headers: { "If-None-Match": `"hp10-${capturedAt - 300}"` } }));
assert.equal(notModified.status, 304, "timestamped frames support browser cache validation");
assert.equal(apiRequests.length, beforeSequenceRequests, "sequence and image delivery never call Ecowitt");

for (let index = 0; index < 13; index++) {
  capturedAt += 300;
  now += 300_000;
  await service.refresh();
}
sequence = await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.equal(sequence.count, 12, "only the latest twelve images remain available");
assert.deepEqual(sequence.images.map((frame) => frame.capturedAt), [...sequence.images.map((frame) => frame.capturedAt)].sort((left, right) => left - right));
assert.equal(new Set(sequence.images.map((frame) => frame.capturedAt)).size, 12, "duplicate captures are removed");
assert.equal(sequence.intervalMs, 11 * 300_000, "coverage reports the real interval between the oldest and newest image");
assert.equal(sequence.images.at(-1).capturedAt, capturedAt);
assert.equal(readdirSync(cacheDirectory).filter((name) => /^hp10-\d+\.jpg$/.test(name)).length, 12, "persistent cache retains exactly twelve timestamped frames");

const restored = createCameraService({ env: {}, fetchImpl: async () => { throw new Error("unexpected fetch"); }, now: () => now, setIntervalImpl: () => ({ unref() {} }), cacheDirectory });
await restored.start();
assert.equal(restored.current().status, "fresh", "a restart restores a fresh cached photo before the next refresh");
assert.equal(restored.current().capturedAt, capturedAt);
const restoredSequence = await (await restored.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.equal(restoredSequence.count, 12, "the sequence survives a server restart");
assert.equal(restoredSequence.oldestCapturedAt, capturedAt - 11 * 300);

failUpstream = true;
now += 300_000;
await service.refresh();
let statusAfterFailure = await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.equal(statusAfterFailure.refreshFailed, true, "failed collection is reported while the last sequence remains available");
assert.equal(statusAfterFailure.checkedAt, Math.floor(now / 1000));
failUpstream = false;
now += 300_000;
await service.refresh();
statusAfterFailure = await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json();
assert.equal(statusAfterFailure.refreshFailed, false, "a later successful cycle clears the failure state");
assert.equal(statusAfterFailure.count, 12);

now = capturedAt * 1000 + cameraTiming.maxPhotoAgeMs + 1;
assert.equal(service.current().status, "stale");
assert.equal(service.current().imageUrl, null);
assert.equal((await (await service.handle("/api/camera/sequence", new Request("https://clima2.antaisolar.com.br/api/camera/sequence"))).json()).status, "stale", "old sequences are labeled stale without changing their capture timestamps");
assert.equal((await service.handle("/api/camera/image", new Request("https://clima2.antaisolar.com.br/api/camera/image"))).status, 503);
rmSync(cacheDirectory, { recursive: true, force: true });
console.log("camera service cache, 12-frame order/retention, actual capture times, upstream privacy, rain confirmation and stale fallback: ok");
