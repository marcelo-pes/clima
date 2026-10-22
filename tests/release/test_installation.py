import hashlib,http.server,json,os,sqlite3,subprocess,sys,tempfile,threading,unittest
from pathlib import Path
TOOLS=Path(__file__).resolve().parents[2]/'deploy/tools'
sys.path.insert(0,str(TOOLS))
from release import stage
ARCHIVE=os.environ.get('CLIMA_TEST_ARCHIVE')
@unittest.skipUnless(ARCHIVE,'Set CLIMA_TEST_ARCHIVE to test a real release')
class InstallationTest(unittest.TestCase):
 def test_stage_is_idempotent_and_preserves_configuration_and_database(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'config').mkdir();secret=root/'config/runtime.vars';secret.write_text('TEST_ONLY=preserve\n')
   db=root/'weather.sqlite';c=sqlite3.connect(db);c.execute('create table observations(value real)');c.execute('insert into observations values(24)');c.commit();c.close()
   before={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in [secret,db]}
   a=stage(Path(ARCHIVE),root/'releases');b=stage(Path(ARCHIVE),root/'releases');self.assertEqual(a,b)
   self.assertFalse((root/'current').exists());self.assertFalse((a/'node_modules').exists())
   for p,digest in before.items():self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),digest)
 def test_wrong_candidate_identity_cannot_promote(self):
  class Handler(http.server.BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_GET(self):
    self.send_response(200);self.end_headers();self.wfile.write(b'{"status":"ok","releaseSha256":"wrong"}')
  with tempfile.TemporaryDirectory() as tmp:
   server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    result=subprocess.run([sys.executable,str(TOOLS/'install_release.py'),ARCHIVE,'--root',tmp,'--promote','--candidate-url',f'http://127.0.0.1:{server.server_port}'],capture_output=True,text=True)
    self.assertNotEqual(result.returncode,0);self.assertIn('hash does not match',result.stderr);self.assertFalse((Path(tmp)/'current').exists())
   finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main()
