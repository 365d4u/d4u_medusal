"""Run a local maintenance script in the test backend runtime; no secret output."""
import runpy,sys,uuid
from pathlib import Path
d=runpy.run_path(str(Path(__file__).with_name('deploy-test.py')))
c=d['connect']();s=c.open_sftp();base='/var/www/d4u_medusa/apps/backend/.medusa/server'
name='maintenance-'+uuid.uuid4().hex+'.cjs'
try:
 s.put(sys.argv[1],base+'/'+name)
 print(d['run'](c,'cd '+base+' && node --env-file=../../.env '+name).strip())
finally:
 try:s.remove(base+'/'+name)
 except FileNotFoundError:pass
 s.close();c.close()
