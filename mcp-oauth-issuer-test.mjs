import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {oauthProvider} from './mcp-oauth.mjs';
test('OAuth credentials remain bound across issuer changes and cold reads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scrum-issuer-'));
 try {
  const a='https://auth.example/a',b='https://auth.example/b';
  const p=await oauthProvider(dir,'bound');
  await p.saveClientInformation({client_id:'client',client_secret:'secret'},{issuer:a});
  await p.saveTokens({access_token:'token',token_type:'Bearer'},{issuer:a});
  const cold=await oauthProvider(dir,'bound');
  assert.equal(cold.tokens({issuer:b}),undefined);
  assert.equal(cold.clientInformation({issuer:b}),undefined);
  assert.equal(cold.tokens().issuer,a);
  await assert.rejects(cold.saveTokens({access_token:'wrong',issuer:a},{issuer:b}),/mismatch/);
  await assert.rejects(oauthProvider(dir,'configured',{clientId:'id',clientSecret:'secret'}),/explicit issuer/);
  const configured=await oauthProvider(dir,'configured',{clientId:'id',clientSecret:'secret',issuer:a});
  assert.throws(()=>configured.clientInformation({issuer:b}),/issuer mismatch/);
  assert.equal(configured.clientInformation({issuer:a}).issuer,a);
  await writeFile(join(dir,'legacy.json'),JSON.stringify({client:{client_id:'unknown',client_secret:'unknown'},tokens:{access_token:'unknown'},tokensByIssuer:{[a]:{access_token:'known'}}}),{mode:0o600});
  const legacy=await oauthProvider(dir,'legacy');
  assert.equal(legacy.clientInformation({issuer:b}),undefined);
  assert.equal(legacy.tokens(),undefined);
  assert.equal(legacy.tokens({issuer:a}).issuer,a);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real SDK discovery cannot send a configured secret to a different HTTP authorization server',async()=>{
 const {createServer}=await import('node:http');const {auth}=await import('@modelcontextprotocol/client');let requestsWithSecret=0,base;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk; if(body.includes('unique-client-secret')||String(req.headers.authorization||'').includes('unique-client-secret'))requestsWithSecret++;res.setHeader('content-type','application/json'); if(req.url.includes('oauth-protected-resource'))return res.end(JSON.stringify({resource:base+'/mcp',authorization_servers:[base]}));if(req.url.includes('oauth-authorization-server'))return res.end(JSON.stringify({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256']}));res.statusCode=401;res.end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;const dir=await mkdtemp(join(tmpdir(),'scrum-sdk-issuer-'));
 try{const provider=await oauthProvider(dir,'configured',{issuer:'https://trusted.example',clientId:'configured',clientSecret:'unique-client-secret',redirectUrl:'http://127.0.0.1:12345/callback'});await assert.rejects(auth(provider,{serverUrl:base+'/mcp'}),/issuer mismatch/);assert.equal(requestsWithSecret,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
