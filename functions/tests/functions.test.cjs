/** Tests actual Cloud Functions handlers with an in-memory Firestore stub; not a deployed-service test. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code}}
function harness(){
  const data=new Map();
  const key=(c,id)=>`${c}/${id}`;
  const clone=obj=>JSON.parse(JSON.stringify(obj));
  const snapshots=(col)=>[...data].filter(([id])=>id.startsWith(`${col}/`)).map(([id,value])=>({id:id.slice(col.length+1),exists:true,data:()=>clone(value)}));
  const getSnap=(c,id)=>({id,exists:data.has(key(c,id)),data:()=>clone(data.get(key(c,id)))});
  let sequence=0;
  const doc=(col,id)=>{const documentId=id||`fake${++sequence}`;return {id:documentId,ref:key(col,documentId),get:async()=>getSnap(col,documentId),create:async v=>{if(data.has(key(col,documentId)))throw new HttpsError('already-exists','Exists');data.set(key(col,documentId),clone(v))},update:async v=>{data.set(key(col,documentId),{...data.get(key(col,documentId)),...clone(v)})}}};
  const collection=col=>({doc:id=>doc(col,id),get:async()=>({docs:snapshots(col)}),where:(field,_,value)=>({get:async()=>({docs:snapshots(col).filter(x=>x.data()[field]===value)})})});
  const db={collection,getAll:async(...refs)=>refs.map(r=>{const [col,...id]=r.ref.split('/');return getSnap(col,id.join('/'))}),runTransaction:async callback=>{
    const operations=[];
    const tx={get:async ref=>{const [col,...id]=ref.ref.split('/');return getSnap(col,id.join('/'))},getAll:async(...refs)=>db.getAll(...refs),create:(ref,val)=>operations.push({type:'create',ref,value:val}),delete:ref=>operations.push({type:'delete',ref}),update:(ref,val)=>operations.push({type:'update',ref,value:val})};
    const result=await callback(tx);
    for(const op of operations){if(op.type==='create'&&data.has(op.ref.ref))throw new HttpsError('already-exists','Already exists')}
    for(const op of operations){if(op.type==='create')data.set(op.ref.ref,clone(op.value));else if(op.type==='delete')data.delete(op.ref.ref);else if(op.type==='update')data.set(op.ref.ref,{...data.get(op.ref.ref),...clone(op.value)})}
    return result;
  }};
  const admin={initializeApp:()=>{},firestore:()=>db};
  const exports={};
  const context=vm.createContext({require:name=>name==='firebase-admin'?admin:name==='firebase-functions/v2/https'?{onCall:(_options,handler)=>handler,HttpsError}:require(name),exports,module:{exports},process:{env:{}},console,Date,Map,Set,Number,Math,Array,String});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../index.js'),'utf8'),context,{filename:'functions/index.js'});
  const put=(col,id,value)=>data.set(key(col,id),value);
  const get=(col,id)=>data.get(key(col,id));
  return {api:context.exports,put,get,all:snapshots};
}
const dateTomorrow=()=>new Date(Date.now()+6*3600000+86400000).toISOString().slice(0,10);
const fixture=()=>{const h=harness();h.put('services','s1',{id:'s1',name:'Стрижка',price:600,duration:75,active:true});h.put('masters','m1',{id:'m1',name:'Мастер',active:true,serviceIds:['s1']});h.put('products','p1',{id:'p1',name:'Крем',active:true,price:350});return h};
const booking=()=>({data:{name:'Тестовый клиент',phone:'+996 555 123 456',serviceIds:['s1'],masterId:'any',date:dateTomorrow(),time:'09:00',total:1}});
test('server computes total from Firestore, not the untrusted client', async()=>{
  const h=fixture();const result=await h.api.createBooking(booking());assert.equal(result.total,600);assert.equal(result.masterId,'m1');assert.equal(h.get('bookings',result.id).total,600);
});
test('overlapping 75-minute bookings cannot claim the same master and time', async()=>{
  const h=fixture();await h.api.createBooking(booking());await assert.rejects(()=>h.api.createBooking(booking()),e=>e.code==='failed-precondition');
});
test('cancel releases locks, allowing a new booking of that interval', async()=>{
  const h=fixture();const first=await h.api.createBooking(booking());await h.api.updateBookingStatus({auth:{uid:'admin',token:{admin:true}},data:{id:first.id,status:'cancelled'}});const second=await h.api.createBooking(booking());assert.notEqual(first.id,second.id);
});
test('normal client cannot act as admin', async()=>{
  const h=fixture();await assert.rejects(()=>h.api.updateBookingStatus({auth:{uid:'client',token:{}},data:{id:'any',status:'confirmed'}}),e=>e.code==='permission-denied');
});
test('orders ignore fabricated prices and save a snapshot', async()=>{
  const h=fixture();const {order}=await h.api.placeOrder({data:{name:'Покупатель',phone:'+996 555 123 456',items:[{id:'p1',quantity:2,price:1}]}});assert.equal(order.total,700);assert.equal(order.items[0].price,350);assert.equal(h.get('orders',order.id).status,'pending');
});
test('a review is private until administrator approves', async()=>{
  const h=fixture();await h.api.submitReview({auth:{uid:'abc'},data:{name:'Клиент',review:'Отличная работа мастера, всё понравилось',rating:5}});assert.equal(h.get('reviews','user_abc').approved,false);await assert.rejects(()=>h.api.submitReview({auth:{uid:'abc'},data:{name:'Клиент',review:'Повторный отзыв после посещения',rating:5}}),e=>e.code==='already-exists');
});
test('slot query respects the allocated duration and occupied locks', async()=>{
  const h=fixture();const date=dateTomorrow();
  const before=await h.api.availableSlots({data:{date,serviceIds:['s1'],masterId:'any'}});
  assert.ok(before.slots.includes('09:00'));
  await h.api.createBooking(booking());
  const after=await h.api.availableSlots({data:{date,serviceIds:['s1'],masterId:'any'}});
  assert.equal(after.slots.includes('09:00'),false);
  assert.equal(after.slots.includes('09:30'),false);
  assert.equal(after.slots.includes('10:00'),false);
  assert.equal(after.slots.includes('10:30'),true);
});
test('master shift marked closed prevents booking',async()=>{
  const h=fixture();const date=dateTomorrow();const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
  h.put('masterHours',`m1_${weekday}`,{master_id:'m1',weekday,is_open:false,open_at:'09:00',close_at:'19:00'});
  await assert.rejects(()=>h.api.createBooking(booking()),e=>e.code==='failed-precondition');
});
test('master shift ending at 10:00 rejects 75-minute service at 09:00',async()=>{
  const h=fixture();const date=dateTomorrow();const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
  h.put('masterHours',`m1_${weekday}`,{master_id:'m1',weekday,is_open:true,open_at:'09:00',close_at:'10:00'});
  const slots=await h.api.availableSlots({data:{date,serviceIds:['s1'],masterId:'any'}});
  assert.equal(slots.slots.includes('09:00'),false);
  await assert.rejects(()=>h.api.createBooking(booking()),e=>e.code==='failed-precondition');
});
test('global blocked slot rejects an overlapping appointment',async()=>{
  const h=fixture();const date=dateTomorrow();
  h.put('blockedSlots',`${date}|09:30`,{slot:`${date}|09:30`});
  const slots=await h.api.availableSlots({data:{date,serviceIds:['s1'],masterId:'any'}});
  assert.ok(!slots.slots.includes('09:00'));
  await assert.rejects(()=>h.api.createBooking(booking()),e=>e.code==='failed-precondition');
});
test('reject duplicate selected services and nonexistent service IDs',async()=>{
  const h=fixture();const data=booking().data;
  await assert.rejects(()=>h.api.createBooking({data:{...data,serviceIds:['s1','s1']}}),e=>e.code==='invalid-argument');
  await assert.rejects(()=>h.api.createBooking({data:{...data,serviceIds:['unknown']}}),e=>e.code==='failed-precondition');
});
test('reject appointments at invalid time precision and past dates',async()=>{
  const h=fixture();const data=booking().data;
  await assert.rejects(()=>h.api.createBooking({data:{...data,time:'09:15'}}),e=>e.code==='invalid-argument');
  await assert.rejects(()=>h.api.createBooking({data:{...data,date:'2020-01-01'}}),e=>e.code==='invalid-argument');
});
test('reject unauthorized order status changes; admin may complete',async()=>{
  const h=fixture();const {order}=await h.api.placeOrder({data:{name:'Клиент',phone:'+996 555 123 456',items:[{id:'p1',quantity:1}]}});
  await assert.rejects(()=>h.api.updateOrderStatus({auth:{uid:'guest',token:{}},data:{id:order.id,status:'completed'}}),e=>e.code==='permission-denied');
  await h.api.updateOrderStatus({auth:{uid:'admin',token:{admin:true}},data:{id:order.id,status:'completed'}});
  assert.equal(h.get('orders',order.id).status,'completed');
});
test('reject orders with missing products and invalid quantities',async()=>{
  const h=fixture();const prefix={name:'Клиент',phone:'+996 555 123 456'};
  await assert.rejects(()=>h.api.placeOrder({data:{...prefix,items:[{id:'missing',quantity:1}]}}),e=>e.code==='failed-precondition');
  await assert.rejects(()=>h.api.placeOrder({data:{...prefix,items:[{id:'p1',quantity:21}]}}),e=>e.code==='invalid-argument');
  assert.equal(h.all('orders').length,0);
});
test('reviews require authentication',async()=>{
  const h=fixture();await assert.rejects(()=>h.api.submitReview({data:{name:'Гость',review:'Мне очень понравилась работа мастера',rating:5}}),e=>e.code==='unauthenticated');
});
test('saved booking includes historical service and master names',async()=>{
  const h=fixture();const row=await h.api.createBooking(booking());
  const saved=h.get('bookings',row.id);
  assert.equal(saved.serviceNames[0],'Стрижка');
  assert.equal(saved.masterName,'Мастер');
  assert.equal(saved.duration,75);
});
