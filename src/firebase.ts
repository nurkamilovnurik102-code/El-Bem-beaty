/** Firebase client configuration. These VITE_ values are PUBLIC configuration, not secret keys. */
import {getApps, initializeApp, type FirebaseApp} from 'firebase/app';
import {getAuth, type Auth} from 'firebase/auth';
import {getFirestore, type Firestore} from 'firebase/firestore';
import {initializeAppCheck,ReCaptchaV3Provider} from 'firebase/app-check';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};
export const configured = Object.values(config).every(Boolean);
export const app: FirebaseApp | null = configured ? (getApps()[0] || initializeApp(config)) : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;

// Optional production hardening: register a reCAPTCHA v3 site key for Firestore App Check.
if(app && typeof window!=='undefined' && import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY){
  initializeAppCheck(app,{provider:new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
}
