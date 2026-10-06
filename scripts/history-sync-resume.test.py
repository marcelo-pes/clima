import importlib.util,pathlib,tempfile,sqlite3,types,sys,json,unittest,fcntl
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('sync',pathlib.Path(__file__).with_name('ecowitt-history-sync.py'));sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)
class ResumeTest(unittest.TestCase):
 def test_failure_and_process_interruption_resume_after_recent_window_expires(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'backups').mkdir();db=root/'db.sqlite';c=sqlite3.connect(db);sync.m.schema(c)
   mac='test';device=sync.m.hashlib.sha256(mac.encode()).hexdigest();c.execute('insert into ecowitt_history_import_chunks values(?,?,?,?,?,?,?)',(device,'5min',0,100,'complete',0,'{}'));c.commit();c.close()
   calls=[];stats=[];now=[200];fail=[True]
   def request(path,params):
    calls.append((params['start_date'],params['end_date']))
    if fail[0]:raise RuntimeError('NETWORK_ERROR')
    return {'data':{'outdoor':{'temperature':{'unit':'C','list':{'150':'20'}}}}}
   with patch.object(sync,'ROOT',root),patch.object(sync.m,'selected_db',return_value=str(db)),patch.object(sync.m,'CYCLES',{'5min':86400}),patch.object(sync.m,'read_vars',return_value={'ECOWITT_APPLICATION_KEY':'test','ECOWITT_API_KEY':'test','ECOWITT_MAC':mac}),patch.object(sync.m,'request_api',side_effect=request),patch.object(sync.time,'time',side_effect=lambda:now[0]),patch.object(sync.time,'sleep'),patch.dict(sys.modules,{'history_statistics':types.SimpleNamespace(build_statistics=lambda c,s:stats.append(s))}),patch.dict(sync.os.environ,{},clear=True):
    self.assertEqual(sync.main(),1)
    c=sqlite3.connect(db);self.assertGreater(len(list(sync.pending_windows(c,device))),0);c.close()
    fail[0]=False;now[0]=3*86400+200;calls.clear()
    self.assertEqual(sync.main(),0);self.assertIn(sync.m.iso(0).replace('T',' ')[:10],calls[0][0])
    c=sqlite3.connect(db);self.assertEqual(list(sync.pending_windows(c,device)),[])
    # Simulate kill after persisting intent, before/after network, then retry it.
    sync.remember_window(c,device,'5min',0,100);c.close();self.assertEqual(sync.main(),0)
    c=sqlite3.connect(db);self.assertEqual(list(sync.pending_windows(c,device)),[]);self.assertEqual(c.execute('pragma integrity_check').fetchone()[0],'ok');c.close()
    self.assertTrue(list((root/'backups').glob('*.sqlite.gz')))
 def test_gap_repair_never_changes_valid_records_and_is_idempotent(self):
  import history_gap_repair as repair
  c=sqlite3.connect(':memory:');sync.m.schema(c)
  c.execute('insert into ecowitt_history_import_chunks values(?,?,?,?,?,?,?)',('station','5min',100,700,'partial',1,'{"outdoor":{"temperature":{"unit":"C","list":{"100":"20","9999":"77"}}}}'))
  sync.merge_point(c,'station','1day','outdoor/temperature',100,'20','C');sync.merge_point(c,'station','5min','outdoor/temperature',400,'-','C');c.commit()
  data={'outdoor':{'temperature':{'unit':'C','list':{'100':'99','400':'21','700':'22'}}}}
  r=repair.apply_response(c,sync.m,'station','5min',100,700,data);self.assertEqual(r['added_valid'],1);self.assertEqual(r['filled_missing'],1)
  self.assertEqual(c.execute('select value from ecowitt_history_points where observed_at=100').fetchone()[0],'20')
  payload=json.loads(c.execute('select payload from ecowitt_history_import_chunks').fetchone()[0]);self.assertEqual(payload['outdoor']['temperature']['list']['100'],'20');self.assertEqual(payload['outdoor']['temperature']['list']['9999'],'77')
  r=repair.apply_response(c,sync.m,'station','5min',100,700,data);self.assertEqual(r['added_valid'],0);self.assertEqual(r['filled_missing'],0);self.assertEqual(c.execute('select count(*) from ecowitt_history_points').fetchone()[0],3)
if __name__=='__main__':unittest.main()
