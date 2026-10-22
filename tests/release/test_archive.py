import unittest,tarfile,io,tempfile,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'deploy/tools'))
from release import validate,safe_members
class ArchiveTest(unittest.TestCase):
 def test_traversal_and_links_and_duplicates_are_rejected(self):
  for kind in ['traversal','symlink','duplicate']:
   with tempfile.TemporaryDirectory() as tmp:
    archive=Path(tmp)/'bad.tar.gz'
    with tarfile.open(archive,'w:gz') as t:
     item=tarfile.TarInfo('../secret' if kind=='traversal' else 'dist/file');item.size=1
     if kind=='symlink':item.type=tarfile.SYMTYPE;item.linkname='/etc/passwd';item.size=0
     t.addfile(item,io.BytesIO(b'x') if item.size else None)
     if kind=='duplicate':t.addfile(item,io.BytesIO(b'x'))
    with tarfile.open(archive) as t,self.assertRaises(ValueError):list(safe_members(t))
 def test_legacy_package_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   archive=Path(tmp)/'legacy.tar.gz'
   with tarfile.open(archive,'w:gz') as t:
    body=json.dumps({'project':'Clima2'}).encode();item=tarfile.TarInfo('release-manifest.json');item.size=len(body);t.addfile(item,io.BytesIO(body))
   with self.assertRaises(ValueError):validate(archive)
if __name__=='__main__':unittest.main()
