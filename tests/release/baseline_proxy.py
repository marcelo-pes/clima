"""Emulate only the static aliases of the existing production Nginx for reference."""
import mimetypes,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote

def start(root):
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_GET(self):
   path=unquote(urlsplit(self.path).path)
   if path.startswith('/_next/static/'):
    file=(root/'dist/client'/path.lstrip('/')).resolve()
    if file.is_relative_to((root/'dist/client').resolve()) and file.is_file():
     body=file.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(file.name)[0] or 'application/octet-stream');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
   try:
    with urllib.request.urlopen('http://127.0.0.1:18988'+self.path,timeout=30) as r:body=r.read();status=r.status;headers=r.headers
   except urllib.error.HTTPError as r:body=r.read();status=r.code;headers=r.headers
   self.send_response(status)
   for k,v in headers.items():
    if k.lower() not in ['transfer-encoding','connection','content-length','server','date']:self.send_header(k,v)
   self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 server=ThreadingHTTPServer(('127.0.0.1',18987),Handler)
 import threading
 threading.Thread(target=server.serve_forever,daemon=True).start()
 return server
