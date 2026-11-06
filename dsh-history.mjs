// Usage needs the complete durable accounting history; read it through paged storage.
export async function sessionEvents(ctx,session){
 const end=session.seq;if(!end)return [];
 await ctx.sessions.flush(session);
 const reader=await ctx.sessionPersistence.open(session.id,'read'),events=[];
 try{for(let offset=0;offset<end;){const page=await reader.read(offset,Math.min(1024,end-offset));if(!page.events.length)throw Error('DSHの保存履歴が欠けています');events.push(...page.events);offset+=page.events.length}return events}finally{await reader.close()}
}

// The model surface is compacted; the durable event log retains the conversation.
export function conversationEvents(events,visibleUser){
 return events.flatMap(e=>e.type==='user/message'&&visibleUser(e.data)?[e.data]:e.type==='assistant/message'&&e.data?.message?.role==='assistant'?[e.data.message]:[]);
}

// A last-call disclosure, not a session total: missing provider buckets remain unknown.
export function lastCallUsage(events){
 const event=[...events].reverse().find(e=>e.type==='assistant/message'||e.type==='assistant/attempt'||e.type==='compaction/summary'&&(e.data?.llmStreamCall===true||e.data?.usage!==undefined));if(!event)return null;
 const usage=event.type==='assistant/attempt'?event.data?.stream?.findLast(r=>r.type==='chunk'&&r.chunk?.type==='usage')?.chunk?.usage:event.data?.usage;if(!usage)return {available:false};
 const fields=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','totalTokens'];
 const values=Object.fromEntries(fields.map(k=>[k,Number.isSafeInteger(usage[k])&&usage[k]>=0?usage[k]:null]));
 return {available:values.inputTokens!==null&&values.outputTokens!==null,...values};
}

// Keep only conversation visible to the user, never reasoning or tool payloads.
export function visibleSourceMessage(row){
 let message=row.type==='message'?row.message:row.type==='response_item'&&row.payload?.type==='message'?row.payload:null;
 if(row.type==='user/message'){if(row.data?.source?.kind!=='user')return null;message={...row.data,role:'user'}}
 if(row.type==='assistant/message')message={...row.data?.message,role:'assistant'};
 if(!message||!['user','assistant'].includes(message.role)||row.channel==='analysis'||message.channel==='analysis'||message.phase==='analysis')return null;
 const content=typeof message.content==='string'?message.content:(message.content||[]).filter(c=>['text','input_text','output_text'].includes(c.type)).map(c=>c.text).join('\n');
 return {role:message.role,content,timestamp:message.timestamp,id:message.id};
}
