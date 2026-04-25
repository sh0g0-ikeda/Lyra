import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  BookOpen,
  Bot,
  Check,
  CreditCard,
  Image,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  PanelsTopLeft,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { ApiError, decodeJwtPayload, LyraApiClient } from './lib/api';
import { createSupabaseBrowserClient } from './lib/supabase';
import type {
  BalloonRecord,
  ChapterRecord,
  EntityRecord,
  EpisodeRecord,
  GenerationJobRecord,
  PanelRecord,
  SceneRecord,
  WorkRecord,
} from './types/api';

type WorkspaceTab = 'story' | 'entities' | 'pages';

interface NoticeState {
  type: 'error' | 'success';
  message: string;
}

interface WorkDraft {
  title: string;
  genre: string;
  world_setting: string;
  theme: string;
  main_entity_ids: string;
  starting_point: string;
  ending_point: string;
  overall_flow: string;
  status: 'draft' | 'reviewing' | 'ready';
}

interface ChapterDraft {
  order: string;
  title: string;
  purpose: string;
  starting_state: string;
  ending_state: string;
  emotion_curve: string;
  entities_involved: string;
  key_beats: string;
  status: 'draft' | 'reviewing' | 'ready';
}

interface EpisodeDraft {
  order: string;
  title: string;
  purpose: string;
  introduction: string;
  middle: string;
  climax: string;
  ending_hook: string;
  estimated_pages: string;
  entities_involved: string;
  status: 'draft' | 'reviewing' | 'ready';
}

interface EntityDraft {
  entity_type: 'character' | 'nonhuman' | 'object';
  name: string;
  free_description: string;
  prompt_supplement: string;
  structured_fields: string;
  speech_profile: string;
}

interface SceneDraft {
  order: string;
  location: string;
  time: string;
  atmosphere: string;
  involved_entity_ids: string;
  status: 'draft' | 'reviewing' | 'ready';
}

interface PanelDraft {
  order: string;
  panel_role: 'setup' | 'build' | 'payoff';
  panel_size: 'small' | 'medium' | 'large';
  situation_text: string;
  composition_json: string;
  dialogue_json: string;
  dialogue_in_panel: boolean;
  sfx_text: string;
  background_note: string;
  panel_notes: string;
  assignments_json: string;
}

interface BalloonDraft {
  speaker_entity_id: string;
  balloon_type: 'speech' | 'thought' | 'narration' | 'shout' | 'whisper';
  writing_mode: 'horizontal' | 'vertical';
  text: string;
  position_json: string;
  tail_json: string;
  font_size: string;
  font_family: string;
  panel_order_reference: string;
  z_index: string;
}

const manualTokenStorageKey = 'lyra:web:manual-token';
const trackedJobsStorageKey = 'lyra:web:tracked-jobs';
const selectedWorkStorageKey = 'lyra:web:selected-work';
const selectedChapterStorageKey = 'lyra:web:selected-chapter';
const selectedEpisodeStorageKey = 'lyra:web:selected-episode';
const selectedPageStorageKey = 'lyra:web:selected-page';
const supabase = createSupabaseBrowserClient();

export default function App() {
  const [manualToken, setManualToken] = useStoredString(window.sessionStorage, manualTokenStorageKey, '');
  const [supabaseSession, setSupabaseSession] = useState<Session | null>(null);
  const [pendingAuth, setPendingAuth] = useState(true);

  useEffect(() => {
    if (supabase === null) {
      setPendingAuth(false);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSupabaseSession(data.session);
        setPendingAuth(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseSession(session);
      setPendingAuth(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (pendingAuth) {
    return (
      <div className="screen-center">
        <LoaderCircle className="spin" size={24} />
      </div>
    );
  }

  const accessToken = supabaseSession?.access_token ?? (manualToken.length > 0 ? manualToken : null);
  if (accessToken === null) {
    return <AuthScreen manualToken={manualToken} onManualTokenChange={setManualToken} supabaseClient={supabase} />;
  }

  const payload = decodeJwtPayload(accessToken);
  const email =
    (typeof payload?.email === 'string' ? payload.email : null) ??
    supabaseSession?.user.email ??
    'session';

  return (
    <StudioShell
      email={email}
      token={accessToken}
      supabaseClient={supabase}
      onLogout={async () => {
        if (supabase !== null) {
          await supabase.auth.signOut();
        }
        setManualToken('');
      }}
    />
  );
}

function AuthScreen(props: {
  manualToken: string;
  onManualTokenChange: (nextValue: string) => void;
  supabaseClient: SupabaseClient | null;
}) {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftToken, setDraftToken] = useState(props.manualToken);

  const submitMagicLink = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (props.supabaseClient === null) {
      setNotice({ type: 'error', message: 'Supabase client is not configured.' });
      return;
    }

    try {
      setBusy(true);
      const { error } = await props.supabaseClient.auth.signInWithOtp({ email });
      if (error !== null) {
        throw error;
      }
      setNotice({ type: 'success', message: 'Magic link sent.' });
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="eyebrow">Lyra</div>
        <h1>Production Console</h1>
        <p className="muted">Story, entity, page, balloon, billing.</p>
        {notice !== null ? <NoticeBanner notice={notice} /> : null}
        {props.supabaseClient !== null ? (
          <form className="stack" onSubmit={submitMagicLink}>
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              Send magic link
            </button>
          </form>
        ) : null}
        <div className="divider" />
        <div className="stack">
          <label className="field">
            <span>Manual bearer token</span>
            <textarea
              rows={6}
              value={draftToken}
              onChange={(event) => setDraftToken(event.target.value)}
              spellCheck={false}
            />
          </label>
          <button
            className="secondary-button"
            onClick={() => props.onManualTokenChange(draftToken.trim())}
            type="button"
          >
            <KeyRound size={16} />
            Use token
          </button>
        </div>
      </div>
    </div>
  );
}

function StudioShell(props: {
  email: string;
  token: string;
  supabaseClient: SupabaseClient | null;
  onLogout: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const api = useMemo(() => new LyraApiClient(() => props.token), [props.token]);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [trackedJobIds, setTrackedJobIds] = useStoredString(window.localStorage, trackedJobsStorageKey, '[]');
  const [selectedWorkId, setSelectedWorkId] = useStoredString(window.localStorage, selectedWorkStorageKey, '');
  const [selectedChapterId, setSelectedChapterId] = useStoredString(window.localStorage, selectedChapterStorageKey, '');
  const [selectedEpisodeId, setSelectedEpisodeId] = useStoredString(window.localStorage, selectedEpisodeStorageKey, '');
  const [selectedPageId, setSelectedPageId] = useStoredString(window.localStorage, selectedPageStorageKey, '');
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('story');
  const [workDraft, setWorkDraft] = useState<WorkDraft>(createEmptyWorkDraft());
  const [newWorkDraft, setNewWorkDraft] = useState<WorkDraft>(createEmptyWorkDraft());
  const [chapterDraft, setChapterDraft] = useState<ChapterDraft>(createEmptyChapterDraft());
  const [newChapterDraft, setNewChapterDraft] = useState<ChapterDraft>(createEmptyChapterDraft());
  const [episodeDraft, setEpisodeDraft] = useState<EpisodeDraft>(createEmptyEpisodeDraft());
  const [newEpisodeDraft, setNewEpisodeDraft] = useState<EpisodeDraft>(createEmptyEpisodeDraft());
  const [storyInstruction, setStoryInstruction] = useState('');
  const [storyStream, setStoryStream] = useState('');
  const [storyBusy, setStoryBusy] = useState(false);
  const [entityDraft, setEntityDraft] = useState<EntityDraft>(createEmptyEntityDraft());
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [sceneDraft, setSceneDraft] = useState<SceneDraft>(createEmptySceneDraft());
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [panelDraft, setPanelDraft] = useState<PanelDraft>(createEmptyPanelDraft());
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [balloonDraft, setBalloonDraft] = useState<BalloonDraft>(createEmptyBalloonDraft());
  const [selectedBalloonId, setSelectedBalloonId] = useState('');
  const [frameTemplateId, setFrameTemplateId] = useState('3-panel-standard');
  const [framesJson, setFramesJson] = useState('[]');
  const [importingImage, setImportingImage] = useState(false);
  const [referenceSelection, setReferenceSelection] = useState<string[]>([]);
  const [referencePrimaryKey, setReferencePrimaryKey] = useState('');
  const handledJobsRef = useRef<Set<string>>(new Set());

  const trackedJobList = useMemo(() => parseTrackedJobIds(trackedJobIds), [trackedJobIds]);

  const worksQuery = useQuery({
    queryKey: ['works'],
    queryFn: () => api.getWorks(),
  });
  const balanceQuery = useQuery({
    queryKey: ['billing-balance'],
    queryFn: () => api.getBalance(),
  });

  const selectedWork = worksQuery.data?.works.find((work) => work.id === selectedWorkId) ?? null;

  const chaptersQuery = useQuery({
    queryKey: ['chapters', selectedWorkId],
    queryFn: () => api.getChapters(selectedWorkId),
    enabled: selectedWorkId.length > 0,
  });
  const chapters = chaptersQuery.data?.chapters ?? [];
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null;

  const episodesQuery = useQuery({
    queryKey: ['episodes', selectedChapter?.id ?? ''],
    queryFn: () => api.getEpisodes(selectedChapter?.id ?? ''),
    enabled: selectedChapter !== null,
  });
  const episodes = episodesQuery.data?.episodes ?? [];
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId) ?? episodes[0] ?? null;

  const entitiesQuery = useQuery({
    queryKey: ['entities', selectedWorkId],
    queryFn: () => api.getEntities(selectedWorkId),
    enabled: selectedWorkId.length > 0,
  });
  const entities = entitiesQuery.data?.entities ?? [];
  const selectedEntity = entities.find((entity) => entity.id === selectedEntityId) ?? entities[0] ?? null;

  const entityReferenceSetQuery = useQuery({
    queryKey: ['entity-reference-set', selectedEntity?.id ?? ''],
    queryFn: () => api.getEntityReferenceSet(selectedEntity?.id ?? ''),
    enabled: selectedEntity !== null,
  });

  const scenesQuery = useQuery({
    queryKey: ['scenes', selectedEpisode?.id ?? ''],
    queryFn: () => api.getScenes(selectedEpisode?.id ?? ''),
    enabled: selectedEpisode !== null,
  });
  const scenes = scenesQuery.data?.scenes ?? [];
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0] ?? null;

  const pagesQuery = useQuery({
    queryKey: ['pages', selectedEpisode?.id ?? ''],
    queryFn: () => api.getPages(selectedEpisode?.id ?? ''),
    enabled: selectedEpisode !== null,
  });
  const pages = pagesQuery.data?.pages ?? [];
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;

  const compositionsQuery = useQuery({
    queryKey: ['compositions'],
    queryFn: () => api.getCompositions(),
  });
  const compositions = compositionsQuery.data?.compositions ?? [];

  const panelsQuery = useQuery({
    queryKey: ['panels', selectedPage?.id ?? ''],
    queryFn: () => api.getPanels(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const panels = panelsQuery.data?.panels ?? [];
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) ?? panels[0] ?? null;

  const framesQuery = useQuery({
    queryKey: ['frames', selectedPage?.id ?? ''],
    queryFn: () => api.getFrames(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const frames = framesQuery.data?.frames ?? [];

  const balloonsQuery = useQuery({
    queryKey: ['balloons', selectedPage?.id ?? ''],
    queryFn: () => api.getBalloons(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const balloons = balloonsQuery.data?.balloons ?? [];
  const selectedBalloon = balloons.find((balloon) => balloon.id === selectedBalloonId) ?? balloons[0] ?? null;

  const jobQueries = useQueries({
    queries: trackedJobList.map((jobId) => ({
      queryKey: ['job', jobId],
      queryFn: () => api.getJob(jobId),
      refetchInterval: (query: { state: { data: GenerationJobRecord | undefined } }) =>
        query.state.data?.status === 'queued' || query.state.data?.status === 'processing' ? 4000 : false,
    })),
  });
  const jobs = jobQueries.map((query) => query.data).filter(isDefined);

  useEffect(() => {
    if (worksQuery.data?.works === undefined) {
      return;
    }

    if (!worksQuery.data.works.some((work) => work.id === selectedWorkId)) {
      setSelectedWorkId(worksQuery.data.works[0]?.id ?? '');
    }
  }, [selectedWorkId, setSelectedWorkId, worksQuery.data]);

  useEffect(() => {
    if (!chapters.some((chapter) => chapter.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0]?.id ?? '');
    }
  }, [chapters, selectedChapterId, setSelectedChapterId]);

  useEffect(() => {
    if (!episodes.some((episode) => episode.id === selectedEpisodeId)) {
      setSelectedEpisodeId(episodes[0]?.id ?? '');
    }
  }, [episodes, selectedEpisodeId, setSelectedEpisodeId]);

  useEffect(() => {
    if (!pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(pages[0]?.id ?? '');
    }
  }, [pages, selectedPageId, setSelectedPageId]);

  useEffect(() => {
    if (!entities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(entities[0]?.id ?? '');
    }
  }, [entities, selectedEntityId]);

  useEffect(() => {
    if (!scenes.some((scene) => scene.id === selectedSceneId)) {
      setSelectedSceneId(scenes[0]?.id ?? '');
    }
  }, [scenes, selectedSceneId]);

  useEffect(() => {
    if (!panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(panels[0]?.id ?? '');
    }
  }, [panels, selectedPanelId]);

  useEffect(() => {
    if (!balloons.some((balloon) => balloon.id === selectedBalloonId)) {
      setSelectedBalloonId(balloons[0]?.id ?? '');
    }
  }, [balloons, selectedBalloonId]);

  useEffect(() => {
    if (selectedWork !== null) {
      setWorkDraft(toWorkDraft(selectedWork));
    }
  }, [selectedWork]);

  useEffect(() => {
    if (selectedChapter !== null) {
      setChapterDraft(toChapterDraft(selectedChapter));
    }
  }, [selectedChapter]);

  useEffect(() => {
    if (selectedEpisode !== null) {
      setEpisodeDraft(toEpisodeDraft(selectedEpisode));
    }
  }, [selectedEpisode]);

  useEffect(() => {
    if (selectedEntity !== null) {
      setEntityDraft(toEntityDraft(selectedEntity));
    }
  }, [selectedEntity]);

  useEffect(() => {
    if (selectedScene !== null) {
      setSceneDraft(toSceneDraft(selectedScene));
    }
  }, [selectedScene]);

  useEffect(() => {
    if (selectedPanel !== null) {
      setPanelDraft(toPanelDraft(selectedPanel));
    }
  }, [selectedPanel]);

  useEffect(() => {
    if (selectedBalloon !== null) {
      setBalloonDraft(toBalloonDraft(selectedBalloon));
    }
  }, [selectedBalloon]);

  useEffect(() => {
    setFramesJson(JSON.stringify(frames, null, 2));
  }, [frames]);

  useEffect(() => {
    for (const job of jobs) {
      if (handledJobsRef.current.has(job.id)) {
        continue;
      }

      if (job.status === 'completed' || job.status === 'failed') {
        handledJobsRef.current.add(job.id);
        void queryClient.invalidateQueries({ queryKey: ['billing-balance'] });

        if (job.job_type === 'page_generate') {
          const pageId = typeof job.params.page_id === 'string' ? job.params.page_id : null;
          if (pageId !== null) {
            void queryClient.invalidateQueries({ queryKey: ['panels', pageId] });
            void queryClient.invalidateQueries({ queryKey: ['frames', pageId] });
            void queryClient.invalidateQueries({ queryKey: ['balloons', pageId] });
          }

          void queryClient.invalidateQueries({ queryKey: ['pages'] });
        }
        if (job.job_type === 'entity_generate') {
          const entityId = typeof job.params.entity_id === 'string' ? job.params.entity_id : null;
          if (entityId !== null) {
            void queryClient.invalidateQueries({ queryKey: ['entity-reference-set', entityId] });
          }
        }
      }
    }
  }, [jobs, queryClient]);

  const latestReferenceCandidates = useMemo(() => {
    if (selectedEntity === null) {
      return [];
    }

    for (const job of [...jobs].reverse()) {
      if (
        job.job_type === 'entity_generate' &&
        job.status === 'completed' &&
        job.params.entity_id === selectedEntity.id &&
        Array.isArray(job.result?.candidates)
      ) {
        return (job.result.candidates as unknown[]).flatMap((candidate) => {
          if (
            typeof candidate !== 'object' ||
            candidate === null ||
            Array.isArray(candidate) ||
            typeof (candidate as { s3_key?: unknown }).s3_key !== 'string' ||
            typeof (candidate as { cdn_url?: unknown }).cdn_url !== 'string'
          ) {
            return [];
          }

          return [
            {
              s3_key: (candidate as { s3_key: string }).s3_key,
              cdn_url: (candidate as { cdn_url: string }).cdn_url,
            },
          ];
        });
      }
    }

    return [];
  }, [jobs, selectedEntity]);

  useEffect(() => {
    const hasSelectionForCurrentCandidates = latestReferenceCandidates.some((candidate) =>
      referenceSelection.includes(candidate.s3_key),
    );

    if (latestReferenceCandidates.length > 0 && !hasSelectionForCurrentCandidates) {
      setReferenceSelection(latestReferenceCandidates.map((candidate) => candidate.s3_key));
      setReferencePrimaryKey(latestReferenceCandidates[0]?.s3_key ?? '');
    }
  }, [latestReferenceCandidates, referenceSelection]);

  const runAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      setBusyAction(label);
      await action();
      setNotice({ type: 'success', message: `${label} completed.` });
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const trackJob = (jobId: string): void => {
    setTrackedJobIds(JSON.stringify(Array.from(new Set([jobId, ...trackedJobList])).slice(0, 24)));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-title">Lyra</div>
            <div className="brand-subtitle">production console</div>
          </div>
        </div>
        <section className="sidebar-section">
          <div className="section-header">
            <h2>Works</h2>
            <span className="badge">{worksQuery.data?.works.length ?? 0}</span>
          </div>
          <div className="stack gap-xs">
            {(worksQuery.data?.works ?? []).map((work) => (
              <button
                key={work.id}
                className={`nav-item ${selectedWorkId === work.id ? 'active' : ''}`}
                onClick={() => setSelectedWorkId(work.id)}
                type="button"
              >
                <BookOpen size={16} />
                <span>{work.title}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="sidebar-section">
          <div className="section-header">
            <h2>New work</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction('Create work', async () => {
                await api.createWork(toWorkPayload(newWorkDraft));
                setNewWorkDraft(createEmptyWorkDraft());
                await queryClient.invalidateQueries({ queryKey: ['works'] });
              });
            }}
          >
            <label className="field">
              <span>Title</span>
              <input
                required
                value={newWorkDraft.title}
                onChange={(event) => setNewWorkDraft({ ...newWorkDraft, title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Genre</span>
              <input
                value={newWorkDraft.genre}
                onChange={(event) => setNewWorkDraft({ ...newWorkDraft, genre: event.target.value })}
              />
            </label>
            <button className="primary-button" disabled={busyAction === 'Create work'} type="submit">
              {busyAction === 'Create work' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              Create
            </button>
          </form>
        </section>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">Signed in</div>
            <strong>{props.email}</strong>
          </div>
          <div className="toolbar">
            <button className={`tab-button ${activeTab === 'story' ? 'active' : ''}`} onClick={() => setActiveTab('story')} type="button">
              <Bot size={16} />
              Story
            </button>
            <button className={`tab-button ${activeTab === 'entities' ? 'active' : ''}`} onClick={() => setActiveTab('entities')} type="button">
              <Image size={16} />
              Entities
            </button>
            <button className={`tab-button ${activeTab === 'pages' ? 'active' : ''}`} onClick={() => setActiveTab('pages')} type="button">
              <PanelsTopLeft size={16} />
              Pages
            </button>
            <button className="ghost-button" onClick={() => void props.onLogout()} type="button">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {notice !== null ? <NoticeBanner notice={notice} /> : null}

        {selectedWork === null ? (
          <section className="empty-state">
            <LayoutGrid size={28} />
            <h2>No work selected</h2>
          </section>
        ) : (
          <div className="workspace-grid">
            <section className="main-column">
              <PanelSection
                title={selectedWork.title}
                subtitle={`status ${selectedWork.status}`}
                actions={
                  <button
                    className="secondary-button"
                    disabled={busyAction === 'Save work'}
                    onClick={() =>
                      void runAction('Save work', async () => {
                        await api.updateWork(selectedWork.id, toWorkPayload(workDraft));
                        await queryClient.invalidateQueries({ queryKey: ['works'] });
                      })
                    }
                    type="button"
                  >
                    {busyAction === 'Save work' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                    Save
                  </button>
                }
              >
                <div className="form-grid two">
                  <InputField label="Title" value={workDraft.title} onChange={(value) => setWorkDraft({ ...workDraft, title: value })} />
                  <InputField label="Genre" value={workDraft.genre} onChange={(value) => setWorkDraft({ ...workDraft, genre: value })} />
                  <InputField label="Theme" value={workDraft.theme} onChange={(value) => setWorkDraft({ ...workDraft, theme: value })} />
                  <SelectField
                    label="Status"
                    value={workDraft.status}
                    onChange={(value) => setWorkDraft({ ...workDraft, status: value as WorkDraft['status'] })}
                    options={[
                      ['draft', 'Draft'],
                      ['reviewing', 'Reviewing'],
                      ['ready', 'Ready'],
                    ]}
                  />
                </div>
                <div className="form-grid two">
                  <TextAreaField
                    label="World"
                    rows={3}
                    value={workDraft.world_setting}
                    onChange={(value) => setWorkDraft({ ...workDraft, world_setting: value })}
                  />
                  <TextAreaField
                    label="Overall flow"
                    rows={3}
                    value={workDraft.overall_flow}
                    onChange={(value) => setWorkDraft({ ...workDraft, overall_flow: value })}
                  />
                </div>
                <div className="form-grid two">
                  <TextAreaField
                    label="Starting point"
                    rows={2}
                    value={workDraft.starting_point}
                    onChange={(value) => setWorkDraft({ ...workDraft, starting_point: value })}
                  />
                  <TextAreaField
                    label="Ending point"
                    rows={2}
                    value={workDraft.ending_point}
                    onChange={(value) => setWorkDraft({ ...workDraft, ending_point: value })}
                  />
                </div>
                <InputField
                  label="Main entity IDs"
                  value={workDraft.main_entity_ids}
                  onChange={(value) => setWorkDraft({ ...workDraft, main_entity_ids: value })}
                />
              </PanelSection>

              <PanelSection
                title="Chapter / Episode"
                actions={
                  <button
                    className="secondary-button"
                    disabled={selectedEpisode === null || busyAction === 'Generate page skeleton'}
                    onClick={() => {
                      if (selectedEpisode === null) {
                        return;
                      }
                      void runAction('Generate page skeleton', async () => {
                        await api.generatePageSkeleton(selectedEpisode.id);
                        await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                      });
                    }}
                    type="button"
                  >
                    {busyAction === 'Generate page skeleton' ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    Generate skeleton
                  </button>
                }
              >
                <div className="story-tree">
                  <div className="tree-column">
                    <h3>Chapters</h3>
                    <div className="stack gap-xs">
                      {chapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          className={`tree-item ${selectedChapter?.id === chapter.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedChapterId(chapter.id);
                            setSelectedEpisodeId('');
                            setSelectedWorkId(selectedWork.id);
                          }}
                          type="button"
                        >
                          <span>{chapter.order}</span>
                          <strong>{chapter.title ?? 'Untitled chapter'}</strong>
                        </button>
                      ))}
                    </div>
                    <form
                      className="stack"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void runAction('Create chapter', async () => {
                          await api.createChapter(selectedWork.id, toChapterPayload(newChapterDraft));
                          setNewChapterDraft(createEmptyChapterDraft());
                          await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
                        });
                      }}
                    >
                      <InputField
                        label="New chapter title"
                        value={newChapterDraft.title}
                        onChange={(value) => setNewChapterDraft({ ...newChapterDraft, title: value })}
                      />
                      <InputField
                        label="Order"
                        value={newChapterDraft.order}
                        onChange={(value) => setNewChapterDraft({ ...newChapterDraft, order: value })}
                      />
                      <button className="ghost-button" type="submit">
                        <Save size={16} />
                        Add chapter
                      </button>
                    </form>
                  </div>

                  <div className="tree-column">
                    {selectedChapter !== null ? (
                      <div className="stack">
                        <InputField label="Chapter title" value={chapterDraft.title} onChange={(value) => setChapterDraft({ ...chapterDraft, title: value })} />
                        <div className="form-grid two">
                          <InputField label="Order" value={chapterDraft.order} onChange={(value) => setChapterDraft({ ...chapterDraft, order: value })} />
                          <SelectField
                            label="Status"
                            value={chapterDraft.status}
                            onChange={(value) => setChapterDraft({ ...chapterDraft, status: value as ChapterDraft['status'] })}
                            options={[
                              ['draft', 'Draft'],
                              ['reviewing', 'Reviewing'],
                              ['ready', 'Ready'],
                            ]}
                          />
                        </div>
                        <TextAreaField label="Purpose" rows={2} value={chapterDraft.purpose} onChange={(value) => setChapterDraft({ ...chapterDraft, purpose: value })} />
                        <div className="toolbar">
                          <button
                            className="ghost-button"
                            onClick={() =>
                              void runAction('Save chapter', async () => {
                                await api.updateChapter(selectedChapter.id, toChapterPayload(chapterDraft));
                                await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            Save chapter
                          </button>
                          <button
                            className="ghost-button danger"
                            onClick={() =>
                              void runAction('Delete chapter', async () => {
                                await api.deleteChapter(selectedChapter.id);
                                await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
                              })
                            }
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <h3>Episodes</h3>
                    <div className="stack gap-xs">
                      {episodes.map((episode) => (
                        <button
                          key={episode.id}
                          className={`tree-item ${selectedEpisodeId === episode.id ? 'active' : ''}`}
                          onClick={() => setSelectedEpisodeId(episode.id)}
                          type="button"
                        >
                          <span>{episode.order}</span>
                          <strong>{episode.title ?? 'Untitled episode'}</strong>
                        </button>
                      ))}
                    </div>
                    {selectedChapter !== null ? (
                      <form
                        className="stack"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void runAction('Create episode', async () => {
                            await api.createEpisode(selectedChapter.id, toEpisodePayload(newEpisodeDraft));
                            setNewEpisodeDraft(createEmptyEpisodeDraft());
                            await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter.id] });
                          });
                        }}
                      >
                        <InputField
                          label="New episode title"
                          value={newEpisodeDraft.title}
                          onChange={(value) => setNewEpisodeDraft({ ...newEpisodeDraft, title: value })}
                        />
                        <InputField
                          label="Order"
                          value={newEpisodeDraft.order}
                          onChange={(value) => setNewEpisodeDraft({ ...newEpisodeDraft, order: value })}
                        />
                        <button className="ghost-button" type="submit">
                          <Save size={16} />
                          Add episode
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </PanelSection>

              {activeTab === 'story' && selectedEpisode !== null ? (
                <>
                  <PanelSection
                    title="Episode draft"
                    actions={
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          disabled={busyAction === 'Save episode'}
                          onClick={() =>
                            void runAction('Save episode', async () => {
                              await api.updateEpisode(selectedEpisode.id, toEpisodePayload(episodeDraft));
                              await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
                            })
                          }
                          type="button"
                        >
                          {busyAction === 'Save episode' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                          Save
                        </button>
                        <button
                          className="ghost-button danger"
                          onClick={() =>
                            void runAction('Delete episode', async () => {
                              await api.deleteEpisode(selectedEpisode.id);
                              await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
                            })
                          }
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    }
                  >
                    <div className="form-grid two">
                      <InputField label="Title" value={episodeDraft.title} onChange={(value) => setEpisodeDraft({ ...episodeDraft, title: value })} />
                      <InputField
                        label="Estimated pages"
                        value={episodeDraft.estimated_pages}
                        onChange={(value) => setEpisodeDraft({ ...episodeDraft, estimated_pages: value })}
                      />
                    </div>
                    <TextAreaField label="Purpose" rows={2} value={episodeDraft.purpose} onChange={(value) => setEpisodeDraft({ ...episodeDraft, purpose: value })} />
                    <div className="form-grid two">
                      <TextAreaField label="Introduction" rows={3} value={episodeDraft.introduction} onChange={(value) => setEpisodeDraft({ ...episodeDraft, introduction: value })} />
                      <TextAreaField label="Middle" rows={3} value={episodeDraft.middle} onChange={(value) => setEpisodeDraft({ ...episodeDraft, middle: value })} />
                    </div>
                    <div className="form-grid two">
                      <TextAreaField label="Climax" rows={3} value={episodeDraft.climax} onChange={(value) => setEpisodeDraft({ ...episodeDraft, climax: value })} />
                      <TextAreaField label="Ending hook" rows={3} value={episodeDraft.ending_hook} onChange={(value) => setEpisodeDraft({ ...episodeDraft, ending_hook: value })} />
                    </div>
                    <InputField
                      label="Entity IDs"
                      value={episodeDraft.entities_involved}
                      onChange={(value) => setEpisodeDraft({ ...episodeDraft, entities_involved: value })}
                    />
                  </PanelSection>

                  <PanelSection
                    title="Story AI"
                    subtitle="Claude Sonnet stream"
                    actions={
                      <button
                        className="primary-button"
                        disabled={storyBusy || storyInstruction.trim().length === 0}
                        onClick={() => {
                          void (async () => {
                            try {
                              setStoryBusy(true);
                              setStoryStream('');
                              await api.streamStoryCollaboration(
                                {
                                  layer: 'episode',
                                  target_id: selectedEpisode.id,
                                  instruction: storyInstruction,
                                  context: {
                                    current_draft: [selectedEpisode.introduction, selectedEpisode.middle, selectedEpisode.climax]
                                      .filter((part) => part !== null && part.length > 0)
                                      .join('\n\n'),
                                    user_notes: selectedEpisode.purpose,
                                    focus_points: selectedEpisode.entities_involved,
                                  },
                                },
                                {
                                  onChunk: (text) => setStoryStream((current) => current + text),
                                },
                              );
                            } catch (error) {
                              setNotice({ type: 'error', message: toMessage(error) });
                            } finally {
                              setStoryBusy(false);
                            }
                          })();
                        }}
                        type="button"
                      >
                        {storyBusy ? <LoaderCircle className="spin" size={16} /> : <Wand2 size={16} />}
                        Collaborate
                      </button>
                    }
                  >
                    <TextAreaField label="Instruction" rows={4} value={storyInstruction} onChange={setStoryInstruction} />
                    <TextAreaField label="Stream" rows={10} value={storyStream} onChange={setStoryStream} />
                  </PanelSection>

                  <PanelSection title="Scenes">
                    <div className="list-grid">
                      {scenes.map((scene) => (
                        <button
                          key={scene.id}
                          className={`mini-card ${selectedScene?.id === scene.id ? 'active' : ''}`}
                          onClick={() => setSelectedSceneId(scene.id)}
                          type="button"
                        >
                          <strong>{scene.order}</strong>
                          <span>{scene.location ?? 'No location'}</span>
                        </button>
                      ))}
                    </div>
                    <div className="form-grid two">
                      <InputField label="Order" value={sceneDraft.order} onChange={(value) => setSceneDraft({ ...sceneDraft, order: value })} />
                      <InputField label="Location" value={sceneDraft.location} onChange={(value) => setSceneDraft({ ...sceneDraft, location: value })} />
                    </div>
                    <div className="form-grid two">
                      <InputField label="Time" value={sceneDraft.time} onChange={(value) => setSceneDraft({ ...sceneDraft, time: value })} />
                      <InputField label="Atmosphere" value={sceneDraft.atmosphere} onChange={(value) => setSceneDraft({ ...sceneDraft, atmosphere: value })} />
                    </div>
                    <InputField
                      label="Entity IDs"
                      value={sceneDraft.involved_entity_ids}
                      onChange={(value) => setSceneDraft({ ...sceneDraft, involved_entity_ids: value })}
                    />
                    <div className="toolbar">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          void runAction('Create scene', async () => {
                            await api.createScene(selectedEpisode.id, toScenePayload(sceneDraft));
                            setSceneDraft(createEmptySceneDraft());
                            await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
                          })
                        }
                        type="button"
                      >
                        <Save size={16} />
                        Add
                      </button>
                      {selectedScene !== null ? (
                        <button
                          className="ghost-button"
                          onClick={() =>
                            void runAction('Save scene', async () => {
                              await api.updateScene(selectedScene.id, toScenePayload(sceneDraft));
                              await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          Save selected
                        </button>
                      ) : null}
                    </div>
                  </PanelSection>
                </>
              ) : null}

              {activeTab === 'entities' && selectedWork !== null ? (
                <>
                  <PanelSection
                    title="Entities"
                    subtitle={`${entities.length} records`}
                    actions={
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setSelectedEntityId('');
                          setEntityDraft(createEmptyEntityDraft());
                        }}
                        type="button"
                      >
                        <RefreshCw size={16} />
                        Reset draft
                      </button>
                    }
                  >
                    <div className="list-grid">
                      {entities.map((entity) => (
                        <button
                          key={entity.id}
                          className={`mini-card ${selectedEntity?.id === entity.id ? 'active' : ''}`}
                          onClick={() => setSelectedEntityId(entity.id)}
                          type="button"
                        >
                          <strong>{entity.name}</strong>
                          <span>{entity.entity_type}</span>
                        </button>
                      ))}
                    </div>
                    <div className="form-grid two">
                      <SelectField
                        label="Type"
                        value={entityDraft.entity_type}
                        onChange={(value) =>
                          setEntityDraft({
                            ...entityDraft,
                            entity_type: value as EntityDraft['entity_type'],
                          })
                        }
                        options={[
                          ['character', 'Character'],
                          ['nonhuman', 'Nonhuman'],
                          ['object', 'Object'],
                        ]}
                      />
                      <InputField label="Name" value={entityDraft.name} onChange={(value) => setEntityDraft({ ...entityDraft, name: value })} />
                    </div>
                    <TextAreaField
                      label="Free description"
                      rows={3}
                      value={entityDraft.free_description}
                      onChange={(value) => setEntityDraft({ ...entityDraft, free_description: value })}
                    />
                    <TextAreaField
                      label="Prompt supplement"
                      rows={3}
                      value={entityDraft.prompt_supplement}
                      onChange={(value) => setEntityDraft({ ...entityDraft, prompt_supplement: value })}
                    />
                    <div className="form-grid two">
                      <TextAreaField
                        label="Structured fields JSON"
                        rows={6}
                        value={entityDraft.structured_fields}
                        onChange={(value) => setEntityDraft({ ...entityDraft, structured_fields: value })}
                      />
                      <TextAreaField
                        label="Speech profile JSON"
                        rows={6}
                        value={entityDraft.speech_profile}
                        onChange={(value) => setEntityDraft({ ...entityDraft, speech_profile: value })}
                      />
                    </div>
                    <div className="toolbar">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          void runAction('Create entity', async () => {
                            await api.createEntity(selectedWork.id, toEntityPayload(entityDraft));
                            setEntityDraft(createEmptyEntityDraft());
                            await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
                          })
                        }
                        type="button"
                      >
                        <Save size={16} />
                        Create
                      </button>
                      {selectedEntity !== null ? (
                        <>
                          <button
                            className="ghost-button"
                            onClick={() =>
                              void runAction('Save entity', async () => {
                                await api.updateEntity(selectedEntity.id, toEntityPayload(entityDraft));
                                await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            Save selected
                          </button>
                          <button
                            className="ghost-button danger"
                            onClick={() =>
                              void runAction('Delete entity', async () => {
                                await api.deleteEntity(selectedEntity.id);
                                await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
                              })
                            }
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </PanelSection>

                  <PanelSection title="Import / References">
                    <label className="file-drop">
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void handleEntityImport(event, entityDraft.entity_type, api, setImportingImage, setNotice, setEntityDraft)
                        }
                        type="file"
                      />
                      <span>{importingImage ? 'Importing image…' : 'Drop or choose image'}</span>
                    </label>
                    {selectedEntity !== null ? (
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Generate reference', async () => {
                              const result = await api.generateEntityReference(selectedEntity.id);
                              trackJob(result.job_id);
                            })
                          }
                          type="button"
                        >
                          <Sparkles size={16} />
                          Generate candidates
                        </button>
                      </div>
                    ) : null}
                    {latestReferenceCandidates.length > 0 ? (
                      <div className="reference-grid">
                        {latestReferenceCandidates.map((candidate) => (
                          <label key={candidate.s3_key} className={`reference-card ${referenceSelection.includes(candidate.s3_key) ? 'active' : ''}`}>
                            <img alt="" src={candidate.cdn_url} />
                            <input
                              checked={referenceSelection.includes(candidate.s3_key)}
                              onChange={(event) =>
                                setReferenceSelection((current) =>
                                  event.target.checked
                                    ? [...current, candidate.s3_key]
                                    : current.filter((item) => item !== candidate.s3_key),
                                )
                              }
                              type="checkbox"
                            />
                            <input
                              checked={referencePrimaryKey === candidate.s3_key}
                              name="reference-primary"
                              onChange={() => setReferencePrimaryKey(candidate.s3_key)}
                              type="radio"
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <div className="toolbar">
                      {selectedEntity !== null ? (
                        <button
                          className="primary-button"
                          disabled={referenceSelection.length === 0}
                          onClick={() =>
                            void runAction('Confirm references', async () => {
                              await api.confirmEntityReference(selectedEntity.id, {
                                selected_s3_keys: referenceSelection,
                                primary_s3_key: referencePrimaryKey,
                                prompt_supplement: entityDraft.prompt_supplement || null,
                              });
                              await queryClient.invalidateQueries({ queryKey: ['entity-reference-set', selectedEntity.id] });
                            })
                          }
                          type="button"
                        >
                          <Check size={16} />
                          Confirm
                        </button>
                      ) : null}
                    </div>
                    {entityReferenceSetQuery.data !== undefined ? (
                      <div className="reference-grid compact">
                        {entityReferenceSetQuery.data.reference_images.map((image) => (
                          <button
                            key={image.ref_id}
                            className="reference-card compact"
                            onClick={() => {
                              if (selectedEntity === null) {
                                return;
                              }
                              void runAction('Delete reference', async () => {
                                await api.deleteEntityReference(selectedEntity.id, image.ref_id);
                                await queryClient.invalidateQueries({ queryKey: ['entity-reference-set', selectedEntity.id] });
                              });
                            }}
                            type="button"
                          >
                            <img alt="" src={image.cdn_url} />
                            <span>{image.ref_id === entityReferenceSetQuery.data.primary_ref_id ? 'Primary' : image.source}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </PanelSection>
                </>
              ) : null}

              {activeTab === 'pages' && selectedEpisode !== null ? (
                <>
                  <PanelSection title="Pages">
                    <div className="page-grid">
                      {pages.map((page) => (
                        <button
                          key={page.id}
                          className={`page-card ${selectedPage?.id === page.id ? 'active' : ''}`}
                          onClick={() => setSelectedPageId(page.id)}
                          type="button"
                        >
                          <div className="page-card-header">
                            <strong>{page.page_number}</strong>
                            <StatusBadge value={page.status} />
                          </div>
                          {page.generated_image?.cdn_url !== null && page.generated_image?.cdn_url !== undefined ? (
                            <img alt="" src={page.generated_image.cdn_url} />
                          ) : (
                            <div className="page-placeholder">
                              <LayoutGrid size={18} />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </PanelSection>

                  {selectedPage !== null ? (
                    <>
                      <PanelSection
                        title={`Page ${selectedPage.page_number}`}
                        subtitle={`dialogue ${selectedPage.dialogue_mode}`}
                        actions={
                          <div className="toolbar">
                            <button
                              className="secondary-button"
                              onClick={() =>
                                void runAction('Generate page', async () => {
                                  const result = await api.generatePage(selectedPage.id);
                                  trackJob(result.job_id);
                                })
                              }
                              type="button"
                            >
                              <Play size={16} />
                              Generate
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Confirm page', async () => {
                                  await api.confirmPage(selectedPage.id);
                                  await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                                })
                              }
                              type="button"
                            >
                              <Check size={16} />
                              Confirm
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Reopen page', async () => {
                                  await api.reopenPage(selectedPage.id);
                                  await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                                })
                              }
                              type="button"
                            >
                              <RefreshCw size={16} />
                              Reopen
                            </button>
                          </div>
                        }
                      >
                        {selectedPage.generated_image?.cdn_url !== null && selectedPage.generated_image?.cdn_url !== undefined ? (
                          <div className="generated-image-wrap">
                            <img alt="" className="generated-image" src={selectedPage.generated_image.cdn_url} />
                            {balloons.map((balloon) => (
                              <div
                                key={balloon.id}
                                className={`balloon-overlay ${selectedBalloon?.id === balloon.id ? 'active' : ''}`}
                                style={toBalloonStyle(balloon)}
                              >
                                <span>{balloon.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </PanelSection>

                      <PanelSection
                        title="Frames"
                        actions={
                          <div className="toolbar">
                            <input value={frameTemplateId} onChange={(event) => setFrameTemplateId(event.target.value)} />
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Apply frame template', async () => {
                                  await api.applyFrameTemplate(selectedPage.id, frameTemplateId);
                                  await queryClient.invalidateQueries({ queryKey: ['frames', selectedPage.id] });
                                })
                              }
                              type="button"
                            >
                              <Wand2 size={16} />
                              Apply
                            </button>
                          </div>
                        }
                      >
                        <TextAreaField label="Frames JSON" rows={10} value={framesJson} onChange={setFramesJson} />
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Save frames', async () => {
                              const parsed = parseJson<Array<Record<string, unknown>>>(framesJson);
                              await api.replaceFrames(selectedPage.id, { frames: parsed });
                              await queryClient.invalidateQueries({ queryKey: ['frames', selectedPage.id] });
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          Save frames
                        </button>
                      </PanelSection>

                      <PanelSection title="Panels">
                        <div className="list-grid">
                          {panels.map((panel) => (
                            <button
                              key={panel.id}
                              className={`mini-card ${selectedPanel?.id === panel.id ? 'active' : ''}`}
                              onClick={() => setSelectedPanelId(panel.id)}
                              type="button"
                            >
                              <strong>{panel.order}</strong>
                              <span>{panel.panel_role}</span>
                            </button>
                          ))}
                        </div>
                        <div className="form-grid three">
                          <InputField label="Order" value={panelDraft.order} onChange={(value) => setPanelDraft({ ...panelDraft, order: value })} />
                          <SelectField
                            label="Role"
                            value={panelDraft.panel_role}
                            onChange={(value) => setPanelDraft({ ...panelDraft, panel_role: value as PanelDraft['panel_role'] })}
                            options={[
                              ['setup', 'Setup'],
                              ['build', 'Build'],
                              ['payoff', 'Payoff'],
                            ]}
                          />
                          <SelectField
                            label="Size"
                            value={panelDraft.panel_size}
                            onChange={(value) => setPanelDraft({ ...panelDraft, panel_size: value as PanelDraft['panel_size'] })}
                            options={[
                              ['small', 'Small'],
                              ['medium', 'Medium'],
                              ['large', 'Large'],
                            ]}
                          />
                        </div>
                        <TextAreaField label="Situation" rows={3} value={panelDraft.situation_text} onChange={(value) => setPanelDraft({ ...panelDraft, situation_text: value })} />
                        <div className="form-grid two">
                          <TextAreaField label="Composition JSON" rows={8} value={panelDraft.composition_json} onChange={(value) => setPanelDraft({ ...panelDraft, composition_json: value })} />
                          <TextAreaField label="Dialogue JSON" rows={8} value={panelDraft.dialogue_json} onChange={(value) => setPanelDraft({ ...panelDraft, dialogue_json: value })} />
                        </div>
                        <TextAreaField label="Entity assignments JSON" rows={8} value={panelDraft.assignments_json} onChange={(value) => setPanelDraft({ ...panelDraft, assignments_json: value })} />
                        <div className="form-grid three">
                          <InputField label="SFX" value={panelDraft.sfx_text} onChange={(value) => setPanelDraft({ ...panelDraft, sfx_text: value })} />
                          <InputField label="Background" value={panelDraft.background_note} onChange={(value) => setPanelDraft({ ...panelDraft, background_note: value })} />
                          <InputField label="Notes" value={panelDraft.panel_notes} onChange={(value) => setPanelDraft({ ...panelDraft, panel_notes: value })} />
                        </div>
                        <label className="checkbox-row">
                          <input
                            checked={panelDraft.dialogue_in_panel}
                            onChange={(event) => setPanelDraft({ ...panelDraft, dialogue_in_panel: event.target.checked })}
                            type="checkbox"
                          />
                          Dialogue in panel
                        </label>
                        <div className="toolbar">
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Create panel', async () => {
                                await api.createPanel(selectedPage.id, toPanelPayload(panelDraft));
                                await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            Create
                          </button>
                          {selectedPanel !== null ? (
                            <>
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  void runAction('Save panel', async () => {
                                    await api.updatePanel(selectedPanel.id, toPanelPayload(panelDraft));
                                    await api.replacePanelAssignments(selectedPanel.id, {
                                      entities: parseJson<unknown[]>(panelDraft.assignments_json),
                                    });
                                    await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                                  })
                                }
                                type="button"
                              >
                                <Save size={16} />
                                Save selected
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() =>
                                  void runAction('Delete panel', async () => {
                                    await api.deletePanel(selectedPanel.id);
                                    await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                                  })
                                }
                                type="button"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : null}
                        </div>
                        <div className="composition-strip">
                          {compositions.slice(0, 10).map((composition) => (
                            <button
                              key={composition.id}
                              className="composition-card"
                              onClick={() =>
                                setPanelDraft((current) => ({
                                  ...current,
                                  composition_json: JSON.stringify(
                                    {
                                      source: 'gallery',
                                      gallery_item_id: composition.id,
                                      composition_prompt: composition.composition_prompt,
                                      shot_type: composition.shot_type,
                                      angle: composition.angle,
                                      custom_note: null,
                                    },
                                    null,
                                    2,
                                  ),
                                }))
                              }
                              type="button"
                            >
                              {composition.preview_cdn_url !== null ? <img alt="" src={composition.preview_cdn_url} /> : <div className="thumb-placeholder" />}
                              <span>{composition.name}</span>
                            </button>
                          ))}
                        </div>
                      </PanelSection>

                      <PanelSection
                        title="Balloons"
                        actions={
                          <button
                            className="ghost-button"
                            onClick={() =>
                              void runAction('Auto balloons', async () => {
                                await api.autoBalloons(selectedPage.id);
                                await queryClient.invalidateQueries({ queryKey: ['balloons', selectedPage.id] });
                              })
                            }
                            type="button"
                          >
                            <Sparkles size={16} />
                            Auto
                          </button>
                        }
                      >
                        <div className="list-grid">
                          {balloons.map((balloon) => (
                            <button
                              key={balloon.id}
                              className={`mini-card ${selectedBalloon?.id === balloon.id ? 'active' : ''}`}
                              onClick={() => setSelectedBalloonId(balloon.id)}
                              type="button"
                            >
                              <strong>{balloon.balloon_type}</strong>
                              <span>{balloon.text.slice(0, 32)}</span>
                            </button>
                          ))}
                        </div>
                        <div className="form-grid three">
                          <InputField label="Speaker ID" value={balloonDraft.speaker_entity_id} onChange={(value) => setBalloonDraft({ ...balloonDraft, speaker_entity_id: value })} />
                          <SelectField
                            label="Balloon"
                            value={balloonDraft.balloon_type}
                            onChange={(value) => setBalloonDraft({ ...balloonDraft, balloon_type: value as BalloonDraft['balloon_type'] })}
                            options={[
                              ['speech', 'Speech'],
                              ['thought', 'Thought'],
                              ['narration', 'Narration'],
                              ['shout', 'Shout'],
                              ['whisper', 'Whisper'],
                            ]}
                          />
                          <SelectField
                            label="Writing"
                            value={balloonDraft.writing_mode}
                            onChange={(value) => setBalloonDraft({ ...balloonDraft, writing_mode: value as BalloonDraft['writing_mode'] })}
                            options={[
                              ['horizontal', 'Horizontal'],
                              ['vertical', 'Vertical'],
                            ]}
                          />
                        </div>
                        <TextAreaField label="Text" rows={3} value={balloonDraft.text} onChange={(value) => setBalloonDraft({ ...balloonDraft, text: value })} />
                        <div className="form-grid two">
                          <TextAreaField label="Position JSON" rows={4} value={balloonDraft.position_json} onChange={(value) => setBalloonDraft({ ...balloonDraft, position_json: value })} />
                          <TextAreaField label="Tail JSON / null" rows={4} value={balloonDraft.tail_json} onChange={(value) => setBalloonDraft({ ...balloonDraft, tail_json: value })} />
                        </div>
                        <div className="form-grid three">
                          <InputField label="Font size" value={balloonDraft.font_size} onChange={(value) => setBalloonDraft({ ...balloonDraft, font_size: value })} />
                          <InputField label="Font family" value={balloonDraft.font_family} onChange={(value) => setBalloonDraft({ ...balloonDraft, font_family: value })} />
                          <InputField label="Panel order ref" value={balloonDraft.panel_order_reference} onChange={(value) => setBalloonDraft({ ...balloonDraft, panel_order_reference: value })} />
                        </div>
                        <InputField label="Z-index" value={balloonDraft.z_index} onChange={(value) => setBalloonDraft({ ...balloonDraft, z_index: value })} />
                        <div className="toolbar">
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Create balloon', async () => {
                                await api.createBalloon(selectedPage.id, toBalloonPayload(balloonDraft));
                                await queryClient.invalidateQueries({ queryKey: ['balloons', selectedPage.id] });
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            Create
                          </button>
                          {selectedBalloon !== null ? (
                            <>
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  void runAction('Save balloon', async () => {
                                    await api.updateBalloon(selectedBalloon.id, toBalloonPayload(balloonDraft));
                                    await queryClient.invalidateQueries({ queryKey: ['balloons', selectedPage.id] });
                                  })
                                }
                                type="button"
                              >
                                <Save size={16} />
                                Save selected
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() =>
                                  void runAction('Delete balloon', async () => {
                                    await api.deleteBalloon(selectedBalloon.id);
                                    await queryClient.invalidateQueries({ queryKey: ['balloons', selectedPage.id] });
                                  })
                                }
                                type="button"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </PanelSection>
                    </>
                  ) : null}
                </>
              ) : null}
            </section>

            <aside className="rail">
              <PanelSection title="Credits" compact>
                {balanceQuery.data !== undefined ? (
                  <div className="metric-grid">
                    <Metric label="Total" value={String(balanceQuery.data.total_credits)} />
                    <Metric label="Monthly" value={String(balanceQuery.data.monthly_credits)} />
                    <Metric label="Purchased" value={String(balanceQuery.data.purchased_credits)} />
                  </div>
                ) : (
                  <LoaderCircle className="spin" size={16} />
                )}
                <div className="stack gap-xs">
                  <button
                    className="secondary-button"
                    onClick={() =>
                      void runAction('Checkout standard', async () => {
                        const result = await api.createSubscriptionCheckout('standard');
                        redirectToExternalUrl(result.url);
                      })
                    }
                    type="button"
                  >
                    <CreditCard size={16} />
                    Standard
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      void runAction('Checkout credits', async () => {
                        const result = await api.createCreditCheckout('credits_1000');
                        redirectToExternalUrl(result.url);
                      })
                    }
                    type="button"
                  >
                    <CreditCard size={16} />
                    Credits 1000
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      void runAction('Open portal', async () => {
                        const result = await api.createCustomerPortal();
                        redirectToExternalUrl(result.url);
                      })
                    }
                    type="button"
                  >
                    <CreditCard size={16} />
                    Portal
                  </button>
                </div>
              </PanelSection>

              <PanelSection title="Jobs" compact>
                <div className="stack gap-xs">
                  {jobs.map((job) => (
                    <div key={job.id} className="job-row">
                      <div>
                        <strong>{job.job_type}</strong>
                        <div className="muted small">{job.id}</div>
                      </div>
                      <StatusBadge value={job.status} />
                    </div>
                  ))}
                </div>
              </PanelSection>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function PanelSection(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`panel-section ${props.compact ? 'compact' : ''}`}>
      <div className="section-header">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle !== undefined ? <div className="muted">{props.subtitle}</div> : null}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

function NoticeBanner(props: { notice: NoticeState }) {
  return <div className={`notice ${props.notice.type}`}>{props.notice.message}</div>;
}

function StatusBadge(props: { value: string }) {
  return <span className={`status-badge status-${props.value}`}>{props.value}</span>;
}

function InputField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea rows={props.rows} value={props.value} onChange={(event) => props.onChange(event.target.value)} spellCheck={false} />
    </label>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="muted small">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

async function handleEntityImport(
  event: ChangeEvent<HTMLInputElement>,
  entityType: EntityDraft['entity_type'],
  api: LyraApiClient,
  setImportingImage: (nextValue: boolean) => void,
  setNotice: (nextValue: NoticeState) => void,
  setEntityDraft: (nextValue: EntityDraft | ((current: EntityDraft) => EntityDraft)) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  if (file === undefined) {
    return;
  }

  const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const maxFileSizeBytes = 5 * 1024 * 1024;
  if (!allowedMimeTypes.has(file.type)) {
    setNotice({ type: 'error', message: 'Only PNG, JPEG, and WebP are allowed.' });
    event.target.value = '';
    return;
  }
  if (file.size > maxFileSizeBytes) {
    setNotice({ type: 'error', message: 'Image file is too large.' });
    event.target.value = '';
    return;
  }

  try {
    setImportingImage(true);
    const imageBase64 = await toDataUrl(file);
    const result = await api.importEntityImage({
      entity_type: entityType,
      image_base64: imageBase64,
    });
    setEntityDraft((current) => ({
      ...current,
      structured_fields: JSON.stringify(result.suggested_fields, null, 2),
      prompt_supplement: result.prompt_supplement,
    }));
    setNotice({ type: 'success', message: 'Image analyzed.' });
  } catch (error) {
    setNotice({ type: 'error', message: toMessage(error) });
  } finally {
    setImportingImage(false);
    event.target.value = '';
  }
}

function toWorkDraft(work: WorkRecord): WorkDraft {
  return {
    title: work.title,
    genre: work.genre ?? '',
    world_setting: work.world_setting ?? '',
    theme: work.theme ?? '',
    main_entity_ids: work.main_entity_ids.join(', '),
    starting_point: work.starting_point ?? '',
    ending_point: work.ending_point ?? '',
    overall_flow: work.overall_flow ?? '',
    status: work.status,
  };
}

function toChapterDraft(chapter: ChapterRecord): ChapterDraft {
  return {
    order: String(chapter.order),
    title: chapter.title ?? '',
    purpose: chapter.purpose ?? '',
    starting_state: chapter.starting_state ?? '',
    ending_state: chapter.ending_state ?? '',
    emotion_curve: chapter.emotion_curve ?? '',
    entities_involved: chapter.entities_involved.join(', '),
    key_beats: chapter.key_beats.join('\n'),
    status: chapter.status,
  };
}

function toEpisodeDraft(episode: EpisodeRecord): EpisodeDraft {
  return {
    order: String(episode.order),
    title: episode.title ?? '',
    purpose: episode.purpose ?? '',
    introduction: episode.introduction ?? '',
    middle: episode.middle ?? '',
    climax: episode.climax ?? '',
    ending_hook: episode.ending_hook ?? '',
    estimated_pages: String(episode.estimated_pages),
    entities_involved: episode.entities_involved.join(', '),
    status: episode.status,
  };
}

function toEntityDraft(entity: EntityRecord): EntityDraft {
  return {
    entity_type: entity.entity_type,
    name: entity.name,
    free_description: entity.free_description ?? '',
    prompt_supplement: entity.prompt_supplement ?? '',
    structured_fields: JSON.stringify(entity.structured_fields, null, 2),
    speech_profile: JSON.stringify(entity.speech_profile, null, 2),
  };
}

function toSceneDraft(scene: SceneRecord): SceneDraft {
  return {
    order: String(scene.order),
    location: scene.location ?? '',
    time: scene.time ?? '',
    atmosphere: scene.atmosphere ?? '',
    involved_entity_ids: scene.involved_entity_ids.join(', '),
    status: scene.status,
  };
}

function toPanelDraft(panel: PanelRecord): PanelDraft {
  return {
    order: String(panel.order),
    panel_role: panel.panel_role,
    panel_size: panel.panel_size,
    situation_text: panel.situation_text ?? '',
    composition_json: JSON.stringify(panel.composition, null, 2),
    dialogue_json: JSON.stringify(panel.dialogue, null, 2),
    dialogue_in_panel: panel.dialogue_in_panel,
    sfx_text: panel.sfx_text ?? '',
    background_note: panel.background_note ?? '',
    panel_notes: panel.panel_notes ?? '',
    assignments_json: JSON.stringify(panel.entities, null, 2),
  };
}

function toBalloonDraft(balloon: BalloonRecord): BalloonDraft {
  return {
    speaker_entity_id: balloon.speaker_entity_id ?? '',
    balloon_type: balloon.balloon_type,
    writing_mode: balloon.writing_mode,
    text: balloon.text,
    position_json: JSON.stringify(balloon.position, null, 2),
    tail_json: balloon.tail === null ? 'null' : JSON.stringify(balloon.tail, null, 2),
    font_size: String(balloon.font_size),
    font_family: balloon.font_family,
    panel_order_reference: balloon.panel_order_reference === null ? '' : String(balloon.panel_order_reference),
    z_index: String(balloon.z_index),
  };
}

function toWorkPayload(draft: WorkDraft): Record<string, unknown> {
  return {
    title: draft.title,
    genre: nullableString(draft.genre),
    world_setting: nullableString(draft.world_setting),
    theme: nullableString(draft.theme),
    main_entity_ids: splitCsv(draft.main_entity_ids),
    starting_point: nullableString(draft.starting_point),
    ending_point: nullableString(draft.ending_point),
    overall_flow: nullableString(draft.overall_flow),
    status: draft.status,
  };
}

function toChapterPayload(draft: ChapterDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'chapter order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    starting_state: nullableString(draft.starting_state),
    ending_state: nullableString(draft.ending_state),
    emotion_curve: nullableString(draft.emotion_curve),
    entities_involved: splitCsv(draft.entities_involved),
    key_beats: splitLines(draft.key_beats),
    status: draft.status,
  };
}

function toEpisodePayload(draft: EpisodeDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    introduction: nullableString(draft.introduction),
    middle: nullableString(draft.middle),
    climax: nullableString(draft.climax),
    ending_hook: nullableString(draft.ending_hook),
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    entities_involved: splitCsv(draft.entities_involved),
    status: draft.status,
  };
}

function toEntityPayload(draft: EntityDraft): Record<string, unknown> {
  return {
    entity_type: draft.entity_type,
    name: draft.name,
    free_description: nullableString(draft.free_description),
    prompt_supplement: nullableString(draft.prompt_supplement),
    structured_fields: parseJson<Record<string, unknown>>(draft.structured_fields),
    speech_profile: parseJson<Record<string, unknown>>(draft.speech_profile),
  };
}

function toScenePayload(draft: SceneDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'scene order'),
    location: nullableString(draft.location),
    time: nullableString(draft.time),
    atmosphere: nullableString(draft.atmosphere),
    involved_entity_ids: splitCsv(draft.involved_entity_ids),
    status: draft.status,
  };
}

function toPanelPayload(draft: PanelDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'panel order'),
    panel_role: draft.panel_role,
    panel_size: draft.panel_size,
    situation_text: nullableString(draft.situation_text),
    composition: parseJson<Record<string, unknown>>(draft.composition_json),
    dialogue: parseJson<unknown[]>(draft.dialogue_json),
    dialogue_in_panel: draft.dialogue_in_panel,
    sfx_text: nullableString(draft.sfx_text),
    background_note: nullableString(draft.background_note),
    panel_notes: nullableString(draft.panel_notes),
  };
}

function toBalloonPayload(draft: BalloonDraft): Record<string, unknown> {
  return {
    speaker_entity_id: nullableString(draft.speaker_entity_id),
    balloon_type: draft.balloon_type,
    writing_mode: draft.writing_mode,
    text: draft.text,
    position: parseJson<Record<string, unknown>>(draft.position_json),
    tail: draft.tail_json.trim() === 'null' ? null : parseJson<Record<string, unknown>>(draft.tail_json),
    font_size: parseNumberInput(draft.font_size, 'font size'),
    font_family: draft.font_family,
    panel_order_reference:
      draft.panel_order_reference.trim().length === 0
        ? null
        : parseNumberInput(draft.panel_order_reference, 'panel order reference'),
    z_index: parseNumberInput(draft.z_index, 'z-index'),
  };
}

function createEmptyWorkDraft(): WorkDraft {
  return {
    title: '',
    genre: '',
    world_setting: '',
    theme: '',
    main_entity_ids: '',
    starting_point: '',
    ending_point: '',
    overall_flow: '',
    status: 'draft',
  };
}

function createEmptyChapterDraft(): ChapterDraft {
  return {
    order: '1',
    title: '',
    purpose: '',
    starting_state: '',
    ending_state: '',
    emotion_curve: '',
    entities_involved: '',
    key_beats: '',
    status: 'draft',
  };
}

function createEmptyEpisodeDraft(): EpisodeDraft {
  return {
    order: '1',
    title: '',
    purpose: '',
    introduction: '',
    middle: '',
    climax: '',
    ending_hook: '',
    estimated_pages: '8',
    entities_involved: '',
    status: 'draft',
  };
}

function createEmptyEntityDraft(): EntityDraft {
  return {
    entity_type: 'character',
    name: '',
    free_description: '',
    prompt_supplement: '',
    structured_fields: '{}',
    speech_profile: '{}',
  };
}

function createEmptySceneDraft(): SceneDraft {
  return {
    order: '1',
    location: '',
    time: '',
    atmosphere: '',
    involved_entity_ids: '',
    status: 'draft',
  };
}

function createEmptyPanelDraft(): PanelDraft {
  return {
    order: '1',
    panel_role: 'setup',
    panel_size: 'medium',
    situation_text: '',
    composition_json: JSON.stringify(
      {
        source: 'ai_auto',
        gallery_item_id: null,
        composition_prompt: null,
        shot_type: null,
        angle: null,
        custom_note: null,
      },
      null,
      2,
    ),
    dialogue_json: '[]',
    dialogue_in_panel: true,
    sfx_text: '',
    background_note: '',
    panel_notes: '',
    assignments_json: '[]',
  };
}

function createEmptyBalloonDraft(): BalloonDraft {
  return {
    speaker_entity_id: '',
    balloon_type: 'speech',
    writing_mode: 'horizontal',
    text: '',
    position_json: JSON.stringify({ x: 10, y: 10, width: 22, height: 18 }, null, 2),
    tail_json: 'null',
    font_size: '18',
    font_family: 'Noto Sans JP',
    panel_order_reference: '',
    z_index: '1',
  };
}

function toBalloonStyle(balloon: BalloonRecord): Record<string, string> {
  return {
    left: `${balloon.position.x}%`,
    top: `${balloon.position.y}%`,
    width: `${balloon.position.width}%`,
    height: `${balloon.position.height}%`,
  };
}

function parseTrackedJobIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('JSON is invalid');
  }
}

function parseNumberInput(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is invalid`);
  }

  return parsed;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function nullableString(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
}

function useStoredString(
  storage: Storage,
  storageKey: string,
  fallbackValue: string,
): [string, (nextValue: string) => void] {
  const [value, setValue] = useState(() => storage.getItem(storageKey) ?? fallbackValue);

  const updateValue = (nextValue: string): void => {
    setValue(nextValue);
    storage.setItem(storageKey, nextValue);
  };

  return [value, updateValue];
}

function redirectToExternalUrl(value: string): void {
  const url = new URL(value, window.location.origin);
  if (url.protocol !== 'https:') {
    throw new Error('Redirect URL is invalid');
  }

  window.location.assign(url.toString());
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Image file could not be read'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Image file could not be read'));
    reader.readAsDataURL(file);
  });
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
