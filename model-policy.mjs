const categories=Object.fromEntries(['architect','deep-low','deep-high','general','quick','deep','ultrabrain','visual-engineering','artistry','writing','unspecified-low','unspecified-high'].map(name=>[name,{}]));
const roles=Object.fromEntries(['designer','writer','planner','executor','researcher','reviewer','explore','librarian','plan-consultant','plan-reviewer','architect','sisyphus','oracle','metis','momus','sisyphus-junior'].map(name=>[name,{}]));
export const defaultModel={provider:'openai-codex',model:'gpt-6.1-sol',reasoningEffort:'low'};
// Task overrides take priority over role overrides and the shared default.
export function selectModel(settings={},role='executor',taskId,category){return settings.tasks?.[taskId]||settings.roles?.[role]||settings.categories?.[category]||settings.default||defaultModel;}
export function fallbackModels(settings={},role,taskId,category){return settings.fallbacks?.tasks?.[taskId]||settings.fallbacks?.roles?.[role]||settings.fallbacks?.categories?.[category]||settings.fallbacks?.default||[];}
export function mayRetryModel(operation){return !operation.toolEvidence?.length&&/429|503|rate.?limit|overloaded|model.*(unavailable|not found)|provider.*unavailable/i.test(operation.error||'');}
export function saveModel(store,body,catalog){
 const role=body.role||'',category=body.category||'',target=body.taskId||'';
 if(role&&!roles[role])throw Error('担当役割がありません');
 if(category&&!categories[category]&&!store.setting('scrumCategories',{})[category])throw Error('担当カテゴリがありません');
 if([role,category,target].filter(Boolean).length>1)throw Error('割り当て先は一つだけ指定してください');
 if(target&&!store.get('SELECT id FROM tasks WHERE id=?',target))throw Error('タスクがありません');
 const settings=store.setting('workerModels',{default:defaultModel,tasks:{}}),group=target?'tasks':role?'roles':category?'categories':null,key=target||role||category;
 if(group)settings[group]||={};
 if(group&&body.reset===true){delete settings[group][key];if(settings.fallbacks?.[group])delete settings.fallbacks[group][key];store.set('workerModels',settings);return settings;}
 const valid=m=>m&&m.reasoningEffort==='low'&&catalog.some(p=>p.provider===m.provider&&p.models.some(x=>x.id===m.model));
 if(!valid(body.model))throw Error('利用可能なモデルとlowの推論強度を選択してください');
 if(body.fallbacks!==undefined){
  if(!Array.isArray(body.fallbacks)||body.fallbacks.some(m=>!valid(m)))throw Error('利用可能な代替モデルを指定してください');
  settings.fallbacks||={};const chain=body.fallbacks.map(m=>({provider:m.provider,model:m.model,reasoningEffort:m.reasoningEffort}));
  if(group){settings.fallbacks[group]||={};settings.fallbacks[group][key]=chain}else settings.fallbacks.default=chain;
 }
 const selected={provider:body.model.provider,model:body.model.model,reasoningEffort:body.model.reasoningEffort};
 if(group)settings[group][key]=selected;else settings.default=selected;store.set('workerModels',settings);return settings;
}
