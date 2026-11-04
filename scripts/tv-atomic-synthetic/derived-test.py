import subprocess,time,os,json
base=['docker','--host=unix:///var/run/docker.sock','exec','-i',os.environ['TV_TEST_CONTAINER'],'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']
env=os.environ.copy()
for x in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'): env.pop(x,None)
def sql(s, check=True):
 p=subprocess.run(base,input=s,text=True,capture_output=True,env=env)
 if check and p.returncode: raise Exception(p.stderr)
 return p
def read(): return json.loads(sql("select value from app_data where key='lpc:board:demo:v1';").stdout.strip())
def begin_async(statement):
 p=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
 p.stdin.write(statement);p.stdin.close();time.sleep(.25);return p
def finish(p):
 out=p.stdout.read();err=p.stderr.read(); assert p.wait()==0,err;return out
# Both publishers may create: the unique key serializes and preserves a single complete row.
p=begin_async("begin; set role client; select publish_data('demo'); select pg_sleep(1); commit;")
q=sql("set role service_role; select publish_data('demo');")
assert finish(p).splitlines()[0]=='t' and q.stdout.strip()=='t'
a=read();assert a=={'sourceRev':1,'data':{'count':4},'settingsRev':0,'settings':{}} and 'private' not in str(a)
print('PASS simultaneous first creation and whitelist projection')
# A concurrent private-store transaction commits before publication can read its locked row.
p=begin_async("begin; update private_store set rev=2,value='{\"count\":5,\"private\":\"secret\"}' where id='demo'; select pg_sleep(1); commit;")
q=sql("set role client; select publish_data('demo');")
finish(p); assert q.stdout.strip()=='t';a=read(); assert a['sourceRev']==2 and a['data']=={'count':5}
print('PASS publisher waits for current private-store revision')
# The stale request contains no data payload: after a new private write it derives the latest value.
sql("update private_store set rev=3,value='{\"count\":6}' where id='demo';")
assert sql("set role service_role; select publish_data('demo');").stdout.strip()=='t'
assert read()['data']=={'count':6}
print('PASS old publisher request cannot replay old data payload')
# Two independently connected settings writers use the same true baseline.
p=begin_async("begin; set role client; select save_settings('demo',0,'{}','{\"size\":1}'); select pg_sleep(1); commit;")
q=sql("set role service_role; select save_settings('demo',0,'{}','{\"size\":2}');")
assert finish(p).splitlines()[0]=='t' and q.stdout.strip()=='f'
assert read()['settings']=={'size':1} and read()['settingsRev']==1
print('PASS concurrent settings writers serialize with conflict')
# A stale payload with newly read revision still carries its old baseline.
assert sql("set role client; select save_settings('demo',1,'{}','{\"size\":2}');").stdout.strip()=='f'
assert read()['settings']=={'size':1}
print('PASS old settings baseline rejected even with newly read revision')
# A genuine rebase uses current baseline and retains the other writer's value.
assert sql("set role client; select save_settings('demo',1,'{\"size\":1}','{\"size\":1,\"style\":\"bars\"}');").stdout.strip()=='t'
assert read()['settings']=={'size':1,'style':'bars'}
print('PASS explicitly rebased settings retry')
# A new data publish must leave settings and its revision intact.
sql("update private_store set rev=4,value='{\"count\":7}' where id='demo';")
sql("set role service_role; select publish_data('demo');")
a=read(); assert a['data']=={'count':7} and a['settings']=={'size':1,'style':'bars'} and a['settingsRev']==2
print('PASS independent data publication preserves settings')
for role in ('client','service_role'):
 for command in ("update app_data set value='{}' where key='lpc:board:demo:v1'", "insert into app_data(key,value) values('lpc:board:other:v1','{}')", "update app_data set key='moved' where key='lpc:board:demo:v1'", "delete from app_data where key='lpc:board:demo:v1'"):
  p=sql(f'set role {role}; {command};',False); assert p.returncode and 'direct board writes disabled' in p.stderr,(role,command,p.stderr)
 print('PASS legacy insert/update/rename/delete rejected:',role)
before=read()
sql("begin; set role client; select save_settings('demo',2,'{\"size\":1,\"style\":\"bars\"}','{\"size\":9}'); rollback;")
assert read()==before
sql("begin; update private_store set rev=5,value='{\"count\":99}' where id='demo'; set role client; select publish_data('demo'); rollback;")
assert read()==before
print('PASS rolled-back settings and data publications leave board unchanged')
# Data and settings overlap without one replacing the other.
sql("update private_store set rev=5,value='{\"count\":8}' where id='demo';")
p=begin_async("begin; set role client; select save_settings('demo',2,'{\"size\":1,\"style\":\"bars\"}','{\"size\":2,\"style\":\"bars\"}'); select pg_sleep(1); commit;")
q=sql("set role service_role; select publish_data('demo');")
assert finish(p).splitlines()[0]=='t' and q.stdout.strip()=='t'
a=read();assert a['data']=={'count':8} and a['settings']=={'size':2,'style':'bars'} and a['settingsRev']==3
print('PASS concurrent data and settings updates preserve both')
# CAS cannot know whether a client genuinely rebased its intent when it replaces both baseline and version.
assert sql("set role client; select save_settings('demo',3,'{\"size\":2,\"style\":\"bars\"}','{\"size\":9}');").stdout.strip()=='t'
assert read()['settings']=={'size':9}
print('EXPECTED UNSAFE CONTROL: whole-settings replay erases changes after refreshing baseline and version')
