/** Static regression checks for visual, admin and language changes.
 * These checks do not replace a real browser or Firebase integration test.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {join}=require('node:path');
const root=join(__dirname,'..');
const app=fs.readFileSync(join(root,'src/App.tsx'),'utf8');
const css=fs.readFileSync(join(root,'src/styles.css'),'utf8');
const langs=['ru','ky','en'].map(l=>JSON.parse(fs.readFileSync(join(root,`src/i18n/${l}.json`),'utf8')));
test('no public admin shortcut in footer',()=>{
 const footer=app.slice(app.indexOf('const Footer='),app.indexOf('return <>',app.indexOf('const Footer=')));
 assert.ok(footer.includes('footer-grid'));
 assert.ok(!footer.includes('admin-footer-link'));
 assert.ok(!footer.includes('openAdmin'));
});
test('mobile-only burger trigger, desktop hides menu',()=>{
 assert.match(app,/mobile-menu-trigger/);
 assert.match(css,/\.mobile-menu-trigger\{display:none\}/);
 assert.match(css,/@media\(max-width:980px\).*?\.mobile-menu-trigger\{display:inline-flex/);
 assert.match(css,/@media\(min-width:981px\).*?\.menu-overlay\{display:none!important/);
});
test('admin form explicitly asks for email and password and still verifies server role',()=>{
 assert.ok(app.includes('adminEmail.trim()'));
 assert.ok(app.includes('signInWithEmailAndPassword(auth,ownerEmail,adminPass)'));
 assert.ok(app.includes('await checkAdmin()'));
 assert.ok(app.includes('autoComplete="username"'));
 assert.ok(app.includes('autoComplete="current-password"'));
});
test('translation keys present on all three languages',()=>{
 for(const k of ['Email администратора','Введите корректный email.','Не удалось обновить данные. Попробуйте перезагрузить страницу.','Мои записи','Категории услуг и магазина','Время для себя']){
  for(const data of langs)assert.ok(data[k],`Missing ${k}`);
  assert.notEqual(langs[1][k],langs[2][k]);
 }
});
test('public error banner does not show internal provider name',()=>{
 assert.ok(!app.includes('Ошибка Firebase:'));
 assert.match(app,/Не удалось обновить данные\. Попробуйте перезагрузить страницу\./);
});
test('animations respect reduced motion and preserve original app sections',()=>{
 for(const cls of ['elbemRise','elbemPhoto','.elbem-reveal','prefers-reduced-motion'])assert.ok(css.includes(cls));
 for(const section of ['ServicesPage','BookingPage','ShopPage','AdminGate'])assert.ok(app.includes(section));
});
