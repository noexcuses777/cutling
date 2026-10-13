import nextEnv from '@next/env';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
nextEnv.loadEnvConfig(process.cwd());
const url=process.env.DATABASE_URL||'file:./cutling.db';
if(!url.startsWith('file:'))throw new Error('Cutling local MVP requires a SQLite file: DATABASE_URL.');
const value=url.slice(5).split('?')[0];
const filename=path.isAbsolute(value)?value:path.resolve('prisma',value);
mkdirSync(path.dirname(filename),{recursive:true});
// Prisma 6 on some Windows hosts does not create an absent file during migrate deploy.
if(!existsSync(filename))writeFileSync(filename,'',{flag:'wx'});
