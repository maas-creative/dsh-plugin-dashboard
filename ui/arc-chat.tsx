import React, {useEffect,useRef,useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ChatThread,ChatComposer,type ChatMessage,type ChatDraft,type ChatComposerHandle} from './arc/registry/components/chat-thread/chat-thread';
import './arc/registry/foundation.css';
type Snapshot={messages?:{id:string,role:string,text:string,at:number}[],running?:boolean};
const participants=[{id:'user',name:'あなた'},{id:'agent',name:'エージェント'}];
const labels={send:'送信',sending:'送信中',sent:'受付済み',failed:'送信を確認できません',today:'今日',yesterday:'昨日',jumpToLatest:'最新へ',newMessages:(n:number)=>`${n}件の新しいメッセージ`,typing:()=> 'エージェントが応答を作成中'};
let savedDraft='';let mounted:{node:HTMLElement,root:Root}|null=null;
const saveDraft=(text:string)=>{savedDraft=text};
function VoiceInput({composer,disabled}:{composer:React.RefObject<ChatComposerHandle|null>,disabled:boolean}){
 const [phase,setPhase]=useState<'idle'|'requesting'|'recording'|'transcribing'>('idle'),[error,setError]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(true);
 useEffect(()=>()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);if(recorder.current?.state==='recording'){recorder.current.onstop=null;recorder.current.stop()}stream.current?.getTracks().forEach(track=>track.stop())},[]);
 const toggle=async()=>{
  if(recorder.current?.state==='recording'){recorder.current.stop();return}
  setError('');if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setError('このブラウザでは録音できません。キーボードの音声入力をお試しください。');return}
  setPhase('requesting');try{const media=await navigator.mediaDevices.getUserMedia({audio:true});if(!mounted.current){media.getTracks().forEach(track=>track.stop());return}stream.current=media;const audio=new MediaRecorder(media);recorder.current=audio;const chunks:Blob[]=[];audio.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};audio.onstop=async()=>{if(timer.current)clearTimeout(timer.current);media.getTracks().forEach(track=>track.stop());stream.current=null;recorder.current=null;if(!mounted.current)return;setPhase('transcribing');try{const blob=new Blob(chunks,{type:audio.mimeType});if(!blob.size||blob.size>700000)throw Error('録音が空か、長すぎます。');const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('録音を読み取れません'));reader.onload=()=>typeof reader.result==='string'?resolve(reader.result.split(',')[1]):reject(Error('録音を読み取れません'));reader.readAsDataURL(blob)});const response=await fetch('/api/voice-transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio:encoded})});const result=await response.json();if(!response.ok)throw Error(result.error||result.message||'音声を認識できませんでした');if(!result.text)throw Error('声を聞き取れませんでした。もう一度お試しください。');if(mounted.current)composer.current?.appendText(result.text)}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'音声を認識できませんでした')}finally{if(mounted.current)setPhase('idle')}};audio.start();setPhase('recording');timer.current=setTimeout(()=>{if(audio.state==='recording')audio.stop()},30000)}catch(e){stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;setPhase('idle');setError(e instanceof Error&&e.name==='NotAllowedError'?'マイクの使用が許可されていません。ブラウザの設定を確認してください。':'録音を開始できませんでした。')}
 };
 return <div className="voice-controls"><button type="button" className="voice-button" onClick={toggle} disabled={phase==='requesting'||phase==='transcribing'||(disabled&&phase==='idle')} aria-pressed={phase==='recording'}>{phase==='recording'?'録音を終了':'音声入力'}</button><span className="voice-status" role="status">{error||(phase==='recording'?'録音中（最大30秒）':phase==='requesting'?'マイクを準備中…':phase==='transcribing'?'Macで文字起こし中…':'録音はMacで文字起こしします。')}</span></div>;
}
function Conversation({snapshot,onSend,canSend}:{snapshot:Snapshot,onSend:(text:string)=>Promise<void>,canSend:boolean}){
 const composer=useRef<ChatComposerHandle>(null);
 const [pending,setPending]=useState<ChatMessage[]>([]),[sending,setSending]=useState(false),[error,setError]=useState('');
 const actual=(snapshot.messages||[]).map(m=>({id:m.id,authorId:m.role==='user'?'user':'agent',text:m.text,createdAt:m.at}));
 const messages=[...actual,...pending.filter(p=>!actual.some(m=>m.authorId==='user'&&m.text===p.text&&Number(m.createdAt)>=Number(p.createdAt)))];
 const send=async(draft:ChatDraft)=>{if(sending||!draft.text.trim())return;if(draft.text.length>4000){setError('メッセージは4000文字以内で送信してください');savedDraft=draft.text;return;}const id=crypto.randomUUID();setSending(true);setError('');setPending(p=>[...p,{id,authorId:'user',text:draft.text,createdAt:Date.now(),status:'sending'}]);try{await onSend(draft.text);setPending(p=>p.map(m=>m.id===id?{...m,status:'sent'}:m))}catch(e){setPending(p=>p.map(m=>m.id===id?{...m,status:'failed'}:m));setError((e as Error).message+'。送信内容は上の会話に残っています。')}finally{setSending(false)}};
 return <div className="dashboard-arc-chat" data-ui-component="arc-chat-thread"><ChatThread participants={participants} currentUserId="user" messages={messages} typing={snapshot.running?['agent']:[]} composer={false} allowAttachments={false} reactions={[]} label="エージェントとの会話" locale="ja-JP" labels={labels}/>{error&&<p className="arc-send-error" role="alert">{error}</p>}{canSend&&<><ChatComposer ref={composer} onSend={send} disabled={sending} defaultText={savedDraft} onTextChange={saveDraft} allowAttachments={false} placeholder="エージェントに指示する…" labels={labels}/><VoiceInput composer={composer} disabled={sending}/></>}</div>;
}
export function renderChat(node:HTMLElement,snapshot:Snapshot,onSend:(text:string)=>Promise<void>,canSend:boolean){if(mounted?.node!==node){mounted?.root.unmount();mounted={node,root:createRoot(node)}}mounted.root.render(<Conversation snapshot={snapshot} onSend={onSend} canSend={canSend}/>)}
export function detach(){mounted?.root.unmount();mounted=null}
export function clear(){detach();savedDraft=''}
