import fs from 'node:fs';
const root=new URL('../src/i18n/',import.meta.url);
const read=x=>JSON.parse(fs.readFileSync(new URL(x+'.json',root),'utf8'));
const ru=read('ru'),ky=read('ky'),en=read('en');
for(const [name,dict] of [['ky',ky],['en',en]]){
 const missing=Object.keys(ru).filter(k=>typeof dict[k]!=='string'||!dict[k].trim());
 if(missing.length){console.error(name,missing);process.exitCode=1}else console.log(name+': '+Object.keys(dict).length+' keys present');
}
