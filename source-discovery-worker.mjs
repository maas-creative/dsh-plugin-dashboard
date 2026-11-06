import {openLedgerReader} from './dashboard-read.mjs';
import {discoverSources} from './source-discovery.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
let store;try{const {path,args,scope}=JSON.parse(input);store=openLedgerReader(path);const result=await discoverSources(store,args,scope);process.stdout.write(JSON.stringify({result}));}catch(error){process.stdout.write(JSON.stringify({error:String(error?.message||error)}));process.exitCode=1}finally{store?.db.close()}
