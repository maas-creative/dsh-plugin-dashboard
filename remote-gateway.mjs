import http from 'node:http';
import https from 'node:https';

// Only the loopback tunnel connector can reach this listener. The upstream
// remains the phone TLS listener, so local admin credentials never work here.
export async function createRemoteGateway({port=4320,upstreamPort=4319,ca,origin=()=>null,requireForwardedProto=true}){
 const upstreamHost='127.0.0.1:'+upstreamPort;
 const server=http.createServer((req,res)=>{
  const current=origin();
  if(!current||req.headers.host!==new URL(current).host||(requireForwardedProto&&req.headers['x-forwarded-proto']!=='https')){
   res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'外部接続先が一致しません'}));return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==current){
   res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'別サイトからの操作はできません'}));return;
  }
  const headers={...req.headers,host:upstreamHost};
  for(const name of ['connection','forwarded','x-forwarded-host','x-forwarded-proto','x-forwarded-for','cf-connecting-ip'])delete headers[name];
  if(headers.origin)headers.origin='https://'+upstreamHost;
  const proxy=https.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,ca,headers},response=>{
   res.writeHead(response.statusCode,{...response.headers,'cache-control':'no-store'});response.pipe(res);
  });
  proxy.setTimeout(30000,()=>proxy.destroy(new Error('Upstream timeout')));
  proxy.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'Macのダッシュボードに接続できません'}))}else res.destroy()});
  req.on('aborted',()=>proxy.destroy());res.on('close',()=>{if(!res.writableEnded)proxy.destroy()});req.pipe(proxy);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 return server;
}
