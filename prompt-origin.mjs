// The stdio bridge is host-owned. Model tool inputs never select human authority.
export function promptSource({planner,origin},sessionId){
 if(origin!==undefined&&!['human','coordinator','scheduler','worker'].includes(origin))throw Error('Unknown prompt origin');
 if(origin==='human'||origin===undefined&&!planner)return {kind:'user'};
 return {kind:'agent-message',form:'relay',senderSessionId:sessionId};
}
export function lowModel(selected={}){
 if(selected.reasoningEffort!==undefined&&(typeof selected.reasoningEffort!=='string'||!selected.reasoningEffort.trim()||selected.reasoningEffort.length>64))throw Error('Invalid reasoning effort');
 if(selected.provider!==undefined&&(typeof selected.provider!=='string'||!selected.provider.trim()))throw Error('Invalid provider');
 if(selected.model!==undefined&&(typeof selected.model!=='string'||!selected.model.trim()))throw Error('Invalid model');
 return {provider:'openai-codex',model:'gpt-6.1-sol',...selected,reasoningEffort:selected.reasoningEffort??'low'};
}
