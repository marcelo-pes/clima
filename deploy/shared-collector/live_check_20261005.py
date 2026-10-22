import urllib.request,json,time,datetime
for view in ('summary','current'):
    start=time.monotonic()
    with urllib.request.urlopen('http://127.0.0.1:8787/api/weather?view='+view+'&range=24h',timeout=45) as response:data=json.load(response)
    print(json.dumps({'view':view,'http':200,'seconds':round(time.monotonic()-start,3),'reported_update':datetime.datetime.fromtimestamp(data['updatedAt']/1000,datetime.timezone(datetime.timedelta(hours=-3))).isoformat(),'history_source':data['historySource'],'history_incomplete':data['historyIncomplete']}),flush=True)
    time.sleep(4)
for period in ('7d','30d','1y'):
    results={}
    for source in ('database','api'):
        start=time.monotonic()
        try:
            with urllib.request.urlopen('http://127.0.0.1:8787/api/weather?view=history&range='+period+'&date=2026-09-24&source='+source,timeout=60) as response:results[source]=json.load(response)
            print(json.dumps({'period':period,'source':source,'http':200,'seconds':round(time.monotonic()-start,3),'incomplete':results[source]['historyIncomplete']}),flush=True)
        except Exception as error:print(json.dumps({'period':period,'source':source,'error':type(error).__name__}),flush=True)
        time.sleep(4)
    if len(results)==2:
        shared=differences=0
        for key,series in results['database']['history'].items():
            a={p['time']:p['value'] for p in series['points']};b={p['time']:p['value'] for p in results['api']['history'][key]['points']}
            for timestamp in a.keys()&b.keys():
                shared+=1
                if a[timestamp]!=b[timestamp]:differences+=1
        print(json.dumps({'period':period,'shared_samples':shared,'different_values':differences}),flush=True)
