import {initializeApp,getApps} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {getAuth,signInAnonymously,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {getDatabase,ref,onValue,runTransaction,get,remove,set} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
const config={apiKey:"AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",authDomain:"formwheel.firebaseapp.com",databaseURL:"https://formwheel-default-rtdb.firebaseio.com",projectId:"formwheel",appId:"1:431583088241:web:74e0e34ea1e3e1170c55d0"};
const app=getApps()[0]||initializeApp(config),auth=getAuth(app),db=getDatabase(app);
const $=id=>document.getElementById(id),bridge=window.TerritoryBridge;
let uid=null,room=null,unsubscribe=null,seat=-1,lock=false,resolving=false;
// Identify each browser tab separately, even when Firebase Auth shares an account.
const clientId=(()=>{
 const fresh=crypto.randomUUID();
 try{
  const key="fw:territory:client",saved=sessionStorage.getItem(key);
  if(saved)return saved;
  sessionStorage.setItem(key,fresh);
 }catch{}
 return fresh;
})();
const samePlayer=p=>p?.uid===uid&&(!p.clientId||p.clientId===clientId);
const isHost=r=>r?.host===uid&&(!r.hostClient||r.hostClient===clientId);
const status=s=>{$("onlineStatus").textContent=s;bridge.status(s)};
const roomPath=code=>ref(db,"territoryRooms/"+code);
function error(e){status("Firebase 오류: "+(e.code||e.message||"연결을 확인해 줘")+" · Database Rules/Auth 설정을 확인해 줘.");lock=false}
let signIn;
onAuthStateChanged(auth,user=>{
 uid=user?.uid||null;
 if(uid&&!room)status("Firebase 로그인 연결됨");
});
async function ensureUser(){
 await auth.authStateReady();
 signIn??=(auth.currentUser?Promise.resolve(auth.currentUser):signInAnonymously(auth).then(result=>result.user)).finally(()=>signIn=null);
 uid=(await signIn).uid;
 return uid;
}
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(6))).map(x=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[x%32]).join("").slice(0,6);
const activeSeats=r=>Object.keys(r.players||{}).map(Number).sort((a,b)=>a-b);
function listen(code){if(unsubscribe)unsubscribe();room=code;history.replaceState(null,"","#room="+code);unsubscribe=onValue(roomPath(code),snap=>{const r=snap.val();if(!r){status("방이 삭제됐어.");return}const found=Object.entries(r.players||{}).find(([,v])=>samePlayer(v));seat=found?Number(found[0]):-1;if(seat<0){status("이 방의 참가자가 아니야.");return}const participants=activeSeats(r).map(p=>(p+1)+"P").join(" · ");$("roomDetail").textContent="방 코드: "+code+" / "+participants+" / "+(r.started?"진행 중":"대기 중");$("roomStart").classList.toggle("hidden",r.started||!isHost(r));$("roomStart").disabled=activeSeats(r).length!==r.config.players;$("roomStart").textContent=activeSeats(r).length===r.config.players?"🚀 게임 시작":"⏳ 참가자 대기 ("+activeSeats(r).length+"/"+r.config.players+")";if(!r.started){status("대기실 ("+activeSeats(r).length+"/"+r.config.players+") · 방 코드 "+code+" 공유 후 방장이 시작해 줘.");return}if(!r.state)return;if($("game").classList.contains("hidden"))bridge.init(r.config);bridge.apply(r.state,seat);const submitted=!!(r.orders||{})[seat];if(r.state.phase!=="finished"&&submitted)bridge.status("명령을 제출했어. 다른 플레이어를 기다리는 중…");if(submitted)bridge.status("명령 제출 완료 · 다른 플레이어를 기다리는 중…");if(isHost(r))void advanceRoom(code,r);},error)}
$("createRoom").onclick=async()=>{if(lock)return;lock=true;try{await ensureUser();let chosen;for(let tries=0;tries<5;tries++){const c=id(),r=await runTransaction(roomPath(c),old=>old===null?{created:Date.now(),host:uid,hostClient:clientId,config:bridge.config(),started:false,players:{0:{uid,clientId}},orders:{}}:undefined,{applyLocally:false});if(r.committed){chosen=c;break}}if(!chosen)throw Error("방 코드 생성에 실패했어");listen(chosen)}catch(e){error(e)}finally{lock=false}};
$("joinRoom").onclick=async()=>{
 if(lock)return;
 lock=true;
 try{
  await ensureUser();
  const code=$("roomCode").value.trim().toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))throw Error("6자리 방 코드를 입력해 줘");
  const target=roomPath(code);
  for(let attempt=0;attempt<4;attempt++){
   const current=(await get(target)).val();
   if(!current)throw Error("방을 찾을 수 없어");
   if(Object.values(current.players||{}).some(samePlayer)){listen(code);return;}
   if(current.started)throw Error("이미 시작한 방이야");
   const slot=Array.from({length:current.config.players},(_,i)=>i).find(i=>!current.players[i]);
   if(slot===undefined)throw Error("방 정원이 찼어");
   const claim=await runTransaction(ref(db,"territoryRooms/"+code+"/players/"+slot),v=>v===null?{uid,clientId}:undefined,{applyLocally:false});
   if(claim.committed){listen(code);return;}
  }
  throw Error("다른 참가자가 들어왔어. 다시 시도해 줘");
 }catch(e){error(e)}finally{lock=false;}
};
$("roomStart").onclick=async()=>{if(!room)return;try{const before=(await get(roomPath(room))).val();if(!before||before.started||activeSeats(before).length!==before.config.players|| (before.hostClient?before.hostClient!==clientId:before.host!==uid))throw Error("방장과 참가 인원을 확인해 줘");bridge.init(before.config);const initial=structuredClone(bridge.snapshot());const r=await runTransaction(roomPath(room),v=>{if(!v||(v.hostClient?v.hostClient!==clientId:v.host!==uid)||v.started||activeSeats(v).length!==v.config.players)return;v.state=initial;v.started=true;v.orders={};return v},{applyLocally:false});if(!r.committed)throw Error("게임 시작 조건을 확인해 줘")}catch(e){error(e)}};
function turnOrders(r){
 return Array.from({length:r.config.players},(_,p)=>{
  const order=r.orders?.[p];
  if(order?.turn===r.state.turn)return order;
  return r.state.out[p]||r.state.penalty[p]?{p,a:"pass",i:-1}:null;
 });
}
async function advanceRoom(code,snapshot){
 if(resolving||!isHost(snapshot)||snapshot.state.phase==="finished"||turnOrders(snapshot).some(o=>!o))return;
 resolving=true;
 try{
  await runTransaction(roomPath(code),current=>{
   if(!isHost(current)||!current.started||current.state?.turn!==snapshot.state.turn||current.state.phase==="finished")return;
   const orders=turnOrders(current);
   if(orders.some(o=>!o))return;
   return {...current,state:bridge.resolve(current.state,orders),orders:{}};
  },{applyLocally:false});
 }catch(e){error(e)}finally{resolving=false;}
}
window.addEventListener("territory:order",async event=>{
 if(!room||lock||event.detail.p!==seat)return;
 const code=room,slot=seat,{a,i,turn}=event.detail;
 lock=true;
 try{
  await set(ref(db,"territoryRooms/"+code+"/orders/"+slot),{p:slot,a,i,turn});
  status("명령 제출 완료. 다른 플레이어를 기다리는 중…");
 }catch(e){
  error(e);
  const latest=(await get(roomPath(code)).catch(()=>null))?.val();
  if(room===code&&latest?.state)bridge.apply(latest.state,slot);
 }finally{lock=false;}
});
$("restart").addEventListener("click",async()=>{
 const code=room,slot=seat;
 if(!code)return;
 unsubscribe?.();unsubscribe=null;room=null;seat=-1;
 history.replaceState(null,"",location.pathname+location.search);
 try{
  const current=(await get(roomPath(code))).val();
  if(isHost(current)&&(!current.started||current.state?.phase==="finished"))await remove(roomPath(code));
  else if(current&&!current.started&&samePlayer(current.players?.[slot]))await remove(ref(db,"territoryRooms/"+code+"/players/"+slot));
 }catch(e){error(e);}
});
const code=new URLSearchParams(location.hash.replace(/^#/,"")).get("room");if(code){$("roomCode").value=code;status("이전에 참가한 방이야. 방 참가 버튼을 눌러 다시 연결해 줘.")}