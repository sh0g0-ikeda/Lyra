import { NotFoundError } from '../../domain/errors/index.js';
import { calculatePageGenerationCreditCost, PAGE_GENERATION_INPUT_IMAGE_LIMITS } from '../../domain/constants/generation.js';
import type { DatabaseClient } from '../../lib/db.js';
import { PostgresPageRepository } from '../../repositories/PageRepository.js';
import { PostgresPanelRepository } from '../../repositories/PanelRepository.js';
import { PostgresEntityRepository } from '../../repositories/EntityRepository.js';
import { PostgresCreditRepository } from '../../repositories/CreditRepository.js';
import { PostgresOrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { bindTransaction } from '../../repositories/TransactionBoundDatabase.js';
import { CreditService } from '../credit/CreditService.js';
import { OrganizationService } from '../organization/OrganizationService.js';
import { ensureOwnedEntityReferenceImageKey } from '../storage/StoredImageKeyPolicy.js';
import { collectPageReferenceImages } from './PageReferenceIdentity.js';

export type PageGenerationBlockerCode = 'GENERATION_DISABLED' | 'FRAME_REQUIRED' | 'PANEL_REQUIRED' | 'FRAME_PANEL_MISMATCH' | 'PANEL_ORDER_INVALID' | 'DIALOGUE_SPEAKER_REQUIRED' | 'DIALOGUE_SPEAKER_NOT_IN_PANEL' | 'DIALOGUE_SPEAKER_INVALID' | 'ASSIGNED_ENTITY_INVALID' | 'PAGE_GENERATING' | 'PAGE_REOPEN_REQUIRED' | 'CHARACTER_REFERENCE_REQUIRED' | 'REFERENCE_IMAGE_LIMIT_EXCEEDED' | 'ACTIVE_GENERATION_JOB' | 'INSUFFICIENT_CREDITS';
export interface PageGenerationBlocker {
  code: PageGenerationBlockerCode;
  entityId: string | null;
  field: 'generation' | 'frames' | 'panels' | 'entities' | 'dialogue' | 'status';
  action: 'open_layout' | 'open_panels' | 'open_characters' | 'reopen_page' | 'wait_for_generation' | 'none';
  messageKey: string;
}
export interface PageGenerationReadinessResult {
  ready: boolean;
  blockers: PageGenerationBlocker[];
  warnings: string[];
  estimatedCreditCost: number;
  pageRevision: string;
}

/** No job, quote, debit, draft write or stale-job recovery is performed by this assessment. */
export async function assessSavedPageGeneration(client: DatabaseClient, userId: string, pageId: string, organizationId: string | null, generationEnabled: boolean, checkBalance = true): Promise<PageGenerationReadinessResult> {
  const bound=bindTransaction(client);
  const organizations=new OrganizationService(new PostgresOrganizationRepository(bound,bound));
  if(organizationId!==null) await organizations.requireMembership(organizationId,userId,'generate',client);
  const page=await new PostgresPageRepository(bound).findPageByIdAndUserId(pageId,userId,organizationId);
  if(!page) throw new NotFoundError('Page not found');
  const panels=await new PostgresPanelRepository(bound).findPanelsByPageIdAndUserId(pageId,userId,organizationId);
  const blockers:PageGenerationBlocker[]=[];
  const add=(code:PageGenerationBlockerCode,field:PageGenerationBlocker['field'],action:PageGenerationBlocker['action'],messageKey:string,entityId:string|null=null):void=>{
    if(!blockers.some(item=>item.code===code&&item.entityId===entityId)) blockers.push({code,entityId,field,action,messageKey});
  };
  const actor=await client.query<{account_deletion_started_at:Date|null;account_deleted_at:Date|null}>('SELECT account_deletion_started_at,account_deleted_at FROM users WHERE id=$1::uuid',[userId]);
  const unavailableActor=!actor.rows[0] || actor.rows[0].account_deletion_started_at!==null || actor.rows[0].account_deleted_at!==null;
  if(!generationEnabled||unavailableActor)add('GENERATION_DISABLED','generation','none','page.blocker.generationDisabled');
  if(page.frameCount===0)add('FRAME_REQUIRED','frames','open_layout','page.blocker.frameRequired');
  if(panels.length===0)add('PANEL_REQUIRED','panels','open_panels','page.blocker.panelRequired');
  if(page.frameCount!==panels.length)add('FRAME_PANEL_MISMATCH','frames','open_layout','page.blocker.framePanelMismatch');
  if(![...panels].sort((a,b)=>a.order-b.order).every((panel,index)=>panel.order===index+1))add('PANEL_ORDER_INVALID','panels','open_panels','page.blocker.panelOrderInvalid');
  if(page.status==='generating')add('PAGE_GENERATING','status','wait_for_generation','page.blocker.pageGenerating');
  if(page.status==='confirmed')add('PAGE_REOPEN_REQUIRED','status','reopen_page','page.blocker.pageReopenRequired');
  const active=await client.query(`SELECT id FROM generation_jobs WHERE status IN ('queued','processing') AND ((job_type='page_generate' AND params->>'page_id'=$1) OR (job_type IN ('episode_story_autofill','episode_page_skeleton') AND params->>'episode_id'=$2)) LIMIT 1`,[pageId,page.episodeId]);
  if(active.rows.length)add('ACTIVE_GENERATION_JOB','generation','wait_for_generation','page.blocker.activeGenerationJob');
  const context=await new PostgresPageRepository(bound).findGenerationContextByIdAndUserId(pageId,userId,organizationId);
  if(!context)throw new NotFoundError('Page not found');
  const repository=new PostgresEntityRepository(bound);
  const entities=await repository.findByWorkIdAndUserId(context.workId,userId,organizationId);
  const entityMap=new Map(entities.map(entity=>[entity.id,entity]));
  const assignments=Array.from(new Map(panels.flatMap(panel=>panel.entities.map(assignment=>[`${assignment.entityId}:${assignment.stateId??'default'}`,{entityId:assignment.entityId,stateId:assignment.stateId}] as const))).values());
  const references=await repository.findResolvedReferenceImagesByAssignmentsAndUserId(assignments,context.workId,userId,organizationId);
  for(const panel of panels){
    for(const assignment of panel.entities){
      const entity=entityMap.get(assignment.entityId);
      if(!entity){add('ASSIGNED_ENTITY_INVALID','entities','open_panels','page.blocker.assignedEntityInvalid',assignment.entityId);continue;}
      const ref=references.find(item=>item.entityId===assignment.entityId&&item.stateId===assignment.stateId);
      const required=entity.entityType==='character'||(ref!==undefined&&ref.stateDescription!==null);
      if((assignment.stateId!==null&&(!ref||!ref.stateExists)) || (required&&(!ref||ref.refId===null||ref.s3Key===null||ref.ownerUserId===null)))add('CHARACTER_REFERENCE_REQUIRED','entities','open_characters','page.blocker.characterReference',assignment.entityId);
      else if(ref?.s3Key&&ref.ownerUserId){try{ensureOwnedEntityReferenceImageKey(ref.s3Key,ref.ownerUserId,assignment.entityId);}catch{add('CHARACTER_REFERENCE_REQUIRED','entities','open_characters','page.blocker.characterReference',assignment.entityId);}}
    }
    for(const line of panel.dialogue){
      if(['speech','thought','shout','whisper'].includes(line.type)&&line.entityId===null)add('DIALOGUE_SPEAKER_REQUIRED','dialogue','open_panels','page.blocker.dialogueSpeakerRequired');
      // Valid off-screen speakers belong to the work but need not be visible assignments.
      if(line.type!=='narration'&&line.entityId!==null&&!entityMap.has(line.entityId))add('DIALOGUE_SPEAKER_INVALID','dialogue','open_panels','page.blocker.dialogueSpeakerInvalid',line.entityId);
    }
  }
  const count=collectPageReferenceImages(assignments,references).length;
  if(count>PAGE_GENERATION_INPUT_IMAGE_LIMITS.MAX_ENTITY_REFERENCE_IMAGES)add('REFERENCE_IMAGE_LIMIT_EXCEEDED','entities','open_panels','page.blocker.referenceImageLimit');
  const estimatedCreditCost=calculatePageGenerationCreditCost(count);
  if(checkBalance){
    let available:number;
    if(organizationId===null)available=(await new CreditService(new PostgresCreditRepository(bound,bound)).getBalance(userId)).totalCredits;
    else{const balance=await organizations.getCreditBalance(userId,organizationId);available=balance.purchasedCredits+(balance.monthlyExpiresAt!==null&&balance.monthlyExpiresAt.getTime()<=Date.now()?0:balance.monthlyCredits);}
    if(available<estimatedCreditCost)add('INSUFFICIENT_CREDITS','generation','none','page.blocker.insufficientCredits');
  }
  return {ready:blockers.length===0,blockers,warnings:[],estimatedCreditCost,pageRevision:page.updatedAt.toISOString()};
}
