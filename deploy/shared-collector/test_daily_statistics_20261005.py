import pathlib,sqlite3,json,sys
sys.path.insert(0,'/root/CLIMA/Clima/scripts');from history_statistics import build_statistics
folder=pathlib.Path('/root/CLIMA/Clima/backups/coverage-repair-20261005T180900Z');c=sqlite3.connect(folder/'recovery-test.sqlite');before=c.execute('select count(*) from ecowitt_history_points').fetchone()[0];build_statistics(c)
a=c.execute("select count(*) from ecowitt_history_points where value!='-' and value!=''").fetchone()[0];b=c.execute('select sum(samples) from weather_daily_statistics').fetchone()[0];assert a==b
for metric in ['outdoor/temperature','outdoor/temperature_high','wind/wind_gust','pressure/relative','pressure/absolute','rainfall_piezo/daily']:
 raw=c.execute("select min(cast(value as real)),max(cast(value as real)),count(*) from ecowitt_history_points where metric_path=? and value!='-' and value!=''",(metric,)).fetchone();daily=c.execute('select min(minimum),max(maximum),sum(samples) from weather_daily_statistics where metric_path=?',(metric,)).fetchone();assert raw==daily
assert c.execute('select count(*) from ecowitt_history_points').fetchone()[0]==before
report={'source_points_unchanged':True,'valid_points':a,'summary_samples':b,'tested_variables':6};(folder/'statistics-test.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
