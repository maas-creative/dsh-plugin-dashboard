// Usage needs the complete durable accounting history; read it through paged storage.
export async function sessionEvents(ctx,session){
 if(!session.seq)return [];
 await ctx.sessions.flush(session);
 const reader=await ctx.sessionPersistence.open(session.id,'read'),events=[];
 try{for(let offset=0;offset<session.seq;){const page=await reader.read(offset,Math.min(1024,session.seq-offset));if(!page.events.length)throw Error('DSHの保存履歴が欠けています');events.push(...page.events);offset+=page.events.length}return events}finally{await reader.close()}
}
