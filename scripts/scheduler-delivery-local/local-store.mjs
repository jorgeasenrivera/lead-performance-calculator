// Local acceptance adapter only. No environment lookup or remote connection path.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const literal = value => `convert_from(decode('${Buffer.from(value).toString('hex')}','hex'),'UTF8')`;
export function localStore({ bin, root }) {
  if (!/^\/tmp\/sage-delivery-[A-Za-z0-9]+$/.test(root)) throw new Error('local-root-required');
  const env = { PATH: '/usr/bin:/bin', LANG: 'C', HOME: root + '/home' };
  async function sql(text) {
    const { stdout } = await run(bin + '/psql', ['-X','-w','-qAt','-v','ON_ERROR_STOP=1',
      '-h',root+'/socket','-U','delivery_fixture','-d','postgres','-c',text], { env, timeout: 15000, maxBuffer: 8000000 });
    return stdout.trim();
  }
  return {
    sql,
    async setup(data) {
      if (await sql('SHOW data_directory') !== root+'/data' || await sql('SHOW listen_addresses') !== '') throw new Error('local-cluster-required');
      await sql('CREATE TABLE delivery_state(id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL, body jsonb NOT NULL)');
      await sql(`INSERT INTO delivery_state VALUES(1,1,${literal(JSON.stringify(data))}::jsonb)`);
    },
    async read() { return JSON.parse(await sql("SELECT json_build_object('revision',revision,'data',body) FROM delivery_state WHERE id=1")); },
    async commit(revision, data, failAudit = false) {
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('bad-revision');
      // Whole-document CAS binds identities, review sources, neighbours, immutable
      // versions, head, audit and receipt to one durable PostgreSQL transaction.
      const output = await sql(`BEGIN; SET LOCAL statement_timeout='5s';
        UPDATE delivery_state SET revision=revision+1,body=${literal(JSON.stringify(data))}::jsonb
        WHERE id=1 AND revision=${revision} RETURNING json_build_object('committed',true,'revision',revision);
        ${failAudit ? 'SELECT 1/0;' : ''} COMMIT;`);
      return output ? JSON.parse(output) : { committed: false };
    },
  };
}
