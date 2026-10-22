import importlib.util,time,datetime as dt,json
spec=importlib.util.spec_from_file_location('m','/root/CLIMA/Clima/scripts/ecowitt_history_import.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
v=m.read_vars();auth={'application_key':v['ECOWITT_APPLICATION_KEY'],'api_key':v['ECOWITT_API_KEY']};mac=v.get('ECOWITT_MAC')
if not mac:
    found=[];m.find_devices(m.request_api('/device/list',auth).get('data'),found);device=next(d for d in found if str(d.get('id',d.get('device_id')))==str(v.get('ECOWITT_DEVICE_ID','251816')));mac=device.get('mac',device.get('mac_address'))
end=int(time.time())-600;start=end-3600
for label,timezone in [('UTC',m.UTC),('BRAZIL',m.BAURU)]:
    data=m.request_api('/device/history',{**auth,'mac':mac,'start_date':dt.datetime.fromtimestamp(start,timezone).strftime('%Y-%m-%d %H:%M:%S'),'end_date':dt.datetime.fromtimestamp(end,timezone).strftime('%Y-%m-%d %H:%M:%S'),'cycle_type':'5min','call_back':'outdoor.temperature',**m.UNITS}).get('data') or {}
    points=list(m.iter_series(data));stamps=[p[1] for p in points]
    print(json.dumps({'date_format':label,'requested_start':m.iso(start),'requested_end':m.iso(end),'points':len(points),'inside_requested_window':sum(start<=t<=end for t in stamps),'first':m.iso(min(stamps)) if stamps else None,'last':m.iso(max(stamps)) if stamps else None}),flush=True);time.sleep(4)
