import os
exec(open(os.path.join(os.path.dirname(__file__),'derived-test.py')).read().split('# Both publishers may create')[0])
sql("truncate app_data; update private_store set rev=1,value='{\"count\":4}' where id='demo';")
sql("set role client; select publish_data('demo');")
# Two independent fields use the same snapshot and must merge.
p=begin_async("begin; set role client; select patch_setting('demo','size',null,'1'); select pg_sleep(1); commit;")
q=sql("set role service_role; select patch_setting('demo','style',null,'\"bars\"');")
assert finish(p).splitlines()[0]=='t' and q.stdout.strip()=='t'
assert read()['settings']=={'size':1,'style':'bars'}
print('PASS concurrent independent setting changes merge')
# A stale size edit cannot erase style, or overwrite a newer same-field edit.
assert sql("set role client; select patch_setting('demo','size','1','2');").stdout.strip()=='t'
assert sql("set role service_role; select patch_setting('demo','size','1','9');").stdout.strip()=='f'
assert read()['settings']=={'size':2,'style':'bars'}
print('PASS stale same-field retry refused; unrelated setting preserved')
# Legacy whole-object RPC must be inaccessible, including to service-role writers.
for role in ('client','service_role'):
 p=sql(f"set role {role}; select save_settings('demo',3,'{{}}','{{}}');",False)
 assert p.returncode and 'permission denied' in p.stderr
print('PASS whole-settings RPC inaccessible to both simulated writer roles')
