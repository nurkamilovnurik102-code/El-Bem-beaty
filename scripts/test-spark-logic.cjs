/** Offline Spark business-logic tests with an in-memory Firestore mock.
 * This is NOT a Firestore Security Rules emulator and does not contact Firebase.
 */
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let ts;try{ts=require('typescript')}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}
const data=new Map();
const auth={currentUser:{uid:'client1'}};
const fakeDb={};
let admin=false;
function snapshot(ref){const val=data.get(ref.path);return {id:ref.id,exists:()=>val!==undefined,data:()=>val};}
const fb={
 collection:(_db,name)=>({path:name}),
 doc:(a,b,c)=>{
   if(c!==undefined)return {path:`${b}/${c}`,id:c};
   if(b!==undefined)return {path:`${a.path}/${b}`,id:b};
   const id='test-'+Math.random().toString(36).slice(2);
   return {path:`${a.path}/${id}`,id};
 },
 getDoc:async ref=>snapshot(ref),
 where:(field,op,value)=>({field,op,value}),
 query:(col,filter)=>({path:col.path,filter}),
 getDocs:async ref=>({docs:[...data.entries()].filter(([key,v])=>key.startsWith(ref.path+'/')&&(!ref.filter||v[ref.filter.field]===ref.filter.value)).map(([key])=>snapshot({path:key,id:key.slice(key.lastIndexOf('/')+1)}))}),
 setDoc:async (ref,obj,opts)=>{data.set(ref.path,{...(opts?.merge?data.get(ref.path):{}),...obj})},
 deleteDoc:async ref=>{data.delete(ref.path)},
 onSnapshot:()=>()=>{},
 runTransaction:async (_db,fn)=>{
   const commands=[];
   const tx={get:async ref=>snapshot(ref),set:(ref,v)=>commands.push(['set',ref,v]),update:(ref,v)=>commands.push(['update',ref,v]),delete:ref=>commands.push(['delete',ref])};
   const result=await fn(tx);
   for(const [kind,ref,v] of commands){if(kind==='delete')data.delete(ref.path);else data.set(ref.path,kind==='update'?{...(data.get(ref.path)||{}),...v}:v)}
   return result;
 }
};
function loadTS(relative,customRequire){
 const code=fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
 const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports','crypto',compiled)((name)=>customRequire(name),module,module.exports,globalThis.crypto||require('node:crypto').webcrypto);
 return module.exports;
}
const domain=loadTS('src/data.ts',()=>{throw Error('unexpected import')});
const store=loadTS('src/store.ts',name=>{
 if(name==='firebase/firestore')return fb;
 if(name==='firebase/auth')return {getIdTokenResult:async()=>({claims:{admin}})};
 if(name==='./firebase')return {db:fakeDb,auth,configured:true};
 if(name==='./data')return domain;
 throw Error('unexpected import '+name);
});
function seed(){
 data.clear();admin=false;auth.currentUser={uid:'client1'};
 for(const service of domain.services)data.set('services/'+service.id,{...service,active:true});
 for(const master of domain.masters)data.set('masters/'+master.id,{...master,active:true});
 for(const product of domain.products)data.set('products/'+product.id,{...product,active:true});
}
beforeEach(seed);
const tomorrow=()=>new Date(Date.now()+6*3600*1000+86400*1000).toISOString().slice(0,10);
const bk=(time='10:00')=>({id:'client-request',name:'Test Client',phone:'+996700123456',date:tomorrow(),time,masterId:'m1',serviceIds:['s1'],total:0,status:'pending',createdAt:new Date().toISOString()});
test('records occupancy for all 30-minute intervals and blocks overlapping booking',async()=>{
 const a=await store.createBooking(bk());assert.equal(a.masterId,'m1');
 assert.equal([...data.keys()].filter(k=>k.startsWith('reservationLocks/')).length,2);
 await assert.rejects(()=>store.createBooking(bk('10:30')),/занят|занято/i);
});
test('releasing locks on cancellation returns slot to availability',async()=>{
 const a=await store.createBooking(bk());
 admin=true;auth.currentUser={uid:'owner'};
 await store.updateBookingStatus(a.id,'cancelled');
 assert.equal([...data.keys()].filter(k=>k.startsWith('reservationLocks/')).length,0);
 auth.currentUser={uid:'client1'};admin=false;
 assert.ok((await store.availableSlots(tomorrow(),['s1'],'m1')).includes('10:00'));
});
test('does not trust client-side order prices and derives totals from catalog',async()=>{
 const p=domain.products[0];const saved=await store.makeOrder({id:'local',name:'Client',phone:'+996700123456',items:[{id:p.id,quantity:2,price:1}],total:2,date:''});
 assert.equal(saved.total,p.price*2);assert.equal(saved.items[0].price,p.price);assert.equal(saved.userId,'client1');
});
test('requires authentication for orders and bookings',async()=>{
 auth.currentUser=null;
 await assert.rejects(()=>store.createBooking(bk()),/Войдите/i);
 await assert.rejects(()=>store.makeOrder({name:'Client',phone:'+996700123456',id:'xx',items:[{id:'p1',quantity:1,price:1}],total:1,date:''}),/Войдите/i);
});
test('requires admin role to change booking status',async()=>{
 const a=await store.createBooking(bk());
 await assert.rejects(()=>store.updateBookingStatus(a.id,'cancelled'),/роль администратора/);
});
test('prevents second review by the same client',async()=>{
 await store.submitReview('Client','Очень понравился сервис!',5);
 await assert.rejects(()=>store.submitReview('Client','Повторяю отзыв еще раз',5),/уже оставляли/i);
});
