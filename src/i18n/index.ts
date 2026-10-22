import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import ru from './ru.json';
import ky from './ky.json';
import en from './en.json';
const initial=typeof localStorage!=='undefined'?localStorage.getItem('elbem-language')||'ru':'ru';
void i18n.use(initReactI18next).init({resources:{ru:{translation:ru},ky:{translation:ky},en:{translation:en}},lng:['ru','ky','en'].includes(initial)?initial:'ru',fallbackLng:'ru',interpolation:{escapeValue:false}});
i18n.on('languageChanged',lng=>{if(typeof localStorage!=='undefined')localStorage.setItem('elbem-language',lng)});
export default i18n;
