/** EL BEM: Spark-only Firestore backend. No Cloud Functions or Firebase Storage required.
 * Reservations use atomic multi-document Firestore transactions and deterministic
 * 30-minute occupancy documents. The security rules must be deployed together.
 */
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, where,
  setDoc, runTransaction, type Unsubscribe
} from 'firebase/firestore';
import {getIdTokenResult} from 'firebase/auth';
import {auth, db, configured} from './firebase';
import {defaults,services,masters,products,type Content,type Service,type Master,type Product,type Booking} from './data';
export {configured, auth};
export type CatalogCategory={localized?:import('./data').LocalizedFields;id:string;name:string;kind:'service'|'product';image:string;active:boolean;sortOrder:number};
export type Order={id:string;name:string;phone:string;items:{id:string;quantity:number;price:number;name?:string}[];total:number;date:string;status?:string;userId?:string};
export type Review={id:string;text:string;name:string;image?:string;rating?:number;approved?:boolean};
export type State={content:Content;categories:CatalogCategory[];services:Service[];masters:Master[];products:Product[];bookings:Booking[];orders:Order[];reviews:Review[];blocked:string[]};
export type MasterHour={master_id:string;weekday:number;open_at:string;close_at:string;is_open:boolean};
const start:State={content:defaults,categories:[...[...new Set(services.map(x=>x.category))].map((name,i)=>({id:`sc${i}`,name,kind:'service' as const,image:'',active:true,sortOrder:i})),...[...new Set(products.map(x=>x.category))].map((name,i)=>({id:`pc${i}`,name,kind:'product' as const,image:'',active:true,sortOrder:i}))],services,masters,products,bookings:[],orders:[],reviews:[],blocked:[]};
const KEY='elbem-v2-firebase-demo';
export function readDemo():State{try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&d.content&&Array.isArray(d.services))return {...start,...d,
  content:{...defaults,...d.content,aboutText:String(d.content.aboutText??defaults.aboutText).replace('Представленные фотографии и описания в демоверсии иллюстративны.','').trim()},
  masters:Array.isArray(d.masters)?d.masters.map((m:Master)=>({...m,specialty:m.specialty?.replace(/\s*·\s*DEMO$/,'')})):start.masters,
  products:Array.isArray(d.products)?d.products.map((item:Product)=>({...item,description:item.description==='Демонстрационная позиция'?'Средство для ежедневного ухода.':item.description})):start.products,
  reviews:Array.isArray(d.reviews)?d.reviews.filter((item:Review)=>!(item.id==='r1'&&item.text?.includes('демонстрационный'))):start.reviews
 }}catch{}return start}
export function writeDemo(state:State){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){console.warn('Local data storage full',e)}}
function requireDb(){if(!db)throw Error('Firebase ещё не настроен');return db}
function requireUser(){const u=auth?.currentUser;if(!u)throw Error('Войдите или зарегистрируйтесь, чтобы отправить заявку.');return u}
function clean(s:string,max=120){return String(s||'').replace(/[<>]/g,'').trim().slice(0,max)}
function validPhone(s:string){return /^\+?\d[\d\s()\-]{7,}$/.test(s.trim())}
function dateLocal(){return new Date(Date.now()+6*3600000).toISOString().slice(0,16)}
const timeMinutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
const minutesTime=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const slotKey=(masterId:string,date:string,minute:number)=>`${masterId}|${date}|${minute}`;
function mapCollection(key:string):string{const mapping:Record<string,string>={site_content:'siteContent',catalog_categories:'categories',blocked_slots:'blockedSlots',master_hours:'masterHours'};return mapping[key]||key}
async function docs<T>(name:string):Promise<T[]>{const records=await getDocs(collection(requireDb(),mapCollection(name)));return records.docs.map(row=>({id:row.id,...row.data()} as T))}
export async function readLive(includePrivate=false):Promise<State>{
  const [ss,ms,ps,cs,rs,content]=await Promise.all([
    docs<Service>('services'),docs<Master>('masters'),docs<Product>('products'),docs<CatalogCategory>('categories'),
    includePrivate?docs<Review>('reviews'):getDocs(query(collection(requireDb(),'reviews'),where('approved','==',true))).then(ss=>ss.docs.map(d=>({id:d.id,...d.data()} as Review))),
    getDoc(doc(requireDb(),'siteContent','main')),
  ]);
  if(!includePrivate)return {content:content.exists()?content.data() as Content:defaults,categories:cs,services:ss,masters:ms,products:ps,reviews:rs.filter(r=>r.approved===true),bookings:[],orders:[],blocked:[]};
  const [bookings,orders,blocks]=await Promise.all([docs<Booking>('bookings'),docs<Order>('orders'),docs<{slot:string}>('blockedSlots')]);
  return {content:content.exists()?content.data() as Content:defaults,categories:cs,services:ss,masters:ms,products:ps,reviews:rs,bookings,orders,blocked:blocks.map(b=>b.slot)};
}
export async function saveEntity(table:string,value:object){
  const v=value as Record<string,unknown>;
  const key=table==='site_content'?'main':table==='blocked_slots'?String(v.slot):table==='master_hours'?`${v.master_id}_${v.weekday}`:String(v.id||'');
  if(!key)throw Error('Отсутствует ID документа');
  const data=table==='site_content'?(v.data as Record<string,unknown>):table==='blocked_slots'?{slot:v.slot}:v;
  await setDoc(doc(requireDb(),mapCollection(table),key),data,{merge:true});
}
export async function deleteEntity(table:string,id:string){await deleteDoc(doc(requireDb(),mapCollection(table),id))}
export async function saveCategory(category:CatalogCategory){await saveEntity('categories',category)}
export async function renameCatalogCategory(kind:'service'|'product',oldName:string,newName:string,items:(Service|Product)[]){for(const item of items.filter(x=>x.category===oldName))await saveEntity(kind==='service'?'services':'products',{...item,category:newName})}
export async function getMasterHours():Promise<MasterHour[]>{return docs<MasterHour>('masterHours')}
export async function saveMasterHour(row:MasterHour){await saveEntity('master_hours',row)}
export async function deleteBlock(slot:string){await deleteEntity('blocked_slots',slot)}

const STEP=30;
const MAX_LOCKS=8;  // Up to four hours per appointment on the free plan.
function checkDate(date:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw Error('Некорректная дата');
  const diff=(Date.parse(date+'T00:00:00Z')-Date.parse(dateLocal().slice(0,10)+'T00:00:00Z'))/86400000;
  if(diff<0||diff>90)throw Error('Можно записаться только на ближайшие 90 дней');
}
async function bookingContext(date:string,serviceIds:string[],masterId:string){
  checkDate(date);
  if(!Array.isArray(serviceIds)||serviceIds.length<1||serviceIds.length>8||new Set(serviceIds).size!==serviceIds.length)throw Error('Выберите услуги');
  const [selected,allMasters,hours,blocked,locks]=await Promise.all([
    Promise.all(serviceIds.map(id=>getDoc(doc(requireDb(),'services',id)))),
    docs<Master>('masters'),docs<MasterHour>('masterHours'),docs<{slot:string}>('blockedSlots'),
    getDocs(query(collection(requireDb(),'reservationLocks'),where('date','==',date)))
  ]);
  if(selected.some(s=>!s.exists()||s.data()?.active===false))throw Error('Одна из услуг недоступна');
  const chosen=selected.map(s=>s.data() as Service);
  const rawDuration=chosen.reduce((n,s)=>n+Number(s.duration),0);
  const price=chosen.reduce((n,s)=>n+Number(s.price),0);
  if(!chosen.every(s=>Number.isFinite(s.price)&&s.price>=0&&Number.isFinite(s.duration)&&s.duration>=15)||!Number.isFinite(rawDuration))throw Error('Недопустимая цена или длительность услуги');
  if(Math.ceil(rawDuration/STEP)>MAX_LOCKS)throw Error('На сайте можно выбрать процедуры общей длительностью до 4 часов. Для более долгой записи свяжитесь с салоном.');
  const duration=Math.ceil(rawDuration/STEP)*STEP;
  const weekday=new Date(date+'T00:00:00Z').getUTCDay();
  const candidates=allMasters.filter(m=>m.active!==false&&serviceIds.every(id=>m.serviceIds?.includes(id))&&(masterId==='any'||m.id===masterId))
    .map(master=>({...master,working:hours.find(h=>h.master_id===master.id&&h.weekday===weekday)||{open_at:'09:00',close_at:'19:00',is_open:true}}))
    .filter(m=>m.working.is_open);
  return {chosen,candidates,duration,rawDuration,price,blocked:new Set(blocked.map(b=>b.slot)),locked:new Set(locks.docs.map(l=>l.id))};
}
function spansAreOpen(date:string,startMinute:number,ctx:Awaited<ReturnType<typeof bookingContext>>,master:typeof ctx.candidates[number]){
  if(startMinute<timeMinutes(master.working.open_at)||startMinute+ctx.duration>timeMinutes(master.working.close_at))return false;
  for(let minute=startMinute;minute<startMinute+ctx.duration;minute+=STEP){
    const time=minutesTime(minute);
    if(ctx.blocked.has(`${date}|${time}`)||ctx.blocked.has(`${master.id}|${date}|${time}`)||ctx.locked.has(slotKey(master.id,date,minute)))return false;
  }
  return true;
}
export async function availableSlots(date:string,serviceIds:string[],masterId:string):Promise<string[]>{
  if(!serviceIds.length)return [];
  const ctx=await bookingContext(date,serviceIds,masterId);
  const slots:string[]=[];
  for(let m=9*60;m<21*60;m+=STEP){
    const time=minutesTime(m);
    if(`${date}T${time}`<=dateLocal())continue;
    if(ctx.candidates.some(master=>spansAreOpen(date,m,ctx,master)))slots.push(time);
  }
  return slots;
}
class SlotBusy extends Error{}
export async function createBooking(input:Booking):Promise<{id:string;masterId:string;total:number}>{
  const user=requireUser();
  if(clean(input.name,100).length<2||!validPhone(input.phone))throw Error('Укажите имя и телефон');
  if(!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(input.time))throw Error('Выберите время из списка');
  const ctx=await bookingContext(input.date,input.serviceIds,input.masterId);
  const minute=timeMinutes(input.time);
  if(`${input.date}T${input.time}`<=dateLocal())throw Error('Это время уже прошло');
  if(ctx.candidates.length===0)throw Error('Нет доступного мастера для выбранных услуг');
  for(const master of ctx.candidates){
    if(!spansAreOpen(input.date,minute,ctx,master))continue;
    const bookingRef=doc(collection(requireDb(),'bookings'));
    const lockKeys=Array.from({length:ctx.duration/STEP},(_,i)=>slotKey(master.id,input.date,minute+i*STEP));
    const refs=lockKeys.map(key=>doc(requireDb(),'reservationLocks',key));
    const payload={id:bookingRef.id,name:clean(input.name,100),phone:clean(input.phone,35),date:input.date,time:input.time,
      startMinute:minute,lockKeys,serviceIds:input.serviceIds,serviceNames:ctx.chosen.map(s=>clean(s.name,200)),
      masterId:master.id,masterName:clean(master.name,120),total:ctx.price,duration:ctx.rawDuration,status:'pending',
      createdAt:new Date().toISOString(),note:clean(input.note||'',1000),userId:user.uid};
    try{
      await runTransaction(requireDb(),async tx=>{
        const snapshots=[];
        for(const ref of refs)snapshots.push(await tx.get(ref));
        if(snapshots.some(s=>s.exists()))throw new SlotBusy('Интервал занят');
        tx.set(bookingRef,payload);
        refs.forEach((ref,i)=>tx.set(ref,{bookingId:bookingRef.id,userId:user.uid,masterId:master.id,date:input.date,minute:minute+i*STEP}));
      });
      return {id:bookingRef.id,masterId:master.id,total:ctx.price};
    }catch(e){if(e instanceof SlotBusy)continue;throw e}
  }
  throw Error('Выбранное время уже занято. Обновите список доступных интервалов.');
}
export async function updateBookingStatus(id:string,status:Booking['status']){
  if(!await checkAdmin())throw Error('Требуется роль администратора');
  if(!['confirmed','cancelled'].includes(status))throw Error('Неизвестный статус');
  const ref=doc(requireDb(),'bookings',id);
  await runTransaction(requireDb(),async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists())throw Error('Запись не найдена');
    const booking=snap.data() as Booking & {lockKeys?:string[]};
    if(booking.status==='cancelled'&&status!=='cancelled')throw Error('Отменённую запись нельзя подтвердить повторно');
    const refs=status==='cancelled'&&booking.status!=='cancelled'?(booking.lockKeys||[]).map(key=>doc(requireDb(),'reservationLocks',key)):[];
    const locks=[];
    for(const r of refs)locks.push(await tx.get(r));
    locks.forEach((lock,i)=>{if(lock.exists()&&lock.data()?.bookingId===id)tx.delete(refs[i])});
    tx.update(ref,{status});
  });
}
export async function makeOrder(order:Order):Promise<Order>{
  const user=requireUser();
  if(clean(order.name,100).length<2||!validPhone(order.phone)||!order.items.length||order.items.length>8)throw Error('Проверьте контактные данные и корзину (максимум 8 разных товаров)');
  const ids=order.items.map(i=>i.id);
  if(new Set(ids).size!==ids.length||order.items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>20))throw Error('Некорректное количество товаров');
  const pDocs=await Promise.all(ids.map(id=>getDoc(doc(requireDb(),'products',id))));
  if(pDocs.some(s=>!s.exists()||s.data()?.active===false))throw Error('Один из товаров больше не продаётся');
  const items=order.items.map((x,i)=>({id:x.id,quantity:x.quantity,price:Number(pDocs[i].data()!.price),name:clean(String(pDocs[i].data()!.name),200)}));
  if(items.some(i=>!Number.isFinite(i.price)||i.price<0))throw Error('Некорректная цена');
  const output:Order={id:crypto.randomUUID(),name:clean(order.name,100),phone:clean(order.phone,35),items,
    total:items.reduce((sum,i)=>sum+i.quantity*i.price,0),date:new Date().toISOString(),status:'pending',userId:user.uid};
  await setDoc(doc(requireDb(),'orders',output.id),output);
  return output;
}
export async function updateOrderStatus(id:string,status:string){
  if(!await checkAdmin())throw Error('Требуется роль администратора');
  if(!['pending','processing','completed','cancelled'].includes(status))throw Error('Недопустимый статус');
  await setDoc(doc(requireDb(),'orders',id),{status},{merge:true});
}
export async function submitReview(name:string,review:string,rating:number){
  const user=requireUser();
  if(clean(name,90).length<2||clean(review,1800).length<12||!Number.isInteger(rating)||rating<1||rating>5)throw Error('Укажите имя, отзыв и оценку');
  const id='user_'+user.uid;
  // Create-only: prevent repeatedly replacing reviews or self-approving.
  await runTransaction(requireDb(),async tx=>{
    const r=doc(requireDb(),'reviews',id);
    if((await tx.get(r)).exists())throw Error('Вы уже оставляли отзыв');
    tx.set(r,{id,name:clean(name,90),text:clean(review,1800),rating,approved:false,userId:user.uid,createdAt:new Date().toISOString()});
  });
}
export async function checkAdmin(){const u=auth?.currentUser;if(!u)return false;const token=await getIdTokenResult(u,true);return token.claims.admin===true}
export async function getMyData():Promise<{bookings:Booking[];orders:Order[]}>{const user=auth?.currentUser;if(!user)return {bookings:[],orders:[]};const [bs,os]=await Promise.all([getDocs(query(collection(requireDb(),'bookings'),where('userId','==',user.uid))),getDocs(query(collection(requireDb(),'orders'),where('userId','==',user.uid)))]);return {bookings:bs.docs.map(x=>({id:x.id,...x.data()} as Booking)),orders:os.docs.map(x=>({id:x.id,...x.data()} as Order))}}
export function subscribeAdminBookings(onChange:(bookings:Booking[])=>void):Unsubscribe{return onSnapshot(collection(requireDb(),'bookings'),ss=>onChange(ss.docs.map(row=>({id:row.id,...row.data()} as Booking))),e=>console.error('Booking subscription',e))}
export function subscribeAdminOrders(onChange:(orders:Order[])=>void):Unsubscribe{return onSnapshot(collection(requireDb(),'orders'),ss=>onChange(ss.docs.map(row=>({id:row.id,...row.data()} as Order))),e=>console.error('Order subscription',e))}
export async function uploadMedia(_file:File,_folder:'site'|'audio'):Promise<string>{throw Error('На бесплатном тарифе Spark новые файлы не загружаются. Используйте публичную ссылку HTTPS или файл из папки public.');}
