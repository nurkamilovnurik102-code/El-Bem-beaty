/** Optional one-time bootstrap: DEMO-only contents. Does not overwrite existing documents. */
const admin=require('firebase-admin');
const seed=require('../seed-data.json');
if(!process.env.GOOGLE_CLOUD_PROJECT){console.error('Set GOOGLE_CLOUD_PROJECT to your Firebase project ID');process.exit(1)}
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT});
const db=admin.firestore();
(async()=>{
  let inserted=0;const existing=[];
  const insert=async(col,id,data)=>{const ref=db.collection(col).doc(id);const snapshot=await ref.get();if(snapshot.exists){existing.push(`${col}/${id}`);return}await ref.create(data);inserted++};
  await insert('siteContent','main',seed.content);
  for(const collection of ['services','masters','products','categories','reviews'])for(const item of seed[collection])await insert(collection,item.id,item);
  console.log(`Done. Demo documents added: ${inserted}, skipped existing: ${existing.length}. No existing data overwritten.`)
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
