import fs from 'node:fs/promises';
import path from 'node:path';
const marker='CUTLING_SERVER_SECRET_SENTINEL_20261013';
let files=0;
async function inspect(folder,types=/\.(js|json|html|map|css)$/){for(const e of await fs.readdir(folder,{withFileTypes:true})){const filename=path.join(folder,e.name);if(e.isDirectory())await inspect(filename,types);else if(types.test(e.name)){files++;if((await fs.readFile(filename,'utf8')).includes(marker))throw new Error(`Server secret leaked to browser output: ${filename}`);}}}
await inspect('apps/web/.next/static');await inspect('apps/web/.next/server/app',/\.(html|rsc)$/);await inspect('apps/extension/dist');console.log(`${files} browser HTML/payload/bundle and extension files checked: synthetic server key absent.`);
