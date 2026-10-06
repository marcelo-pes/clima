import unittest,sqlite3,importlib.util,pathlib
spec=importlib.util.spec_from_file_location('stats',pathlib.Path(__file__).with_name('history_statistics.py'));stats=importlib.util.module_from_spec(spec);spec.loader.exec_module(stats)
class StatisticsTest(unittest.TestCase):
 def test_valid_constant_missing_and_ties(self):
  c=sqlite3.connect(':memory:');c.execute('create table ecowitt_history_points(device_key text,metric_path text,observed_at integer,value text,unit text,cycle_type text,priority integer)')
  for t,value in [(10800,'20'),(11100,'-'),(11400,'0'),(11700,'30'),(12000,'30'),(12300,'NaN')]:c.execute('insert into ecowitt_history_points values(?,?,?,?,?,?,?)',('station','outdoor/temperature',t,value,'C','5min',4))
  for t in (10800,11100):c.execute('insert into ecowitt_history_points values(?,?,?,?,?,?,?)',('station','battery/test',t,'2.5','V','5min',4))
  stats.build_statistics(c)
  row=c.execute("select samples,minimum,maximum,minimum_at,maximum_at from weather_daily_statistics where metric_path='outdoor/temperature'").fetchone();self.assertEqual(row,(4,0,30,11400,11700))
  self.assertEqual(c.execute("select minimum,maximum,minimum_at,maximum_at from weather_daily_statistics where metric_path='battery/test'").fetchone(),(2.5,2.5,10800,10800))
  stats.build_statistics(c,10800);self.assertEqual(c.execute('select count(*) from weather_daily_statistics').fetchone()[0],2)
if __name__=='__main__':unittest.main()
