import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
test('Antigravity refresh rejects missing client configuration before any request',()=>{
 const env={...process.env};delete env.ANTIGRAVITY_CLIENT_ID;delete env.ANTIGRAVITY_CLIENT_SECRET;
 const script=`import assert from 'node:assert/strict';import {createGoogleRefreshTransport} from './vendor/antigravity.mjs';let called=0;const refresh=createGoogleRefreshTransport(async()=>{called++;throw Error('network must not run')});await assert.rejects(refresh({refreshToken:'test-refresh'}),/ANTIGRAVITY_CLIENT_ID/);assert.equal(called,0);`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env});
});
test('Antigravity refresh uses explicitly supplied client configuration',()=>{
 const env={...process.env,ANTIGRAVITY_CLIENT_ID:'fixture-client',ANTIGRAVITY_CLIENT_SECRET:'fixture-secret'};
 const script=`import assert from 'node:assert/strict';import {createGoogleRefreshTransport} from './vendor/antigravity.mjs';let called=0;const refresh=createGoogleRefreshTransport(async(_url,init)=>{called++;assert.equal(init.body.get('client_id'),'fixture-client');assert.equal(init.body.get('client_secret'),'fixture-secret');return new Response('{}',{status:401})});await assert.rejects(refresh({refreshToken:'test-refresh'}));assert.equal(called,1);`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:import.meta.dirname,env});
});
