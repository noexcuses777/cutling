import { defineConfig } from 'prisma/config';
import {loadEnvConfig} from '@next/env';
loadEnvConfig(process.cwd());
process.env.DATABASE_URL ||= 'file:./cutling.db';
export default defineConfig({schema:'prisma/schema.prisma',migrations:{path:'prisma/migrations'}});
