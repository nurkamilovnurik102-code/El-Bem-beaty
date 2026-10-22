const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const app = read('src/App.tsx');
const css = read('src/styles.css');
const data = read('src/data.ts');
const store = read('src/store.ts');
const seed = JSON.parse(read('functions/seed-data.json'));
test('mobile menu closes on scroll, Escape and outside click',()=>{
 assert.match(app,/addEventListener\('scroll',close/);
 assert.match(app,/event\.key==='Escape'/);
 assert.match(app,/!event\.target\.closest\('\.menu-overlay, \.header'/);
 assert.match(app,/style=\{\{top:menuTop\}\}/);
 assert.match(css,/\.header\s*\{\s*position:\s*sticky/);
});
test('music attempts autoplay and retries on user gesture',()=>{
 assert.match(app,/const attempt=\(\)=>/);
 assert.match(app,/audio\.current\.play\(\)/);
 assert.match(app,/addEventListener\('pointerdown',attempt,true\)/);
 assert.match(app,/addEventListener\('keydown',attempt,true\)/);
 assert.match(app,/musicUserPaused/);
});
test('music is stopped when admin is opened',()=>{
 assert.match(app,/const openAdmin=\(\)=>\{audio\.current\?\.pause\(\)/);
 assert.match(app,/musicEnabled&&content\.musicUrl&&!admin/);
});
test('admin music upload enables sound and volume is persisted in site content',()=>{
 assert.match(app,/musicUrl:url,musicEnabled:true/);
 assert.match(app,/type="range" min="0" max="100"/);
 assert.match(app,/musicVolume:Number\(e\.target\.value\)/);
 assert.match(app,/musicVolume\/100/);
 assert.match(data,/musicVolume\?:number/);
 assert.equal(seed.content.musicVolume,30);
});
test('account requires login for private data and supports registration',()=>{
 assert.match(app,/const AccountPage=.*\{!authUser\?/);
 assert.match(app,/createUserWithEmailAndPassword\(auth,authEmail,authPass\)/);
 assert.match(app,/signInWithEmailAndPassword\(auth,authEmail,authPass\)/);
});
test('cart addition visibly confirms and shows checkmark',()=>{
 assert.match(app,/const addProduct=\(product:Product\)=>/);
 assert.match(app,/setAddedProductId\(product\.id\)/);
 assert.match(app,/addedProductId===p\.id\?<><Check/);
 assert.match(css,/@keyframes cart-confirm/);
});
test('public-facing demo and exam labels removed from UI copy',()=>{
 for(const prohibited of ['ДЕМОНСТРАЦИОННЫЕ МАТЕРИАЛЫ','Демонстрационный каталог для экзамена','Необязательный личный кабинет для экзамена','Демонстрационный проект',' · DEMO'])assert.ok(!app.includes(prohibited),prohibited);
 assert.ok(!data.includes('Представленные фотографии и описания в демоверсии'));
 assert.deepEqual(seed.reviews,[]);
});
test('old locally cached placeholder records are migrated without losing private orders',()=>{
 assert.match(store,/reviews:Array\.isArray\(d\.reviews\)/);
 assert.match(store,/content:\{\.\.\.defaults,\.\.\.d\.content/);
 assert.match(store,/return \{\.\.\.start,\.\.\.d/);
});
