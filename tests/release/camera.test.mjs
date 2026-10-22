import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCameraService} from '../../runtime/camera-service.mjs';
test('camera retains validated image on upstream failure and restores after restart',async()=>{
 const cache=await mkdtemp(join(process.env.CLIMA_TEST_TMP??tmpdir(),'clima-camera-'));
 let clock=Date.parse('2026-10-22T12:00:00Z'),failed=false;
 const bytes=await readFile(new URL('./camera.jpg',import.meta.url));
 const fetchImpl=async(input)=>{
  if(failed)throw new Error('TEST_NETWORK_FAILURE');
  const url=new URL(input);
  if(url.hostname==='oss.ecowitt.net')return new Response(bytes,{headers:{'Content-Type':'image/jpeg'}});
  if(url.pathname.endsWith('/device/list'))return Response.json({code:0,data:{list:[{id:360893,mac:'camera'},{id:251816,mac:'station'}]}});
  return Response.json({code:0,data:url.searchParams.get('mac')==='camera'?{camera:{photo:{time:String(clock/1000),url:'https://oss.ecowitt.net/test.jpg'}}}:{rainfall_piezo:{rain_rate:{value:'1.5',unit:'mm/hr',time:String(clock/1000)}}}});
 };
 const options={env:{ECOWITT_APPLICATION_KEY:'test',ECOWITT_API_KEY:'test'},fetchImpl,now:()=>clock,cacheDirectory:cache,setIntervalImpl:()=>({unref(){}})};
 try{
  const service=createCameraService(options);await service.start();await service.refresh();
  assert.equal(service.current().status,'fresh');assert.equal(service.current().rainConfirmed,true);
  const first=await service.handle('/api/camera/image',new Request('http://localhost/api/camera/image'));
  assert.deepEqual(Buffer.from(await first.arrayBuffer()),bytes);
  failed=true;clock+=60_000;await service.refresh();
  assert.equal(service.current().refreshFailed,true);assert.equal(service.current().status,'fresh');
  const restored=createCameraService(options);await restored.start();await restored.refresh();
  assert.equal(restored.current().restoredFromCache,true);assert.equal(restored.current().capturedAt,(clock-60_000)/1000);
  clock+=21*60_000;assert.equal(restored.current().status,'stale');assert.equal(restored.current().imageUrl,'/api/camera/image');
  let imageResponse=await restored.handle('/api/camera/image',new Request('http://localhost/api/camera/image'));
  assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('x-capture-time'),String(Date.parse('2026-10-22T12:00:00Z')/1000));
  clock=Date.parse('2026-10-23T02:00:00Z');
  assert.equal(restored.current().status,'night');assert.equal(restored.current().imageUrl,'/api/camera/image');
  const nightSequence=await restored.handle('/api/camera/sequence',new Request('http://localhost/api/camera/sequence'));
  assert.equal((await nightSequence.json()).status,'night');
  imageResponse=await restored.handle('/api/camera/image',new Request('http://localhost/api/camera/image'));
  assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('x-capture-time'),String(Date.parse('2026-10-22T12:00:00Z')/1000));
 }finally{await rm(cache,{recursive:true,force:true});}
});
