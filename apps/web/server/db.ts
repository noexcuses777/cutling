import 'server-only';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
// Prisma CLI also defaults to this local path via prisma.config.ts.
process.env.DATABASE_URL ||= 'file:./cutling.db';
const singleton = globalThis as unknown as {cutlingDB?:PrismaClient};
export const db = singleton.cutlingDB ||= new PrismaClient();
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export async function get<T = any>(ownerId:string,kind:string,entityId:string):Promise<T|null>{
 const row=await db.entity.findFirst({where:{id:entityId,ownerId,kind}});return row?JSON.parse(row.data):null;
}
export async function list<T = any>(ownerId:string,kind:string,projectId?:string):Promise<T[]>{
 const rows=await db.entity.findMany({where:{ownerId,kind,...(projectId?{projectId}:{})},orderBy:{createdAt:'desc'}});return rows.map(r=>JSON.parse(r.data));
}
export async function put<T extends {id:string}>(ownerId:string,kind:string,value:T,projectId?:string,parentId?:string):Promise<T>{
 const existing=await db.entity.findUnique({where:{id:value.id},select:{ownerId:true,kind:true}});
 if(existing&&(existing.ownerId!==ownerId||existing.kind!==kind))throw new Error('OWNERSHIP');
 await db.entity.upsert({where:{id:value.id},create:{id:value.id,kind,ownerId,projectId,parentId,data:JSON.stringify(value)},update:{data:JSON.stringify(value),...(projectId?{projectId}:{})}});return value;
}
export async function remove(ownerId:string,kind:string,entityId:string){return db.entity.deleteMany({where:{id:entityId,kind,ownerId}});}
export async function must<T = any>(ownerId:string,kind:string,entityId:string):Promise<T>{const value=await get<T>(ownerId,kind,entityId);if(!value){const e=new Error('찾을 수 없거나 접근 권한이 없습니다.');Object.assign(e,{status:404,code:'NOT_FOUND'});throw e;}return value;}
