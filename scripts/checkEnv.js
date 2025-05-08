// scripts/checkEnv.js
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/ollyjukes/nextjs.projects/titanx-utility/.env.local' });

console.log('Alchemy API Key:', process.env.NEXT_PUBLIC_ALCHEMY_API_KEY);