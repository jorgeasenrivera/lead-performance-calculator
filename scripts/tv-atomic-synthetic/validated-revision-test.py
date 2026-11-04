import os
exec(open(os.path.join(os.path.dirname(__file__),'derived-test.py')).read().split('# Both publishers may create')[0])
# The record is inserted by the synthetic fixture owner, standing in for an
# independent verifier. This does not prove any real report or verifier exists.
sql("truncate app_data, tv_fixture.verified_source; update private_store set rev=20,value='{\"roster\":[]}' where id='demo'; insert into tv_fixture.verified_source select 'demo',20,'2026-07-08T12:00:00Z',value,4 from private_store where id='demo';")
assert sql("select tv_fixture.publish_validated('demo',20,'2026-07');").stdout.strip()=='t'
a=read();assert a['data']['verifiedSourceRev']==20 and a['data']['verifiedCount']==4 and a['data']['verifiedSourceAsOf'].startswith('2026-07-08T12:00:00')
print('PASS synthetic attestation binds count and source as-of to locked source revision')
for role in ('client','service_role'):
 p=sql(f"set role {role}; insert into tv_fixture.verified_source values ('demo',21,now(),'{{}}',9);",False);assert p.returncode and 'permission denied' in p.stderr
 p=sql(f"set role {role}; select tv_fixture.publish_validated('demo',20,'2026-07');",False);assert p.returncode and 'permission denied' in p.stderr
 print('PASS synthetic untrusted role cannot attest or publish validated revision:',role)
sql("update private_store set rev=21 where id='demo';")
before=read();assert sql("select tv_fixture.publish_validated('demo',20,'2026-07');").stdout.strip()=='f';assert read()==before
assert sql("select tv_fixture.publish_validated('demo',21,'2026-07');").stdout.strip()=='f';assert read()==before
print('PASS stale or missing attestation cannot replace the board')
# A verified correction can move the total down; the new private revision and
# separate immutable attestation, not repeated reads, permit the change.
sql("insert into tv_fixture.verified_source select 'demo',21,'2026-07-08T13:00:00Z',value,0 from private_store where id='demo';")
assert sql("select tv_fixture.publish_validated('demo',21,'2026-07');").stdout.strip()=='t'
assert read()['data']['verifiedCount']==0 and read()['data']['verifiedSourceRev']==21
p=sql("update tv_fixture.verified_source set whole_count=9 where store_id='demo' and source_rev=21;",False)
assert p.returncode and 'attestations are immutable' in p.stderr
print('PASS separately attested new revision accepts a legitimate downward correction')
before=read()
p=begin_async("begin; update private_store set rev=23 where id='demo'; select pg_sleep(1); commit;")
q=sql("select tv_fixture.publish_validated('demo',21,'2026-07');")
finish(p);assert q.stdout.strip()=='f' and read()==before
print('PASS concurrent newer private revision prevents stale attested publication')
sql("begin; update private_store set rev=22 where id='demo'; insert into tv_fixture.verified_source select 'demo',22,'2026-07-09T12:00:00Z',value,2 from private_store where id='demo'; select tv_fixture.publish_validated('demo',22,'2026-07'); rollback;")
assert read()==before
print('PASS attestation and publication rollback together')

# A reused revision cannot replay proof for different private content.
sql("update private_store set rev=21,value='{\"roster\":[{\"id\":\"other\"}]}' where id='demo';")
assert sql("select tv_fixture.publish_validated('demo',21,'2026-07');").stdout.strip()=='f' and read()==before
print('PASS revision reuse with different source contents rejects old attestation')
