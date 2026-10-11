import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
const db=new DatabaseSync(join(homedir(),'Library/Application Support/Project Dashboard/dashboard.sqlite'));
const key=randomBytes(32).toString('hex');db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('bootstrap',JSON.stringify({hash:createHash('sha256').update(key).digest('hex'),expires:Date.now()+120000}));db.close();console.log('http://127.0.0.1:4318/#key='+key);
