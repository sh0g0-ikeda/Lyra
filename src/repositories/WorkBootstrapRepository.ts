import type { QueryResultRow } from 'pg';
import { ConflictError, ForbiddenError } from '../domain/errors/index.js';
import type { Chapter, Episode, Work } from '../domain/types/story.js';
import type { CreateWorkBootstrapInput, WorkBootstrapResult, WorkCreationMetadata, WorkBootstrapMode } from '../domain/types/workBootstrap.js';
import type { DatabaseClient, TransactionRunner } from '../lib/db.js';
import type { WorkBootstrapRepositoryPort } from '../services/story/WorkBootstrapService.js';

interface WorkRow extends QueryResultRow { id:string; user_id:string; organization_id:string|null; title:string; genre:string|null; world_setting:string|null; theme:string|null; main_entity_ids:string[]; starting_point:string|null; ending_point:string|null; overall_flow:string|null; version:number; edit_history:unknown; status:'draft'|'reviewing'|'ready'; created_at:Date; updated_at:Date; }
interface ChapterRow extends QueryResultRow { id:string; work_id:string; order:number; title:string|null; purpose:string|null; starting_state:string|null; ending_state:string|null; emotion_curve:string|null; entities_involved:string[]; key_beats:string[]; version:number; edit_history:unknown; status:'draft'|'reviewing'|'ready'; created_at:Date; updated_at:Date; }
interface EpisodeRow extends QueryResultRow { id:string; chapter_id:string; order:number; title:string|null; purpose:string|null; story_input_mode:'structured'|'full'; story_full_draft:string|null; introduction:string|null; middle:string|null; climax:string|null; ending_hook:string|null; estimated_pages:number; entities_involved:string[]; page_skeleton_generated:boolean; version:number; edit_history:unknown; status:'draft'|'reviewing'|'ready'; created_at:Date; updated_at:Date; }
interface MetadataRow extends QueryResultRow { work_id:string; mode:WorkBootstrapMode; entry_chapter_id:string|null; entry_episode_id:string|null; }
interface GraphRow extends WorkRow {
  chapter_id:string; chapter_work_id:string; chapter_order:number; chapter_title:string|null; chapter_purpose:string|null;
  chapter_starting_state:string|null; chapter_ending_state:string|null; chapter_emotion_curve:string|null;
  chapter_entities_involved:string[]; chapter_key_beats:string[]; chapter_version:number; chapter_status:'draft'|'reviewing'|'ready'; chapter_created_at:Date; chapter_updated_at:Date;
  episode_id:string; episode_chapter_id:string; episode_order:number; episode_title:string|null; episode_purpose:string|null;
  episode_entities_involved:string[]; episode_version:number; episode_status:'draft'|'reviewing'|'ready'; episode_created_at:Date; episode_updated_at:Date;
}

export class PostgresWorkBootstrapRepository implements WorkBootstrapRepositoryPort {
  public constructor(private readonly db: DatabaseClient & TransactionRunner) {}

  public async create(actorUserId: string, input: CreateWorkBootstrapInput): Promise<WorkBootstrapResult> {
    return this.db.transaction(async (client) => {
      // Serialize the idempotency key before the initial read: a unique-index
      // conflict must never turn a concurrent retry into a duplicate graph.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${actorUserId}:${input.organizationId ?? 'personal'}:${input.requestId}`]);
      if (input.organizationId !== null) await this.assertEditableOrganization(client, actorUserId, input.organizationId);
      const prior = await client.query<MetadataRow & { requested_title:string; ledger_work_id:string|null }>(`SELECT m.work_id,m.mode,m.entry_chapter_id,m.entry_episode_id,l.requested_title,l.work_id AS ledger_work_id FROM work_bootstrap_request_ledger l LEFT JOIN work_creation_metadata m ON m.work_id=l.work_id WHERE l.actor_user_id=$1::uuid AND l.organization_id IS NOT DISTINCT FROM $2::uuid AND l.request_id=$3::uuid FOR UPDATE OF l`, [actorUserId, input.organizationId, input.requestId]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].mode !== input.mode || prior.rows[0].requested_title !== input.title) throw new ConflictError('request_id payload does not match');
        if (prior.rows[0].ledger_work_id === null) throw new ConflictError('Bootstrap request is no longer available');
        const replay = await this.readGraph(client, prior.rows[0].work_id, prior.rows[0].entry_chapter_id, prior.rows[0].entry_episode_id);
        if (replay === null) throw new ConflictError('Bootstrap result is no longer available');
        return { ...replay, mode: input.mode };
      }
      const ledger = await client.query(`INSERT INTO work_bootstrap_request_ledger(actor_user_id,organization_id,request_id,requested_title,mode) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) ON CONFLICT DO NOTHING RETURNING request_id`, [actorUserId,input.organizationId,input.requestId,input.title,input.mode]);
      if (ledger.rows.length === 0) throw new ConflictError('Bootstrap request is being retried');
      const work = (await client.query<WorkRow>(`INSERT INTO works(user_id,organization_id,title,genre,world_setting,theme,main_entity_ids,starting_point,ending_point,overall_flow) VALUES($1::uuid,$2::uuid,$3,NULL,NULL,NULL,'{}'::uuid[],NULL,NULL,NULL) RETURNING *`, [actorUserId,input.organizationId,input.title])).rows[0];
      if (work === undefined) throw new ConflictError('Work bootstrap failed');
      const chapter = (await client.query<ChapterRow>(`INSERT INTO chapters(work_id,"order",title,purpose,starting_state,ending_state,emotion_curve,entities_involved,key_beats) VALUES($1::uuid,1,'第1章',NULL,NULL,NULL,NULL,'{}'::uuid[],'{}'::text[]) RETURNING *`, [work.id])).rows[0];
      if (chapter === undefined) throw new ConflictError('Work bootstrap failed');
      const episodeTitle = input.mode === 'one_shot' ? input.title : '第1話';
      const episode = (await client.query<EpisodeRow>(`INSERT INTO episodes(chapter_id,"order",title,purpose,story_input_mode,story_full_draft,introduction,middle,climax,ending_hook,estimated_pages,entities_involved) VALUES($1::uuid,1,$2,NULL,'structured',NULL,NULL,NULL,NULL,NULL,4,'{}'::uuid[]) RETURNING *`, [chapter.id,episodeTitle])).rows[0];
      if (episode === undefined) throw new ConflictError('Work bootstrap failed');
      await client.query(`INSERT INTO work_creation_metadata(work_id,actor_user_id,organization_id,request_id,mode,entry_chapter_id,entry_episode_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid)`, [work.id,actorUserId,input.organizationId,input.requestId,input.mode,chapter.id,episode.id]);
      await client.query(`UPDATE work_bootstrap_request_ledger SET work_id=$4::uuid WHERE actor_user_id=$1::uuid AND organization_id IS NOT DISTINCT FROM $2::uuid AND request_id=$3::uuid`, [actorUserId,input.organizationId,input.requestId,work.id]);
      if (input.organizationId !== null) {
        await client.query(`
          INSERT INTO organization_audit_logs
            (organization_id, actor_user_id, action, target_type, target_id, metadata)
          VALUES ($1::uuid, $2::uuid, 'work.bootstrap_created', 'work', $3::uuid,
            jsonb_build_object('mode', $4::text))
        `, [input.organizationId, actorUserId, work.id, input.mode]);
      }
      return { work: mapWork(work), chapter: mapChapter(chapter), episode: mapEpisode(episode), mode: input.mode };
    });
  }

  public async listMetadata(actorUserId: string, organizationId: string | null, workIds: string[]): Promise<WorkCreationMetadata[]> {
    if (workIds.length === 0) return [];
    const result = await this.db.query<MetadataRow>(`SELECT m.work_id,m.mode,m.entry_chapter_id,m.entry_episode_id FROM work_creation_metadata m JOIN works w ON w.id=m.work_id WHERE m.work_id=ANY($1::uuid[]) AND (($3::uuid IS NULL AND w.user_id=$2::uuid AND w.organization_id IS NULL) OR ($3::uuid IS NOT NULL AND w.organization_id=$3::uuid AND EXISTS(SELECT 1 FROM organization_members om JOIN organizations o ON o.id=om.organization_id WHERE om.organization_id=w.organization_id AND om.user_id=$2::uuid AND om.status='active' AND om.role IN ('owner','admin','editor','viewer') AND o.status IN ('active','trialing','past_due')))) AND w.deletion_started_at IS NULL`, [workIds,actorUserId,organizationId]);
    return result.rows.map((row) => ({ workId:row.work_id,mode:row.mode,entryChapterId:row.entry_chapter_id,entryEpisodeId:row.entry_episode_id }));
  }

  private async assertEditableOrganization(client: DatabaseClient, userId: string, organizationId: string): Promise<void> {
    const membership = await client.query(`SELECT 1 FROM organizations o JOIN organization_members om ON om.organization_id=o.id WHERE o.id=$1::uuid AND o.status IN ('active','trialing') AND om.user_id=$2::uuid AND om.status='active' AND om.role IN ('owner','admin','editor') FOR SHARE`, [organizationId,userId]);
    if (membership.rows.length !== 1) throw new ForbiddenError('You do not have permission for this organization action');
  }

  private async readGraph(client: DatabaseClient, workId: string, chapterId: string | null, episodeId: string | null): Promise<Omit<WorkBootstrapResult,'mode'> | null> {
    if (chapterId === null || episodeId === null) return null;
    const result = await client.query<GraphRow>(`
      SELECT w.*, c.id AS chapter_id, c.work_id AS chapter_work_id, c."order" AS chapter_order,
        c.title AS chapter_title, c.purpose AS chapter_purpose, c.starting_state AS chapter_starting_state,
        c.ending_state AS chapter_ending_state, c.emotion_curve AS chapter_emotion_curve,
        c.entities_involved AS chapter_entities_involved, c.key_beats AS chapter_key_beats,
        c.version AS chapter_version, c.status AS chapter_status, c.created_at AS chapter_created_at,
        c.updated_at AS chapter_updated_at, e.id AS episode_id, e.chapter_id AS episode_chapter_id,
        e."order" AS episode_order, e.title AS episode_title, e.purpose AS episode_purpose,
        e.story_input_mode, e.story_full_draft, e.introduction, e.middle, e.climax, e.ending_hook,
        e.estimated_pages, e.entities_involved AS episode_entities_involved, e.page_skeleton_generated,
        e.version AS episode_version, e.status AS episode_status, e.created_at AS episode_created_at,
        e.updated_at AS episode_updated_at
      FROM works w JOIN chapters c ON c.id=$2::uuid AND c.work_id=w.id
      JOIN episodes e ON e.id=$3::uuid AND e.chapter_id=c.id
      WHERE w.id=$1::uuid AND w.deletion_started_at IS NULL
    `, [workId,chapterId,episodeId]);
    const row = result.rows[0]; if (row === undefined) return null;
    return { work:mapWork(row), chapter:{ id:row.chapter_id,workId:row.chapter_work_id,order:row.chapter_order,title:row.chapter_title,purpose:row.chapter_purpose,startingState:row.chapter_starting_state,endingState:row.chapter_ending_state,emotionCurve:row.chapter_emotion_curve,entitiesInvolved:row.chapter_entities_involved,keyBeats:row.chapter_key_beats,version:row.chapter_version,editHistory:[],status:row.chapter_status,createdAt:row.chapter_created_at,updatedAt:row.chapter_updated_at }, episode:{ id:row.episode_id,chapterId:row.episode_chapter_id,order:row.episode_order,title:row.episode_title,purpose:row.episode_purpose,storyInputMode:row.story_input_mode,storyFullDraft:row.story_full_draft,introduction:row.introduction,middle:row.middle,climax:row.climax,endingHook:row.ending_hook,estimatedPages:row.estimated_pages,entitiesInvolved:row.episode_entities_involved,pageSkeletonGenerated:row.page_skeleton_generated,version:row.episode_version,editHistory:[],status:row.episode_status,createdAt:row.episode_created_at,updatedAt:row.episode_updated_at } };
  }
}

function mapWork(row: WorkRow): Work { return {id:row.id,userId:row.user_id,organizationId:row.organization_id,title:row.title,genre:row.genre,worldSetting:row.world_setting,theme:row.theme,mainEntityIds:row.main_entity_ids,startingPoint:row.starting_point,endingPoint:row.ending_point,overallFlow:row.overall_flow,version:row.version,editHistory:[],status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}; }
function mapChapter(row: ChapterRow): Chapter { return {id:row.id,workId:row.work_id,order:row.order,title:row.title,purpose:row.purpose,startingState:row.starting_state,endingState:row.ending_state,emotionCurve:row.emotion_curve,entitiesInvolved:row.entities_involved,keyBeats:row.key_beats,version:row.version,editHistory:[],status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}; }
function mapEpisode(row: EpisodeRow): Episode { return {id:row.id,chapterId:row.chapter_id,order:row.order,title:row.title,purpose:row.purpose,storyInputMode:row.story_input_mode,storyFullDraft:row.story_full_draft,introduction:row.introduction,middle:row.middle,climax:row.climax,endingHook:row.ending_hook,estimatedPages:row.estimated_pages,entitiesInvolved:row.entities_involved,pageSkeletonGenerated:row.page_skeleton_generated,version:row.version,editHistory:[],status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}; }
