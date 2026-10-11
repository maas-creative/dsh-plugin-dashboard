import {appendFile} from 'node:fs/promises';
// Match the host analyzer contract: return the plan and persist the assistant history.
export const createFixtureAnalyzer=notes=>async(_docs,ledger,_cwd,_signal,_system,session)=>{
 const command=ledger.notes.at(-1).text;notes.push(command);
 const result={summary:'入力を受信しました: '+command,picks:[]};
 await appendFile(session+'.dsh-history.jsonl',JSON.stringify({type:'message',id:'fixture-response-'+notes.length,timestamp:new Date().toISOString(),message:{role:'assistant',content:[{type:'text',text:JSON.stringify(result)}]}})+'\n',{mode:0o600});
 return result;
};
