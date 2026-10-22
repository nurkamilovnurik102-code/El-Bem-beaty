/* EL BEM BEAUTY — server-authoritative booking and checkout. Node.js 22, Firebase Functions v2. */
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const REGION = 'europe-west1';
const REQUIRE_APPCHECK = process.env.ENFORCE_APPCHECK === 'true';
const SLOT_MINUTES = 15;
const APPOINTMENT_STEP = 30;
const MAX_BOOKING_DAYS = 90;
const text = (s,n=120) => typeof s === 'string' ? s.trim().replace(/[<>]/g,'').slice(0,n) : '';
const phone = s => typeof s==='string' && /^\+?\d[\d\s()\-]{7,}$/.test(s.trim());
const isDay = s => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
const isTime = s => typeof s==='string' && /^(?:[01]\d|2[0-3]):(?:00|30)$/.test(s);
const min = s => Number(s.slice(0,2))*60+Number(s.slice(3,5));
const hhmm = n => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const currentLocal = () => new Date(Date.now()+6*3600000).toISOString().slice(0,16);
const localDate = () => currentLocal().slice(0,10);
const dayDiff = date => Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${localDate()}T00:00:00Z`))/86400000);
const safeDate = date => isDay(date) && dayDiff(date)>=0 && dayDiff(date)<=MAX_BOOKING_DAYS;
const docList = async col => (await db.collection(col).get()).docs.map(d=>({id:d.id,...d.data()}));
const assertAppointment = (date,time) => {if(!safeDate(date)||!isTime(time))throw new HttpsError('invalid-argument','Проверьте дату и время записи');if(`${date}T${time}`<=currentLocal())throw new HttpsError('failed-precondition','Нельзя бронировать прошедшее время')};
async function bookingInputs(serviceIds, date, masterId) {
  if(!Array.isArray(serviceIds)||serviceIds.length<1||serviceIds.length>8||new Set(serviceIds).size!==serviceIds.length||serviceIds.some(x=>typeof x!=='string'||x.length>90))throw new HttpsError('invalid-argument','Выберите 1–8 услуг');
  if(!safeDate(date))throw new HttpsError('invalid-argument','Дата недоступна');
  const serviceDocs=await Promise.all(serviceIds.map(id=>db.collection('services').doc(id).get()));
  const services=serviceDocs.map(d=>d.exists?d.data():null);
  if(services.some(s=>!s||s.active===false||!Number.isFinite(s.price)||s.price<0||!Number.isFinite(s.duration)||s.duration<15||s.duration>480))throw new HttpsError('failed-precondition','Услуга недоступна');
  const duration=services.reduce((sum,s)=>sum+Number(s.duration),0);
  const total=services.reduce((sum,s)=>sum+Number(s.price),0);
  const allMasters=await docList('masters');
  const candidates=allMasters.filter(m=>m.active!==false&&serviceIds.every(id=>Array.isArray(m.serviceIds)&&m.serviceIds.includes(id))&&(masterId==='any'||m.id===masterId));
  if(!candidates.length)throw new HttpsError('failed-precondition','Нет подходящего мастера');
  const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
  const hours=await docList('masterHours');
  const blocks=await docList('blockedSlots');
  const validCandidates=candidates.map(m=>({
    ...m,
    hours:(hours.find(h=>h.master_id===m.id&&h.weekday===weekday) || {open_at:'09:00',close_at:'19:00',is_open:true})
  })).filter(m=>m.hours.is_open===true);
  return {duration,total,services,candidates:validCandidates,blocks};
}
function appointmentParts(date, start, duration, master) {
  if(start<min(master.hours.open_at)||start+duration>min(master.hours.close_at))return null;
  const quarters=[];
  for(let t=start;t<start+duration;t+=SLOT_MINUTES)quarters.push(hhmm(Math.floor(t/SLOT_MINUTES)*SLOT_MINUTES));
  return quarters.map(t=>({id:`${master.id}|${date}|${t}`, date, masterId:master.id, time:t}));
}
function isBlocked(blocks, masterId, date, quarters){
  const blocked=new Set(blocks.map(b=>b.slot));
  return quarters.some(q=>{
    const tm=hhmm(Math.floor(min(q.time)/APPOINTMENT_STEP)*APPOINTMENT_STEP);
    return blocked.has(`${date}|${tm}`)||blocked.has(`${masterId}|${date}|${tm}`);
  });
}
exports.availableSlots=onCall({region:REGION, maxInstances:20,enforceAppCheck:REQUIRE_APPCHECK}, async request=>{
  const {date,serviceIds,masterId='any'}=request.data||{};
  if(!Array.isArray(serviceIds)||!safeDate(date))throw new HttpsError('invalid-argument','Укажите дату и услуги');
  const {duration,candidates,blocks}=await bookingInputs(serviceIds,date,masterId);
  const locked=await db.collection('reservationLocks').where('date','==',date).get();
  const lockIds=new Set(locked.docs.map(doc=>doc.id));
  const slots=[];
  for(let t=9*60;t<=21*60;t+=APPOINTMENT_STEP){
    const time=hhmm(t);
    if(`${date}T${time}`<=currentLocal())continue;
    const free=candidates.some(m=>{const parts=appointmentParts(date,t,duration,m);return parts&&!isBlocked(blocks,m.id,date,parts)&&parts.every(p=>!lockIds.has(p.id))});
    if(free)slots.push(time);
  }
  return {slots};
});
exports.createBooking=onCall({region:REGION, maxInstances:20,enforceAppCheck:REQUIRE_APPCHECK}, async request=>{
  const {name,phone:tel,note='',date,time,serviceIds,masterId='any'}=request.data||{};
  if(text(name,100).length<2||!phone(tel)||text(note,1000).length>1000)throw new HttpsError('invalid-argument','Укажите корректные контактные данные');
  assertAppointment(date,time);
  const {duration,total,services,candidates,blocks}=await bookingInputs(serviceIds,date,masterId);
  if(!candidates.length)throw new HttpsError('failed-precondition','У мастеров сегодня выходной');
  for(const master of candidates){
    const parts=appointmentParts(date,min(time),duration,master);
    if(!parts||isBlocked(blocks,master.id,date,parts))continue;
    const bookingRef=db.collection('bookings').doc();
    const booking={id:bookingRef.id,name:text(name,100),phone:text(tel,35),note:text(note,1000),date,time,masterId:master.id,serviceIds,serviceNames:services.map(item=>text(item.name,200)),masterName:text(master.name,120),total,duration,status:'pending',createdAt:new Date().toISOString(),userId:request.auth?.uid||null};
    try {
      await db.runTransaction(async tx=>{
        const lockRefs=parts.map(p=>db.collection('reservationLocks').doc(p.id));
        const locks=await tx.getAll(...lockRefs);
        if(locks.some(lock=>lock.exists))throw new HttpsError('already-exists','Это время уже занято');
        tx.create(bookingRef,booking);
        parts.forEach((p,i)=>tx.create(lockRefs[i],{...p,bookingId:bookingRef.id}));
      });
      return {id:bookingRef.id,masterId:master.id,total};
    } catch(e) { if(e.code==='already-exists'||e.code===6)continue;throw e }
  }
  throw new HttpsError('failed-precondition','Это время занято. Выберите другой интервал');
});
exports.placeOrder=onCall({region:REGION,maxInstances:20,enforceAppCheck:REQUIRE_APPCHECK},async request=>{
  const {name,phone:tel,items}=request.data||{};
  if(text(name,100).length<2||!phone(tel)||!Array.isArray(items)||items.length<1||items.length>30)throw new HttpsError('invalid-argument','Некорректный заказ');
  const seen=new Set();
  for(const item of items){if(typeof item.id!=='string'||item.id.length>90||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20||seen.has(item.id))throw new HttpsError('invalid-argument','Проверьте товары и количество');seen.add(item.id)}
  const refs=items.map(i=>db.collection('products').doc(i.id));
  const snapshots=await db.getAll(...refs);
  const products=snapshots.map(s=>s.exists?s.data():null);
  if(products.some(x=>!x||x.active===false||!Number.isFinite(x.price)||x.price<0))throw new HttpsError('failed-precondition','Один из товаров недоступен');
  const productItems=items.map((item,i)=>({id:item.id,quantity:item.quantity,price:products[i].price,name:text(products[i].name,200)}));
  const total=productItems.reduce((sum,x)=>sum+x.quantity*x.price,0);
  const ref=db.collection('orders').doc();
  const order={id:ref.id,name:text(name,100),phone:text(tel,35),items:productItems,total,status:'pending',date:new Date().toISOString(),userId:request.auth?.uid||null};
  await ref.create(order);
  return {order};
});
// Admin-only status transitions atomically release locks when a booking is cancelled.
exports.updateBookingStatus=onCall({region:REGION},async request=>{
  if(!request.auth?.token?.admin)throw new HttpsError('permission-denied','Только для администратора');
  const {id,status}=request.data||{};
  if(typeof id!=='string'||!['confirmed','cancelled'].includes(status))throw new HttpsError('invalid-argument','Некорректный статус');
  const bookingRef=db.collection('bookings').doc(id);
  await db.runTransaction(async tx=>{
    const bookingSnap=await tx.get(bookingRef);
    if(!bookingSnap.exists)throw new HttpsError('not-found','Запись не найдена');
    const booking=bookingSnap.data();
    if(booking.status==='cancelled'&&status!=='cancelled')throw new HttpsError('failed-precondition','Отменённую запись необходимо создать заново');
    if(booking.status!=='cancelled'&&status==='cancelled'){
      const refs=[];
      for(let t=min(booking.time);t<min(booking.time)+booking.duration;t+=SLOT_MINUTES)refs.push(db.collection('reservationLocks').doc(`${booking.masterId}|${booking.date}|${hhmm(Math.floor(t/SLOT_MINUTES)*SLOT_MINUTES)}`));
      // Must read before writes in Firestore transactions.
      const snaps=await tx.getAll(...refs);
      snaps.forEach((s,i)=>{if(s.exists&&s.data().bookingId===id)tx.delete(refs[i])});
    }
    tx.update(bookingRef,{status});
  });
  return {ok:true};
});
// Authenticated clients can propose a review; only the owner can publish it.
exports.submitReview=onCall({region:REGION},async request=>{
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','Войдите в аккаунт, чтобы оставить отзыв');
  const {name,review,rating}=request.data||{};
  if(text(name,90).length<2||text(review,1800).length<12||!Number.isInteger(rating)||rating<1||rating>5)throw new HttpsError('invalid-argument','Укажите имя, оценку и текст отзыва');
  const ref=db.collection('reviews').doc(`user_${request.auth.uid}`);
  try{await ref.create({id:ref.id,name:text(name,90),text:text(review,1800),rating,approved:false,userId:request.auth.uid,createdAt:new Date().toISOString()})}
  catch(e){if(e.code===6||e.code==='already-exists')throw new HttpsError('already-exists','Вы уже оставляли отзыв');throw e}
  return {ok:true};
});
exports.updateOrderStatus=onCall({region:REGION},async request=>{
  if(!request.auth?.token?.admin)throw new HttpsError('permission-denied','Только для администратора');
  const {id,status}=request.data||{};
  if(typeof id!=='string'||!['pending','processing','completed','cancelled'].includes(status))throw new HttpsError('invalid-argument','Недопустимый статус');
  const ref=db.collection('orders').doc(id);
  if(!(await ref.get()).exists)throw new HttpsError('not-found','Заказ не найден');
  await ref.update({status});return {ok:true};
});
