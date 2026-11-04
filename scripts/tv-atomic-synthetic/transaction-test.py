import os
exec(open(os.path.join(os.path.dirname(__file__),'derived-test.py')).read().split('# Both publishers may create')[0])
# Synthetic-only, owner-driven invocation: no role authorization is implied.
sql("truncate app_data; update private_store set rev=10,value='{\"roster\":[{\"id\":\"a\",\"name\":\"Alex Jones\",\"roleId\":\"sales\"}],\"months\":{\"2026-07\":{\"stats\":{\"alex jones\":{\"internetUnits\":0.5,\"prevPct\":{\"internet\":0.2,\"secret\":\"hidden\"}}}}}}' where id='demo';")
assert sql("select tv_fixture.publish_projected('demo','2026-07','[{\"id\":\"sales\"}]');").stdout.strip()=='t'
a=read();assert a['sourceRev']==10 and a['data']['months']['2026-07']['stats']['alex jones']['internetUnits']==0.5 and 'hidden' not in str(a)
print('PASS projection published from locked private source')
# A private write in flight is observed after commit; data supplied by an old caller is never accepted.
p=begin_async("begin; update private_store set rev=11,value='{\"roster\":[],\"months\":{}}' where id='demo'; select pg_sleep(1); commit;")
q=sql("select tv_fixture.publish_projected('demo','2026-07','[{\"id\":\"sales\"}]');")
finish(p);assert q.stdout.strip()=='t' and read()['sourceRev']==11 and read()['data']['roster']==[]
print('PASS projection waits for concurrent private-source commit')
# Settings and projection touch separate portions of the same locked row.
p=begin_async("begin; set role client; select patch_setting('demo','size',null,'2'); select pg_sleep(1); commit;")
q=sql("select tv_fixture.publish_projected('demo','2026-07','[{\"id\":\"sales\"}]');")
assert finish(p).splitlines()[0]=='t' and q.stdout.strip()=='t' and read()['settings']=={'size':2}
print('PASS concurrent projected publication preserves settings')
for role in ('client','service_role'):
 p=sql(f"set role {role}; select tv_fixture.publish_projected('demo','2026-07','[]');",False)
 assert p.returncode and 'permission denied' in p.stderr
print('PASS projected publisher has no simulated client execution grant')
before=read()
sql("begin; update private_store set rev=12,value='{\"roster\":[]}' where id='demo'; select tv_fixture.publish_projected('demo','2026-07','[{\"id\":\"sales\"}]'); rollback;")
assert read()==before
print('PASS projected publication rollback leaves board unchanged')
# Configuration is read under lock, not supplied by the requesting client.
sql("update private_store set rev=13,value='{\"roster\":[{\"id\":\"a\",\"name\":\"Alex Jones\",\"roleId\":\"sales\"}]}' where id='demo';")
p=begin_async("begin; update private_config set value='{\"name\":\"New Demo\",\"roles\":[]}' where id='demo'; select pg_sleep(1); commit;")
q=sql("select tv_fixture.publish_projected('demo','2026-07','[{\"id\":\"sales\"}]');")
finish(p); assert q.stdout.strip()=='t' and read()['data']['storeName']=='New Demo' and read()['data']['roster']==[]
print('PASS projection waits for locked configuration and ignores caller role list')
