// Convert legacy folder/group headings into outcome projects without deleting source history.
export function splitProjects(s){return s.tx(()=>{
 const migrated=[];
 for(const p of s.all("SELECT * FROM projects WHERE kind='workspace' AND status='active'")){
 const tasks=s.snapshot().tasks.filter(t=>t.projectId===p.id);
 const groups=tasks.filter(t=>!t.parentId&&['関連作業と成果物の確認','子作業の完了と成果物を確認'].includes(t.completionCriteria)&&tasks.some(c=>c.parentId===t.id&&!['done','reported','cancelled'].includes(c.status)));
 for(const root of groups){if(s.get("SELECT 1 FROM tasks,json_each(tasks.dependencies) dep WHERE dep.value=?",root.id))continue;
 const ids=new Set([root.id]);let count;do{count=ids.size;for(const t of tasks)if(ids.has(t.parentId))ids.add(t.id)}while(count!==ids.size);
 const id='outcome:'+root.id;if(s.get('SELECT id FROM projects WHERE id=?',id))continue;
 s.set('project-migration:'+id,{at:Date.now(),project:p,tasks:tasks.filter(t=>ids.has(t.id))});
 s.run("INSERT INTO projects(id,name,cwd,status,created,sourceProjectId,kind,basis) VALUES(?,?,?,'active',?,?,'project',?)",id,root.title,p.cwd,Date.now(),p.id,'旧台帳の案件見出し：'+root.title+'。最終成果物・完了条件は原資料との照合が必要。');
 for(const t of tasks.filter(t=>ids.has(t.id)&&t.id!==root.id)){s.run('UPDATE tasks SET projectId=?,parentId=?,version=version+1 WHERE id=?',id,t.parentId===root.id?null:t.parentId,t.id);s.run('UPDATE manager_items SET projectId=? WHERE entityId=?',id,t.id);}
 s.run("UPDATE tasks SET status='cancelled',nextAction='',completionEvidence=?,version=version+1 WHERE id=?",'プロジェクトへ移行：'+id+'。作業完了ではなく分類見出しの置き換え。',root.id);
 migrated.push(id);
 }
 if(groups.length)s.set('project-split:'+p.id,true);
 }
 return migrated;
});}
