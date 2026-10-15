import {Hono,type MiddlewareHandler} from 'hono';
import {z} from 'zod';
import {ValidationError,ConflictError} from '../domain/errors/index.js';
import type {AppEnv} from '../types/app.js';
import type {WorkDeletionServicePort} from '../services/work/WorkDeletionService.js';
import {parseOptionalOrganizationId} from './organizationRouteHelpers.js';
const idSchema=z.string().uuid();
export function createWorkDeletionRoutes(dependencies:{
 authMiddleware:MiddlewareHandler<AppEnv>;rateLimitMiddleware:MiddlewareHandler<AppEnv>;
 workDeletionService:WorkDeletionServicePort; admissionEnabled:boolean;
}):Hono<AppEnv>{
 const app=new Hono<AppEnv>();app.use('*',dependencies.authMiddleware);app.use('*',dependencies.rateLimitMiddleware);
 app.delete('/works/:id',async c=>{
  if(!dependencies.admissionEnabled)throw new ConflictError('Permanent work deletion is unavailable');
  const result=await dependencies.workDeletionService.requestDeletion(c.get('user').id,id(c.req.param('id')),parseOptionalOrganizationId(c));
  c.header('Cache-Control','no-store');
  return c.json(result,result.status==='completed'?200:202);
 });
 app.get('/work-deletions',async c=>{
  c.header('Cache-Control','no-store');
  return c.json(await dependencies.workDeletionService.listDeletions(c.get('user').id,parseOptionalOrganizationId(c)));
 });
 app.get('/work-deletions/:id',async c=>{
  c.header('Cache-Control','no-store');
  return c.json(await dependencies.workDeletionService.getDeletion(c.get('user').id,id(c.req.param('id')),parseOptionalOrganizationId(c)));
 });
 return app;
}
function id(value:string):string{const parsed=idSchema.safeParse(value);if(!parsed.success)throw new ValidationError('Invalid work deletion identifier');return parsed.data;}
