import math,collections
STEPS={'5min':300,'30min':1800,'4hour':14400,'1day':86400}
REQUIRED=['outdoor/temperature','outdoor/humidity','indoor/temperature','indoor/humidity','pressure/relative','wind/wind_speed','wind/wind_gust','wind/wind_direction','solar_and_uvi/solar','solar_and_uvi/uvi','rainfall_piezo/daily']
def valid(value):
 try:return value is not None and value!='' and math.isfinite(float(value))
 except:return False

def coverage(points,cycle,start,end):
 step=STEPS[cycle];series=collections.defaultdict(set)
 for metric,t,value,unit in points:
  if start<=t<=end and valid(value):series[metric].add(t)
 gaps={}
 for metric in REQUIRED:
  times=series[metric]
  if not times:gaps[metric]={'absent':True};continue
  phase=collections.Counter(t%step for t in times).most_common(1)[0][0];first=math.ceil((start-phase)/step)*step+phase;last=math.floor((end-phase)/step)*step+phase
  expected=max(0,(last-first)//step+1);present=sum(first<=t<=last and t%step==phase for t in times)
  if present<expected:gaps[metric]={'expected':expected,'valid':present,'missing':expected-present}
 return {'complete':not gaps,'gaps':gaps}
