import { readFile } from 'node:fs/promises';

// Firebase Hosting must never publish a demo-only build by accident.
try {
  const config = JSON.parse(await readFile('dist/client/firebase-config.json', 'utf8'));
  if (config.emulator || String(config.projectId).startsWith('demo-')) {
    throw new Error('The build is configured for local Firebase emulators.');
  }
  for (const field of ['projectId', 'apiKey', 'appId', 'databaseURL']) {
    if (typeof config[field] !== 'string' || !config[field].trim() || /YOUR_|FIREBASE_/.test(config[field])) {
      throw new Error(`Missing production Firebase ${field}.`);
    }
  }
  const database = new URL(config.databaseURL);
  if (database.protocol !== 'https:' || !/(\.firebaseio\.com|\.firebasedatabase\.app)$/.test(database.hostname)) {
    throw new Error('Use the exact HTTPS URL of your Firebase Realtime Database.');
  }
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== config.projectId) {
    throw new Error('The frontend Firebase project differs from the deployment project.');
  }
  await readFile('dist/client/index.html');
  await readFile('dist/client/sw.js');
  console.log(`Production frontend configuration verified for ${config.projectId}.`);
} catch (error) {
  console.error('Hosting deployment stopped:', error.code === 'ENOENT'
    ? 'Add public/firebase-config.json for your production project and run npm run build first.'
    : error.message);
  process.exitCode = 1;
}
