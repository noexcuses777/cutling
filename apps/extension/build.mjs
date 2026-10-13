import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root,'dist'),{recursive:true});
for(const name of ['popup.html','options.html','page.css']) await copyFile(path.join(root,'public',name),path.join(root,'dist',name));
const brandBundle=await build({stdin:{contents:"import { BRAND } from '@cutling/shared'; export default BRAND;",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node'});
const {default:brand}=await import(`data:text/javascript;base64,${Buffer.from(brandBundle.outputFiles[0].text).toString('base64')}`);
const manifest=JSON.parse(await readFile(path.join(root,'public','manifest.json'),'utf8'));
manifest.name=`${brand.name} · ${brand.korean}`;manifest.action.default_title=brand.name;
await writeFile(path.join(root,'dist','manifest.json'),JSON.stringify(manifest,null,2));
const options={entryPoints:['worker','content','bridge','popup','options'].map(n=>path.join(root,'src',`${n}.ts`)),outdir:path.join(root,'dist'),bundle:true,format:'iife',platform:'browser',target:'chrome120',sourcemap:true};
if(process.argv.includes('--watch')) {const ctx=await context(options);await ctx.watch();console.log('Extension watching. Reload in chrome://extensions after edits.');}else{await build(options);console.log('Extension ready: apps/extension/dist');}
