/** Run locally by developer with Google Application Default Credentials. No browser admins. */
const admin = require('firebase-admin');
if(!process.env.GOOGLE_CLOUD_PROJECT || !process.argv[2]){console.error('Usage: GOOGLE_CLOUD_PROJECT=your-project GOOGLE_APPLICATION_CREDENTIALS=/secure/file.json node scripts/grant-admin.cjs ACCOUNT_EMAIL');process.exit(1)}
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:process.env.GOOGLE_CLOUD_PROJECT});
(async()=>{const user=await admin.auth().getUserByEmail(process.argv[2]);await admin.auth().setCustomUserClaims(user.uid,{...(user.customClaims||{}),admin:true});console.log(`Admin role assigned to account ${user.uid}. Sign out and sign in again.`)})().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)});
