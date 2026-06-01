import { createContext, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { jsPDF } from 'jspdf';
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
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
  PageRecord,
  PanelRecord,
  SceneRecord,
  StoryEpisodeImprovementRecord,
  WorkRecord,
} from './types/api';

type WorkspaceTab = 'story' | 'entities' | 'pages';
type UiLanguage = 'ja' | 'en';

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

interface CharacterStructuredFieldsDraft {
  gender_expression: string;
  age_range: string;
  skin_tone: string;
  first_impression: string;
  standing_style: string;
  default_expression: string;
  face_shape: string;
  eyebrow_shape: string;
  nose_shape: string;
  mouth_shape: string;
  height: string;
  build: string;
  hair_color: string;
  hair_length: string;
  hair_style: string;
  hair_arrangement: string;
  hair_bangs: string;
  eye_color: string;
  eye_shape: string;
  eyelid_type: string;
  visual_anchor: string;
  signature_feature: string;
  silhouette_keywords: string;
  head_to_body_ratio: string;
  shoulder_width: string;
  leg_length: string;
  posture_axis: string;
  eye_size: string;
  eye_angle: string;
  pupil_style: string;
  under_eye_detail: string;
  mouth_default: string;
  hair_front_shape: string;
  hair_side_hair: string;
  hair_back_shape: string;
  clothing_category: string;
  clothing_main_color: string;
  clothing_impression: string;
  collar_shape: string;
  sleeve_length: string;
  skirt_or_pants_shape: string;
  shoes: string;
  socks_or_legwear: string;
  clothing_description: string;
  distinguishing_features: string;
  art_style: string;
}

interface SceneDraft {
  order: string;
  location: string;
  time: string;
  atmosphere: string;
  involved_entity_ids: string;
  status: 'draft' | 'reviewing' | 'ready';
}

interface PanelAssignmentDraft {
  entity_id: string;
  role: PanelRecord['entities'][number]['role'];
  position: PanelRecord['entities'][number]['position'];
  facing_direction: NonNullable<PanelRecord['entities'][number]['facing_direction']> | '';
  expression: PanelRecord['entities'][number]['expression'];
  custom_expression: string;
  action: PanelRecord['entities'][number]['action'];
  custom_action: string;
  effect_note: string;
  state_id: string;
}

interface PanelDialogueDraft {
  entity_id: string;
  text: string;
  type: Exclude<PanelRecord['dialogue'][number]['type'], 'sfx'>;
  position: PanelRecord['dialogue'][number]['position'];
}

interface PanelDraft {
  order: string;
  panel_role: PanelRecord['panel_role'];
  panel_size: PanelRecord['panel_size'];
  situation_text: string;
  composition_source: PanelRecord['composition']['source'];
  composition_gallery_item_id: string;
  composition_prompt: string;
  shot_type: NonNullable<PanelRecord['composition']['shot_type']> | '';
  angle: NonNullable<PanelRecord['composition']['angle']> | '';
  custom_note: string;
  dialogue_in_panel: boolean;
  dialogues: PanelDialogueDraft[];
  sfx_text: string;
  background_note: string;
  panel_notes: string;
  assignments: PanelAssignmentDraft[];
}

interface PageSettingsDraft {
  dialogue_mode: PageRecord['dialogue_mode'];
  page_dialogue_toggle: boolean;
  style_reference_title: string;
  style_reference_notes: string;
  story_source_scene_ids: string[];
  story_page_purpose: string;
  story_continuity_note: string;
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

interface ReferenceCandidate {
  s3_key: string;
  cdn_url: string;
  source: 'upload' | 'generated';
}

type ExportFormat = 'pdf' | 'image';

const manualTokenStorageKey = 'lyra:web:manual-token';
const trackedJobsStorageKey = 'lyra:web:tracked-jobs';
const uiLanguageStorageKey = 'lyra:web:ui-language';
const UiLanguageContext = createContext<UiLanguage>('ja');
const UI_JA_DICTIONARY: Record<string, string> = {
  Story: 'ストーリー',
  Entities: 'キャラクター',
  Pages: 'ページ',
  Work: '作品',
  Chapter: '章',
  Episode: '話',
  Chapters: '章',
  Episodes: '話',
  Title: 'タイトル',
  Genre: 'ジャンル',
  Theme: 'テーマ',
  Status: '状態',
  'World setting': '世界観',
  'Overall flow': '全体の流れ',
  'Starting point': '開始地点',
  'Ending point': '終着点',
  'Main characters': '主な登場人物',
  'Chapter title': '章タイトル',
  'Episode draft': '話の下書き',
  'Estimated pages': '想定ページ数',
  Purpose: '目的',
  Introduction: '序盤',
  Middle: '中盤',
  Climax: 'クライマックス',
  'Ending hook': '終盤 / 引き',
  'Entity IDs': '登場人物ID',
  Scenes: 'シーン',
  'Scene breakdown': 'シーン分解',
  Order: '順番',
  Location: '場所',
  Time: '時間',
  Atmosphere: '雰囲気',
  'Story AI': 'ストーリーAI',
  Instruction: '指示',
  'Improved title': '改善タイトル',
  'Improved purpose': '改善された目的',
  'Improved introduction': '改善された序盤',
  'Improved middle': '改善された中盤',
  'Improved climax': '改善されたクライマックス',
  'Improved ending hook': '改善された終盤 / 引き',
  Frames: 'コマ割り',
  Panels: 'コマ',
  Balloons: '吹き出し',
  'Page settings': 'ページ設定',
  'Dialogue mode': 'セリフの扱い',
  'Dialogue toggle': 'ページ全体でセリフを画像に含める',
  'Style reference title': '画風制約の作品名',
  'Style reference notes': '画風制約メモ',
  'Story sources': '話の材料',
  'Source scenes': '元シーン',
  'Page purpose': 'ページの目的',
  'Continuity note': '連続性メモ',
  Format: '形式',
  Filename: 'ファイル名',
  'Export selected': '選択ページを保存',
  'Export all': 'すべて保存',
  'Image baked': '画像にセリフを焼き込む',
  'Balloon only': '吹き出しのみ',
  Mixed: '混在',
  'Page autofill': 'ページ補完',
  Page: 'ページ',
  'Generated preview': '生成プレビュー',
  'Confirmed references': '確定済みリファレンス',
  'Character list': 'キャラ一覧',
  'Character editor': 'キャラ編集',
  'Story context': 'ストーリー文脈',
  'Target episode': '対象の話',
  Generate: '生成',
  Confirm: '確定',
  Reopen: '再編集',
  Template: 'テンプレート',
  Apply: '適用',
  'Frames JSON': 'コマ割りJSON',
  'Save frames': 'コマ割りを保存',
  'Advanced frame geometry': 'コマ形状の詳細調整',
  'Advanced balloon geometry': '吹き出し位置の詳細調整',
  'Position JSON': '位置JSON',
  'Tail JSON / null': 'しっぽJSON / null',
  'Panel order ref': '対応コマ順',
  'Z-index': '重なり順',
  Role: '役割',
  Size: 'サイズ',
  Situation: '状況',
  'Composition source': '構図メモ',
  Shot: 'ショット',
  Angle: 'アングル',
  Background: '背景',
  SFX: '効果音',
  'Overall composition note': '全体構図メモ',
  'Extra camera / staging note': 'カメラ・演出メモ',
  Notes: '補足',
  'Dialogue in panel': 'コマ内にセリフを含める',
  Dialogue: 'セリフ',
  Speaker: '話者',
  Type: '種別',
  Placement: '配置',
  Line: '行',
  'Add character': 'キャラを追加',
  'Add to panel': 'コマに追加',
  'No more entities': '追加できるキャラがありません。',
  'No characters assigned yet.': 'まだキャラが割り当てられていません。',
  Facing: '向き',
  'State override ID': '状態上書きID',
  Expression: '表情',
  Pose: 'ポーズ',
  Effect: 'エフェクト',
  'Custom expression': '自由入力の表情',
  'Custom pose': '自由入力のポーズ',
  'Add line': '行を追加',
  'No dialogue lines yet.': 'まだセリフ行がありません。',
  'Narration / none': 'ナレーション / なし',
  Draft: '下書き',
  Reviewing: '確認中',
  Ready: '準備完了',
  Save: '保存',
  'Save chapter': '章を保存',
  'Add chapter': '章を追加',
  'Add episode': '話を追加',
  'Generate page plan': 'ページ骨格生成',
  'Apply story plan': '話全体を反映',
  'Improve draft': '改善する',
  'Apply all': 'すべて反映',
  'Apply to title': 'タイトルへ反映',
  'Apply purpose': '目的へ反映',
  'Apply introduction': '序盤へ反映',
  'Apply middle': '中盤へ反映',
  'Apply climax': 'クライマックスへ反映',
  'Apply ending hook': '終盤へ反映',
  'Reset draft': '下書きを戻す',
  'Use token': 'トークンを使う',
  Create: '作成',
  'Save selected': '選択中を保存',
  'Signed in': 'ログイン中',
  'No work selected': '作品が選択されていません',
  'Choose the current work, chapter, and episode while editing characters.': 'キャラ編集中の作品・章・話を選択します。',
  'New character': '新規キャラ',
  'Importing image...': '画像を取り込み中...',
  'Drop or choose image': '画像をドロップまたは選択',
  'Select one or more candidates and choose a primary image.': '候補を選び、メイン画像を決めます。',
  'No preview candidates yet.': 'まだプレビュー候補がありません。',
  'Delete with the button only. Clicking the image will not delete it.': '削除はボタンのみです。画像クリックでは削除しません。',
  'No confirmed references yet.': 'まだ確定済みリファレンスがありません。',
  'Switch story context for page editing.': 'ページ編集対象の作品・章・話を選択します。',
  'Double-click image to enlarge': '画像はダブルクリックで拡大',
  'Fill selected page': '選択中ページを補完',
  'Use this after the story plan when a single page still needs refinement.': '話全体の反映後も1ページだけ補正したいときに使います。',
  Primary: 'メイン',
  Delete: '削除',
  'Generate full-body candidates': '全身候補を生成',
};

function normalizeUiLanguage(value: string): UiLanguage {
  return value === 'en' ? 'en' : 'ja';
}

function translateUiString(language: UiLanguage, value: string): string {
  if (language === 'en') {
    return value;
  }

  const exact = UI_JA_DICTIONARY[value];
  if (exact !== undefined) {
    return exact;
  }

  if (/^Page \d+$/.test(value)) {
    return value.replace(/^Page (\d+)$/, '$1ページ目');
  }

  if (/^Line \d+$/.test(value)) {
    return value.replace(/^Line (\d+)$/, '$1行目');
  }

  if (/^(\d+) records$/.test(value)) {
    return value.replace(/^(\d+) records$/, '$1件');
  }

  return value;
}

function pickUiText(language: UiLanguage, english: string, japanese: string): string {
  return language === 'en' ? english : japanese;
}
const selectedWorkStorageKey = 'lyra:web:selected-work';
const selectedChapterStorageKey = 'lyra:web:selected-chapter';
const selectedEpisodeStorageKey = 'lyra:web:selected-episode';
const selectedPageStorageKey = 'lyra:web:selected-page';
const supabase = createSupabaseBrowserClient();
const devAuthBypassEnabled = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const devAuthBypassEmail =
  typeof import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL === 'string' &&
  import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL.length > 0
    ? import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL
    : 'dev@local.lyra';
const devAuthBypassToken = 'dev-auth-bypass';

export default function App() {
  const [manualToken, setManualToken] = useStoredString(window.sessionStorage, manualTokenStorageKey, '');
  const [supabaseSession, setSupabaseSession] = useState<Session | null>(null);
  const [pendingAuth, setPendingAuth] = useState(true);

  useEffect(() => {
    if (devAuthBypassEnabled) {
      setPendingAuth(false);
      return;
    }

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

  const accessToken = devAuthBypassEnabled
    ? devAuthBypassToken
    : supabaseSession?.access_token ?? (manualToken.length > 0 ? manualToken : null);
  if (accessToken === null) {
    return <AuthScreen manualToken={manualToken} onManualTokenChange={setManualToken} supabaseClient={supabase} />;
  }

  const payload = devAuthBypassEnabled ? null : decodeJwtPayload(accessToken);
  const email = devAuthBypassEnabled
    ? devAuthBypassEmail
    : (typeof payload?.email === 'string' ? payload.email : null) ??
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
  const [uiLanguageStored, setUiLanguageStored] = useStoredString(window.localStorage, uiLanguageStorageKey, 'ja');
  const uiLanguage = normalizeUiLanguage(uiLanguageStored);
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
  const [storyBusy, setStoryBusy] = useState(false);
  const [storyImprovementDraft, setStoryImprovementDraft] = useState<StoryEpisodeImprovementRecord['draft'] | null>(null);
  const [storyImprovementMeta, setStoryImprovementMeta] = useState<{
    compiler_provider: StoryEpisodeImprovementRecord['compiler_provider'];
    compiler_model: string | null;
    compiler_prompt_version: string | null;
    compiler_error: string | null;
  } | null>(null);
  const [entityDraft, setEntityDraft] = useState<EntityDraft>(createEmptyEntityDraft());
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [sceneDraft, setSceneDraft] = useState<SceneDraft>(createEmptySceneDraft());
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [pageSettingsDraft, setPageSettingsDraft] = useState<PageSettingsDraft>(createEmptyPageSettingsDraft());
  const [panelDraft, setPanelDraft] = useState<PanelDraft>(createEmptyPanelDraft());
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [panelEntityToAddId, setPanelEntityToAddId] = useState('');
  const [balloonDraft, setBalloonDraft] = useState<BalloonDraft>(createEmptyBalloonDraft());
  const [selectedBalloonId, setSelectedBalloonId] = useState('');
  const [frameTemplateId, setFrameTemplateId] = useState('standard_4');
  const [framesJson, setFramesJson] = useState('[]');
  const [importingImage, setImportingImage] = useState(false);
  const [uploadedReferenceCandidatesByEntityId, setUploadedReferenceCandidatesByEntityId] = useState<Record<string, ReferenceCandidate[]>>({});
  const [uploadedReferenceSourceByEntityId, setUploadedReferenceSourceByEntityId] = useState<Record<string, string>>({});
  const [referenceSelection, setReferenceSelection] = useState<string[]>([]);
  const [referencePrimaryKey, setReferencePrimaryKey] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportSelectedPageIds, setExportSelectedPageIds] = useState<string[]>([]);
  const [exportFilename, setExportFilename] = useState('lyra-pages');
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState('');
  const handledJobsRef = useRef<Set<string>>(new Set());

  const trackedJobList = useMemo(() => parseTrackedJobIds(trackedJobIds), [trackedJobIds]);

  const worksQuery = useQuery({
    queryKey: ['works'],
    queryFn: () => api.getWorks(),
  });
  const works = useMemo(() => worksQuery.data?.works ?? [], [worksQuery.data?.works]);
  const balanceQuery = useQuery({
    queryKey: ['billing-balance'],
    queryFn: () => api.getBalance(),
  });

  const selectedWork = works.find((work) => work.id === selectedWorkId) ?? null;

  const chaptersQuery = useQuery({
    queryKey: ['chapters', selectedWorkId],
    queryFn: () => api.getChapters(selectedWorkId),
    enabled: selectedWorkId.length > 0,
  });
  const chapters = useMemo(() => chaptersQuery.data?.chapters ?? [], [chaptersQuery.data?.chapters]);
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null;

  const episodesQuery = useQuery({
    queryKey: ['episodes', selectedChapter?.id ?? ''],
    queryFn: () => api.getEpisodes(selectedChapter?.id ?? ''),
    enabled: selectedChapter !== null,
  });
  const episodes = useMemo(() => episodesQuery.data?.episodes ?? [], [episodesQuery.data?.episodes]);
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId) ?? episodes[0] ?? null;

  const entitiesQuery = useQuery({
    queryKey: ['entities', selectedWorkId],
    queryFn: () => api.getEntities(selectedWorkId),
    enabled: selectedWorkId.length > 0,
  });
  const entities = useMemo(() => entitiesQuery.data?.entities ?? [], [entitiesQuery.data?.entities]);
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
  const scenes = useMemo(() => scenesQuery.data?.scenes ?? [], [scenesQuery.data?.scenes]);
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0] ?? null;

  const pagesQuery = useQuery({
    queryKey: ['pages', selectedEpisode?.id ?? ''],
    queryFn: () => api.getPages(selectedEpisode?.id ?? ''),
    enabled: selectedEpisode !== null,
  });
  const pages = useMemo(() => pagesQuery.data?.pages ?? [], [pagesQuery.data?.pages]);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;

  const compositionsQuery = useQuery({
    queryKey: ['compositions'],
    queryFn: () => api.getCompositions(),
  });
  const compositions = useMemo(
    () => compositionsQuery.data?.compositions ?? [],
    [compositionsQuery.data?.compositions],
  );

  const panelsQuery = useQuery({
    queryKey: ['panels', selectedPage?.id ?? ''],
    queryFn: () => api.getPanels(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const panels = useMemo(() => panelsQuery.data?.panels ?? [], [panelsQuery.data?.panels]);
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) ?? panels[0] ?? null;
  const availablePanelEntities = useMemo(
    () =>
      entities.filter(
        (entity) => !panelDraft.assignments.some((assignment) => assignment.entity_id === entity.id),
      ),
    [entities, panelDraft.assignments],
  );

  const framesQuery = useQuery({
    queryKey: ['frames', selectedPage?.id ?? ''],
    queryFn: () => api.getFrames(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const frames = useMemo(() => framesQuery.data?.frames ?? [], [framesQuery.data?.frames]);

  const balloonsQuery = useQuery({
    queryKey: ['balloons', selectedPage?.id ?? ''],
    queryFn: () => api.getBalloons(selectedPage?.id ?? ''),
    enabled: selectedPage !== null,
  });
  const balloons = useMemo(() => balloonsQuery.data?.balloons ?? [], [balloonsQuery.data?.balloons]);
  const selectedBalloon = balloons.find((balloon) => balloon.id === selectedBalloonId) ?? balloons[0] ?? null;
  const generatedPages = useMemo(
    () => pages.filter((page) => page.generated_image?.cdn_url !== null && page.generated_image?.cdn_url !== undefined),
    [pages],
  );
  const exportablePages = useMemo(() => generatedPages.map((page) => page.id), [generatedPages]);

  const jobQueries = useQueries({
    queries: trackedJobList.map((jobId) => ({
      queryKey: ['job', jobId],
      queryFn: () => api.getJob(jobId),
      refetchInterval: (query: { state: { data: GenerationJobRecord | undefined } }) =>
        query.state.data?.status === 'queued' || query.state.data?.status === 'processing' ? 4000 : false,
    })),
  });
  const jobs = jobQueries.map((query) => query.data).filter(isDefined).slice(0, 5);

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
    if (selectedPage !== null) {
      const nextDraft = toPageSettingsDraft(selectedPage);
      setPageSettingsDraft((current) =>
        current.dialogue_mode === nextDraft.dialogue_mode &&
        current.page_dialogue_toggle === nextDraft.page_dialogue_toggle &&
        current.style_reference_title === nextDraft.style_reference_title &&
        current.style_reference_notes === nextDraft.style_reference_notes &&
        current.story_page_purpose === nextDraft.story_page_purpose &&
        current.story_continuity_note === nextDraft.story_continuity_note &&
        sameStringArray(current.story_source_scene_ids, nextDraft.story_source_scene_ids)
          ? current
          : nextDraft,
      );
    }
  }, [selectedPage]);

  useEffect(() => {
    setExportSelectedPageIds((current) => {
      const filtered = current.filter((pageId) => exportablePages.includes(pageId));
      const fallback = exportablePages.slice(0, 1);

      const isSame = (left: string[], right: string[]): boolean =>
        left.length === right.length && left.every((value, index) => value === right[index]);

      if (filtered.length > 0) {
        return isSame(filtered, current) ? current : filtered;
      }

      return isSame(fallback, current) ? current : fallback;
    });
  }, [exportablePages]);

  useEffect(() => {
    if (selectedEpisode !== null) {
      setExportFilename(sanitizeFilename(selectedEpisode.title ?? `episode-${selectedEpisode.order}`));
    }
  }, [selectedEpisode]);

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
    if (availablePanelEntities.length === 0) {
      setPanelEntityToAddId('');
      return;
    }

    if (!availablePanelEntities.some((entity) => entity.id === panelEntityToAddId)) {
      setPanelEntityToAddId(availablePanelEntities[0]?.id ?? '');
    }
  }, [availablePanelEntities, panelEntityToAddId]);

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

  const generatedReferenceCandidates = useMemo(() => {
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
              source: 'generated' as const,
            },
          ];
        });
      }
    }

    return [];
  }, [jobs, selectedEntity]);

  const referenceCandidates = useMemo(() => {
    if (selectedEntity === null) {
      return [];
    }

    const uploadedCandidates = uploadedReferenceCandidatesByEntityId[selectedEntity.id] ?? [];
    return dedupeReferenceCandidates([...uploadedCandidates, ...generatedReferenceCandidates]);
  }, [generatedReferenceCandidates, selectedEntity, uploadedReferenceCandidatesByEntityId]);

  const characterStructuredFields = useMemo(
    () => parseCharacterStructuredFieldsDraft(entityDraft.structured_fields),
    [entityDraft.structured_fields],
  );

  useEffect(() => {
    if (referenceCandidates.length === 0) {
      setReferenceSelection([]);
      setReferencePrimaryKey('');
      return;
    }

    const hasSelectionForCurrentCandidates = referenceCandidates.some((candidate) =>
      referenceSelection.includes(candidate.s3_key),
    );

    if (referenceCandidates.length > 0 && !hasSelectionForCurrentCandidates) {
      setReferenceSelection(referenceCandidates.map((candidate) => candidate.s3_key));
      setReferencePrimaryKey(referenceCandidates[0]?.s3_key ?? '');
    }
  }, [referenceCandidates, referenceSelection]);

  const saveCurrentEpisodeContext = async (): Promise<void> => {
    if (selectedEpisode !== null) {
      await api.updateEpisode(selectedEpisode.id, toEpisodePayload(episodeDraft));
    }

    if (selectedScene !== null) {
      await api.updateScene(selectedScene.id, toScenePayload(sceneDraft));
    }

    if (selectedChapter !== null) {
      await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter.id] });
    }
    if (selectedEpisode !== null) {
      await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
    }
  };

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

  const toggleExportPageSelection = (pageId: string): void => {
    setExportSelectedPageIds((current) =>
      current.includes(pageId) ? current.filter((id) => id !== pageId) : [...current, pageId],
    );
  };

  const openImageLightbox = (url: string, title: string): void => {
    setLightboxImageUrl(url);
    setLightboxTitle(title);
  };

  const closeImageLightbox = (): void => {
    setLightboxImageUrl(null);
    setLightboxTitle('');
  };

  const handleExport = async (mode: 'selected' | 'all'): Promise<void> => {
    const targetPageIds = mode === 'all' ? exportablePages : exportSelectedPageIds;
    if (targetPageIds.length === 0) {
      throw new Error('No generated pages are selected for export');
    }

    const targetPages = pages.filter((page) => targetPageIds.includes(page.id));
    if (targetPages.length === 0) {
      throw new Error('No generated pages are available for export');
    }

    const baseName = sanitizeFilename(exportFilename.trim().length > 0 ? exportFilename : 'lyra-pages');

    if (exportFormat === 'pdf') {
      const assets = await Promise.all(
        targetPages.map(async (page) => {
          const response = await api.exportPageImage(page.id);
          return {
            page,
            dataUrl: await blobToDataUrl(response.blob),
          };
        }),
      );
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      assets.forEach((asset, index) => {
        if (index > 0) {
          pdf.addPage();
        }
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        pdf.addImage(asset.dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      });
      pdf.save(`${baseName}.pdf`);
      return;
    }

    const multiple = targetPages.length > 1;
    await Promise.all(
      targetPages.map(async (page) => {
        const response = await api.exportPageImage(page.id);
        const extension = inferImageExtension(response.contentType);
        const filename = multiple ? `${baseName}-page-${String(page.page_number).padStart(2, '0')}.${extension}` : `${baseName}.${extension}`;
        triggerBlobDownload(response.blob, filename);
      }),
    );
  };

  return (
    <UiLanguageContext.Provider value={uiLanguage}>
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
                await api.createWork(toCreateWorkPayload(newWorkDraft));
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
            <div className="eyebrow">{translateUiString(uiLanguage, 'Signed in')}</div>
            <strong>{props.email}</strong>
          </div>
          <div className="toolbar">
            <button className={`tab-button ${activeTab === 'story' ? 'active' : ''}`} onClick={() => setActiveTab('story')} type="button">
              <Bot size={16} />
              {translateUiString(uiLanguage, 'Story')}
            </button>
            <button className={`tab-button ${activeTab === 'entities' ? 'active' : ''}`} onClick={() => setActiveTab('entities')} type="button">
              <Image size={16} />
              {translateUiString(uiLanguage, 'Entities')}
            </button>
            <button className={`tab-button ${activeTab === 'pages' ? 'active' : ''}`} onClick={() => setActiveTab('pages')} type="button">
              <PanelsTopLeft size={16} />
              {translateUiString(uiLanguage, 'Pages')}
            </button>
            <select className="toolbar-select" value={uiLanguage} onChange={(event) => setUiLanguageStored(event.target.value)}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
            <button className="ghost-button" onClick={() => void props.onLogout()} type="button">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {notice !== null ? <NoticeBanner notice={notice} /> : null}

        {selectedWork === null ? (
          <section className="empty-state">
            <LayoutGrid size={28} />
            <h2>{translateUiString(uiLanguage, 'No work selected')}</h2>
          </section>
        ) : (
          <div className="workspace-grid">
            <section className="main-column">
              {activeTab === 'story' ? (
                <>
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
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          disabled={selectedEpisode === null || busyAction === 'Generate page skeleton'}
                          onClick={() => {
                            if (selectedEpisode === null) {
                              return;
                            }
                            void runAction('Generate page skeleton', async () => {
                              await saveCurrentEpisodeContext();
                              await api.generatePageSkeleton(selectedEpisode.id, { language: uiLanguage });
                              await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
                              await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
                              await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                            });
                          }}
                          type="button"
                        >
                          {busyAction === 'Generate page skeleton' ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                          {translateUiString(uiLanguage, 'Generate page plan')}
                        </button>
                        <button
                          className="ghost-button"
                          disabled={selectedEpisode === null || busyAction === 'Apply story plan'}
                          onClick={() => {
                            if (selectedEpisode === null) {
                              return;
                            }
                            void runAction('Apply story plan', async () => {
                              await saveCurrentEpisodeContext();
                              await api.autofillEpisodePagesFromStory(selectedEpisode.id, uiLanguage);
                              await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                              setActiveTab('pages');
                            });
                          }}
                          type="button"
                        >
                          <Wand2 size={16} />
                          {translateUiString(uiLanguage, 'Apply story plan')}
                        </button>
                      </div>
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
                              await api.createChapter(selectedWork.id, toCreateChapterPayload(newChapterDraft));
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
                                await api.createEpisode(selectedChapter.id, toCreateEpisodePayload(newEpisodeDraft));
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
                </>
              ) : null}

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
                    subtitle={pickUiText(
                      uiLanguage,
                      'Improve the current episode draft while keeping continuity with the rest of the work.',
                      '作品全体との整合を保ちながら、現在の話の下書きを改善します。',
                    )}
                    actions={
                      <div className="toolbar">
                        <button
                          className="primary-button"
                          disabled={storyBusy || storyInstruction.trim().length === 0}
                          onClick={() => {
                            void (async () => {
                              try {
                                setStoryBusy(true);
                                await saveCurrentEpisodeContext();
                                const result = await api.improveEpisodeDraft({
                                  episode_id: selectedEpisode.id,
                                  instruction: storyInstruction,
                                  language: uiLanguage,
                                  base_draft: {
                                    title: nullableString(episodeDraft.title),
                                    purpose: nullableString(episodeDraft.purpose),
                                    introduction: nullableString(episodeDraft.introduction),
                                    middle: nullableString(episodeDraft.middle),
                                    climax: nullableString(episodeDraft.climax),
                                    ending_hook: nullableString(episodeDraft.ending_hook),
                                  },
                                });
                                setStoryImprovementDraft(result.draft);
                                setStoryImprovementMeta({
                                  compiler_provider: result.compiler_provider,
                                  compiler_model: result.compiler_model,
                                  compiler_prompt_version: result.compiler_prompt_version,
                                  compiler_error: result.compiler_error,
                                });
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
                          {translateUiString(uiLanguage, 'Improve draft')}
                        </button>
                        <button
                          className="ghost-button"
                          disabled={storyImprovementDraft === null}
                          onClick={() =>
                            setEpisodeDraft((current) => ({
                              ...current,
                              title: storyImprovementDraft?.title ?? current.title,
                              purpose: storyImprovementDraft?.purpose ?? current.purpose,
                              introduction: storyImprovementDraft?.introduction ?? current.introduction,
                              middle: storyImprovementDraft?.middle ?? current.middle,
                              climax: storyImprovementDraft?.climax ?? current.climax,
                              ending_hook: storyImprovementDraft?.ending_hook ?? current.ending_hook,
                            }))
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Apply all')}
                        </button>
                      </div>
                    }
                  >
                    <TextAreaField label="Instruction" rows={4} value={storyInstruction} onChange={setStoryInstruction} />
                    {storyImprovementMeta !== null && storyImprovementMeta.compiler_provider !== 'fallback' ? (
                      <div className="muted small">{`AI improved / ${storyImprovementMeta.compiler_model ?? 'Story AI'}`}</div>
                    ) : null}
                    <div className="stack">
                      <TextAreaField
                        label="Improved title"
                        rows={2}
                        value={storyImprovementDraft?.title ?? ''}
                        onChange={(value) =>
                          setStoryImprovementDraft((current) => ({
                            title: value,
                            purpose: current?.purpose ?? '',
                            introduction: current?.introduction ?? '',
                            middle: current?.middle ?? '',
                            climax: current?.climax ?? '',
                            ending_hook: current?.ending_hook ?? '',
                          }))
                        }
                      />
                      <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, title: storyImprovementDraft?.title ?? current.title }))} type="button">
                        <Save size={16} />
                        {translateUiString(uiLanguage, 'Apply to title')}
                      </button>
                    </div>
                    <div className="form-grid two">
                      <div className="stack">
                        <TextAreaField
                          label="Improved purpose"
                          rows={4}
                          value={storyImprovementDraft?.purpose ?? ''}
                          onChange={(value) => setStoryImprovementDraft((current) => ({ ...(current ?? { title: '', purpose: '', introduction: '', middle: '', climax: '', ending_hook: '' }), purpose: value }))}
                        />
                        <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, purpose: storyImprovementDraft?.purpose ?? current.purpose }))} type="button">
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Apply purpose')}
                        </button>
                      </div>
                      <div className="stack">
                        <TextAreaField
                          label="Improved introduction"
                          rows={6}
                          value={storyImprovementDraft?.introduction ?? ''}
                          onChange={(value) => setStoryImprovementDraft((current) => ({ ...(current ?? { title: '', purpose: '', introduction: '', middle: '', climax: '', ending_hook: '' }), introduction: value }))}
                        />
                        <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, introduction: storyImprovementDraft?.introduction ?? current.introduction }))} type="button">
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Apply introduction')}
                        </button>
                      </div>
                    </div>
                    <div className="form-grid two">
                      <div className="stack">
                        <TextAreaField
                          label="Improved middle"
                          rows={6}
                          value={storyImprovementDraft?.middle ?? ''}
                          onChange={(value) => setStoryImprovementDraft((current) => ({ ...(current ?? { title: '', purpose: '', introduction: '', middle: '', climax: '', ending_hook: '' }), middle: value }))}
                        />
                        <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, middle: storyImprovementDraft?.middle ?? current.middle }))} type="button">
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Apply middle')}
                        </button>
                      </div>
                      <div className="stack">
                        <TextAreaField
                          label="Improved climax"
                          rows={6}
                          value={storyImprovementDraft?.climax ?? ''}
                          onChange={(value) => setStoryImprovementDraft((current) => ({ ...(current ?? { title: '', purpose: '', introduction: '', middle: '', climax: '', ending_hook: '' }), climax: value }))}
                        />
                        <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, climax: storyImprovementDraft?.climax ?? current.climax }))} type="button">
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Apply climax')}
                        </button>
                      </div>
                    </div>
                    <div className="stack">
                      <TextAreaField
                        label="Improved ending hook"
                        rows={6}
                        value={storyImprovementDraft?.ending_hook ?? ''}
                        onChange={(value) => setStoryImprovementDraft((current) => ({ ...(current ?? { title: '', purpose: '', introduction: '', middle: '', climax: '', ending_hook: '' }), ending_hook: value }))}
                      />
                      <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, ending_hook: storyImprovementDraft?.ending_hook ?? current.ending_hook }))} type="button">
                        <Save size={16} />
                        {translateUiString(uiLanguage, 'Apply ending hook')}
                      </button>
                    </div>
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
                            await api.createScene(selectedEpisode.id, toCreateScenePayload(sceneDraft));
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
                  <div className="compact-context-card">
                    <div className="compact-context-header">
                      <strong>{translateUiString(uiLanguage, 'Story context')}</strong>
                      <span className="muted small">{translateUiString(uiLanguage, 'Choose the current work, chapter, and episode while editing characters.')}</span>
                    </div>
                    <div className="compact-context-grid">
                      <SelectField
                        label="Work"
                        value={selectedWorkId}
                        onChange={setSelectedWorkId}
                        options={works.map((work) => [work.id, work.title])}
                      />
                      <SelectField
                        label="Chapter"
                        value={selectedChapter?.id ?? ''}
                        onChange={setSelectedChapterId}
                        options={chapters.map((chapter) => [chapter.id, chapter.title ?? `Chapter ${chapter.order}`])}
                      />
                      <SelectField
                        label="Episode"
                        value={selectedEpisode?.id ?? ''}
                        onChange={setSelectedEpisodeId}
                        options={episodes.map((episode) => [episode.id, episode.title ?? `Episode ${episode.order}`])}
                      />
                    </div>
                  </div>

                  <PanelSection
                    title="Character list"
                    subtitle={`${entities.length} records`}
                    collapsible
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
                        {translateUiString(uiLanguage, 'New character')}
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
                  </PanelSection>

                  <PanelSection
                    title="Character editor"
                    className="character-editor-section"
                    collapsible
                    actions={
                      <div className="toolbar">
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setSelectedEntityId('');
                            setEntityDraft(createEmptyEntityDraft());
                          }}
                          type="button"
                        >
                          <RefreshCw size={16} />
                          {translateUiString(uiLanguage, 'Reset draft')}
                        </button>
                        {selectedEntity !== null ? (
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
                        ) : null}
                      </div>
                    }
                  >
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
                    {entityDraft.entity_type === 'character' ? (
                      <CharacterStructuredFieldsEditor
                        value={characterStructuredFields}
                        onChange={(nextValue) =>
                          setEntityDraft((current) => ({
                            ...current,
                            structured_fields: serializeCharacterStructuredFieldsDraft(nextValue),
                          }))
                        }
                      />
                    ) : (
                      <TextAreaField
                        label="Structured fields JSON"
                        rows={6}
                        value={entityDraft.structured_fields}
                        onChange={(value) => setEntityDraft({ ...entityDraft, structured_fields: value })}
                      />
                    )}
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
                        {translateUiString(uiLanguage, 'Create')}
                      </button>
                      {selectedEntity !== null ? (
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
                          {translateUiString(uiLanguage, 'Save selected')}
                        </button>
                      ) : null}
                    </div>
                  </PanelSection>

                  <PanelSection title="Import / References" collapsible>
                    <label className="file-drop">
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void handleEntityImport(
                            event,
                            entityDraft.entity_type,
                            selectedEntity?.id ?? null,
                            api,
                            setImportingImage,
                            setNotice,
                            setEntityDraft,
                            setUploadedReferenceCandidatesByEntityId,
                            setUploadedReferenceSourceByEntityId,
                          )
                        }
                        type="file"
                      />
                      <span>{importingImage ? translateUiString(uiLanguage, 'Importing image...') : translateUiString(uiLanguage, 'Drop or choose image')}</span>
                    </label>
                    {selectedEntity !== null ? (
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Generate reference', async () => {
                              const sourceS3Key = uploadedReferenceSourceByEntityId[selectedEntity.id];
                              const result = await api.generateEntityReference(
                                selectedEntity.id,
                                sourceS3Key === undefined ? undefined : { source_s3_key: sourceS3Key },
                              );
                              trackJob(result.job_id);
                            })
                          }
                          type="button"
                        >
                          <Sparkles size={16} />
                          {translateUiString(uiLanguage, 'Generate full-body candidates')}
                        </button>
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
                              setUploadedReferenceCandidatesByEntityId((current) => {
                                const nextValue = { ...current };
                                delete nextValue[selectedEntity.id];
                                return nextValue;
                              });
                              await queryClient.invalidateQueries({ queryKey: ['entity-reference-set', selectedEntity.id] });
                            })
                          }
                          type="button"
                        >
                          <Check size={16} />
                          {translateUiString(uiLanguage, 'Confirm')}
                        </button>
                      </div>
                    ) : null}
                    <div className="reference-management-grid">
                      <div className="stack">
                        <div className="section-header">
                          <div>
                            <h3>{translateUiString(uiLanguage, 'Generated preview')}</h3>
                            <div className="muted small">{translateUiString(uiLanguage, 'Select one or more candidates and choose a primary image.')}</div>
                          </div>
                        </div>
                        {referenceCandidates.length > 0 ? (
                          <div className="reference-grid reference-grid-portrait">
                            {referenceCandidates.map((candidate) => (
                              <label key={candidate.s3_key} className={`reference-card reference-card-portrait ${referenceSelection.includes(candidate.s3_key) ? 'active' : ''}`}>
                                <div className="reference-card-media">
                                  <img alt="" src={candidate.cdn_url} />
                                </div>
                                <div className="reference-card-body">
                                  <span>{candidate.source}</span>
                                </div>
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
                        ) : (
                          <div className="selection-empty">{translateUiString(uiLanguage, 'No preview candidates yet.')}</div>
                        )}
                      </div>
                      <div className="stack">
                        <div className="section-header">
                          <div>
                            <h3>{translateUiString(uiLanguage, 'Confirmed references')}</h3>
                            <div className="muted small">{translateUiString(uiLanguage, 'Delete with the button only. Clicking the image will not delete it.')}</div>
                          </div>
                        </div>
                        {entityReferenceSetQuery.data !== undefined && entityReferenceSetQuery.data.reference_images.length > 0 ? (
                          <div className="reference-grid reference-grid-portrait">
                            {entityReferenceSetQuery.data.reference_images.map((image) => (
                              <div key={image.ref_id} className="reference-card reference-card-portrait">
                                <div className="reference-card-media">
                                  <img alt="" src={image.cdn_url} />
                                </div>
                                <div className="reference-card-body">
                                  <strong>{image.ref_id === entityReferenceSetQuery.data.primary_ref_id ? translateUiString(uiLanguage, 'Primary') : image.source}</strong>
                                </div>
                                <div className="reference-card-actions">
                                  <button
                                    className="ghost-button danger"
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
                                    <Trash2 size={16} />
                                    {translateUiString(uiLanguage, 'Delete')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="selection-empty">{translateUiString(uiLanguage, 'No confirmed references yet.')}</div>
                        )}
                      </div>
                    </div>
                  </PanelSection>
                </>
              ) : null}

              {activeTab === 'pages' && selectedEpisode !== null ? (
                <>
                  <div className="compact-context-card">
                    <div className="compact-context-header">
                      <strong>{translateUiString(uiLanguage, 'Target episode')}</strong>
                      <span className="muted small">{translateUiString(uiLanguage, 'Switch story context for page editing.')}</span>
                    </div>
                    <div className="compact-context-grid">
                      <SelectField
                        label="Work"
                        value={selectedWorkId}
                        onChange={setSelectedWorkId}
                        options={works.map((work) => [work.id, work.title])}
                      />
                      <SelectField
                        label="Chapter"
                        value={selectedChapter?.id ?? ''}
                        onChange={setSelectedChapterId}
                        options={chapters.map((chapter) => [chapter.id, chapter.title ?? `Chapter ${chapter.order}`])}
                      />
                      <SelectField
                        label="Episode"
                        value={selectedEpisode?.id ?? ''}
                        onChange={setSelectedEpisodeId}
                        options={episodes.map((episode) => [episode.id, episode.title ?? `Episode ${episode.order}`])}
                      />
                    </div>
                  </div>

                  <div className="page-sections-stack">
                  <PanelSection title="Pages" collapsible>
                    <div className="page-grid">
                      {pages.map((page) => (
                        <button
                          key={page.id}
                          className={`page-card ${selectedPage?.id === page.id ? 'active' : ''}`}
                          onClick={() => setSelectedPageId(page.id)}
                          onDoubleClick={() => {
                            if (page.generated_image?.cdn_url !== null && page.generated_image?.cdn_url !== undefined) {
                              openImageLightbox(page.generated_image.cdn_url, `${translateUiString(uiLanguage, 'Page')} ${page.page_number}`);
                            }
                          }}
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
                          <div className="page-meta-list">
                            <span>{`frames ${page.frame_count} / panels ${page.panel_count} / balloons ${page.balloon_count}`}</span>
                            <span>{translateUiString(uiLanguage, 'Double-click image to enlarge')}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PanelSection>

                  {selectedPage !== null ? (
                    <>
                      <PanelSection title="Page settings" className="page-section-settings" collapsible actions={
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Save page settings', async () => {
                              await api.updatePage(selectedPage.id, toPageSettingsPayload(pageSettingsDraft));
                              await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Save')}
                        </button>
                      }>
                        <div className="form-grid three">
                          <SelectField
                            label="Dialogue mode"
                            value={pageSettingsDraft.dialogue_mode}
                            onChange={(value) => setPageSettingsDraft((current) => ({ ...current, dialogue_mode: value as PageSettingsDraft['dialogue_mode'] }))}
                            options={[
                              ['image_baked', 'Image baked'],
                              ['balloon_only', 'Balloon only'],
                              ['mixed', 'Mixed'],
                            ]}
                          />
                          <label className="checkbox-row">
                            <input
                              checked={pageSettingsDraft.page_dialogue_toggle}
                              onChange={(event) => setPageSettingsDraft((current) => ({ ...current, page_dialogue_toggle: event.target.checked }))}
                              type="checkbox"
                            />
                            {translateUiString(uiLanguage, 'Dialogue toggle')}
                          </label>
                        </div>
                        <div className="form-grid two">
                          <InputField
                            label="Style reference title"
                            value={pageSettingsDraft.style_reference_title}
                            onChange={(value) => setPageSettingsDraft((current) => ({ ...current, style_reference_title: value }))}
                          />
                          <InputField
                            label="Style reference notes"
                            value={pageSettingsDraft.style_reference_notes}
                            onChange={(value) => setPageSettingsDraft((current) => ({ ...current, style_reference_notes: value }))}
                          />
                        </div>
                      </PanelSection>

                      <PanelSection
                        title="Story sources"
                        className="page-section-story-sources"
                        collapsible
                        actions={
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Save story sources', async () => {
                                await api.updatePage(selectedPage.id, toPageSettingsPayload(pageSettingsDraft));
                                await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Save')}
                          </button>
                        }
                      >
                        <div className="field-group">
                          <label className="field-label">{translateUiString(uiLanguage, 'Source scenes')}</label>
                          <div className="breadcrumb-row">
                            {resolveStorySourceScenes(pageSettingsDraft.story_source_scene_ids, scenes).length > 0 ? (
                              resolveStorySourceScenes(pageSettingsDraft.story_source_scene_ids, scenes).map((scene) => (
                                <span key={scene.id} className="context-chip">
                                  {formatStorySourceSceneLabel(scene, uiLanguage)}
                                </span>
                              ))
                            ) : (
                              <span className="muted-text">
                                {uiLanguage === 'ja' ? 'まだ関連シーンが設定されていません' : 'No linked scenes yet'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="form-grid two">
                          <TextAreaField
                            label="Page purpose"
                            rows={2}
                            value={pageSettingsDraft.story_page_purpose}
                            onChange={(value) =>
                              setPageSettingsDraft((current) => ({ ...current, story_page_purpose: value }))
                            }
                          />
                          <TextAreaField
                            label="Continuity note"
                            rows={2}
                            value={pageSettingsDraft.story_continuity_note}
                            onChange={(value) =>
                              setPageSettingsDraft((current) => ({ ...current, story_continuity_note: value }))
                            }
                          />
                        </div>
                      </PanelSection>

                      <PanelSection
                        title={`Page ${selectedPage.page_number}`}
                        subtitle={`dialogue ${selectedPage.dialogue_mode}`}
                        className="page-section-generate"
                        collapsible
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
                            <img
                              alt=""
                              className="generated-image"
                              onDoubleClick={() => openImageLightbox(selectedPage.generated_image?.cdn_url ?? '', `${translateUiString(uiLanguage, 'Page')} ${selectedPage.page_number}`)}
                              src={selectedPage.generated_image.cdn_url}
                            />
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

                      <div className="page-editing-cluster page-section-frames-panels">
                      <PanelSection
                        title="Frames"
                        collapsible
                        actions={
                          <div className="toolbar">
                            <label className="field" style={{ minWidth: '14rem' }}>
                              <span>Template</span>
                              <select value={frameTemplateId} onChange={(event) => setFrameTemplateId(event.target.value)}>
                                {FRAME_TEMPLATE_OPTIONS.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
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
                        <div className="muted small">
                          {uiLanguage === 'ja'
                            ? '通常の編集はテンプレートで行い、細かなコマ形状の編集が必要なときだけ詳細設定を開いてください。'
                            : 'Use templates for normal layout editing. Open advanced settings only when you need manual frame geometry.'}
                        </div>
                        <details className="advanced-disclosure">
                          <summary>{translateUiString(uiLanguage, 'Advanced frame geometry')}</summary>
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
                        </details>
                      </PanelSection>

                      <PanelSection title="Panels" collapsible>
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
                            options={PANEL_ROLE_OPTIONS}
                          />
                          <SelectField
                            label="Size"
                            value={panelDraft.panel_size}
                            onChange={(value) => setPanelDraft({ ...panelDraft, panel_size: value as PanelDraft['panel_size'] })}
                            options={PANEL_SIZE_OPTIONS}
                          />
                        </div>
                        <TextAreaField label="Situation" rows={3} value={panelDraft.situation_text} onChange={(value) => setPanelDraft({ ...panelDraft, situation_text: value })} />
                        <div className="form-grid three">
                          <SelectField
                            label="Composition source"
                            value={panelDraft.composition_source}
                            onChange={(value) =>
                              setPanelDraft({
                                ...panelDraft,
                                composition_source: value as PanelDraft['composition_source'],
                                composition_gallery_item_id: value === 'gallery' ? panelDraft.composition_gallery_item_id : '',
                              })
                            }
                            options={PANEL_COMPOSITION_SOURCE_OPTIONS}
                          />
                          <SelectField
                            label="Shot"
                            value={panelDraft.shot_type}
                            onChange={(value) => setPanelDraft({ ...panelDraft, shot_type: value as PanelDraft['shot_type'] })}
                            options={PANEL_SHOT_TYPE_OPTIONS}
                          />
                          <SelectField
                            label="Angle"
                            value={panelDraft.angle}
                            onChange={(value) => setPanelDraft({ ...panelDraft, angle: value as PanelDraft['angle'] })}
                            options={PANEL_ANGLE_OPTIONS}
                          />
                        </div>
                        <div className="form-grid two">
                          <InputField label="Background" value={panelDraft.background_note} onChange={(value) => setPanelDraft({ ...panelDraft, background_note: value })} />
                          <InputField label="SFX" value={panelDraft.sfx_text} onChange={(value) => setPanelDraft({ ...panelDraft, sfx_text: value })} />
                        </div>
                        <TextAreaField label="Overall composition note" rows={3} value={panelDraft.composition_prompt} onChange={(value) => setPanelDraft({ ...panelDraft, composition_prompt: value })} />
                        <TextAreaField label="Extra camera / staging note" rows={3} value={panelDraft.custom_note} onChange={(value) => setPanelDraft({ ...panelDraft, custom_note: value })} />
                        <InputField label="Notes" value={panelDraft.panel_notes} onChange={(value) => setPanelDraft({ ...panelDraft, panel_notes: value })} />
                        <label className="checkbox-row">
                          <input
                            checked={panelDraft.dialogue_in_panel}
                            onChange={(event) => setPanelDraft({ ...panelDraft, dialogue_in_panel: event.target.checked })}
                            type="checkbox"
                          />
                          Dialogue in panel
                        </label>
                        <PanelAssignmentEditor
                          assignments={panelDraft.assignments}
                          availableEntities={availablePanelEntities}
                          allEntities={entities}
                          onAddEntity={(entityId) =>
                            setPanelDraft((current) => ({
                              ...current,
                              assignments: [...current.assignments, createEmptyPanelAssignmentDraft(entityId)],
                            }))
                          }
                          onChange={(assignments) => setPanelDraft({ ...panelDraft, assignments })}
                          pendingEntityId={panelEntityToAddId}
                          onPendingEntityIdChange={setPanelEntityToAddId}
                        />
                        <PanelDialogueEditor
                          dialogueInPanel={panelDraft.dialogue_in_panel}
                          dialogues={panelDraft.dialogues}
                          entities={entities}
                          onChange={(dialogues) => setPanelDraft({ ...panelDraft, dialogues })}
                        />
                        <div className="toolbar">
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Create panel', async () => {
                                const assignmentsPayload = toPanelAssignmentsPayload(panelDraft);
                                const createdPanel = await api.createPanel(selectedPage.id, toPanelPayload(panelDraft));
                                try {
                                  await api.replacePanelAssignments(createdPanel.id, assignmentsPayload);
                                } catch (error) {
                                  await api.deletePanel(createdPanel.id).catch(() => undefined);
                                  throw error;
                                }
                                setSelectedPanelId(createdPanel.id);
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
                                    const assignmentsPayload = toPanelAssignmentsPayload(panelDraft);
                                    await api.updatePanel(selectedPanel.id, toPanelPayload(panelDraft));
                                    await api.replacePanelAssignments(selectedPanel.id, assignmentsPayload);
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
                                  composition_source: 'gallery',
                                  composition_gallery_item_id: composition.id,
                                  composition_prompt: composition.composition_prompt,
                                  shot_type: composition.shot_type ?? '',
                                  angle: composition.angle ?? '',
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
                      </div>

                      <PanelSection title="Export / 保存" className="page-section-export" collapsible>
                        <div className="form-grid three">
                          <SelectField
                            label="Format"
                            value={exportFormat}
                            onChange={(value) => setExportFormat(value as ExportFormat)}
                            options={[
                              ['pdf', 'PDF'],
                              ['image', 'Image'],
                            ]}
                          />
                          <InputField
                            label="Filename"
                            value={exportFilename}
                            onChange={setExportFilename}
                          />
                        </div>
                        <div className="entity-choice-grid">
                          {generatedPages.map((page) => (
                            <label key={page.id} className={`entity-choice ${exportSelectedPageIds.includes(page.id) ? 'active' : ''}`}>
                              <input
                                checked={exportSelectedPageIds.includes(page.id)}
                                onChange={() => toggleExportPageSelection(page.id)}
                                type="checkbox"
                              />
                              <div className="entity-choice-body">
                                <strong>{`${translateUiString(uiLanguage, 'Page')} ${page.page_number}`}</strong>
                                <span className="muted small">{page.generated_image?.generation_mode ?? 'generated'}</span>
                              </div>
                            </label>
                          ))}
                        </div>
                        <div className="toolbar">
                          <button
                            className="secondary-button"
                            onClick={() => void runAction('Export selected', async () => { await handleExport('selected'); })}
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Export selected')}
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => void runAction('Export all', async () => { await handleExport('all'); })}
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Export all')}
                          </button>
                        </div>
                      </PanelSection>

                      <PanelSection title="Page autofill" className="page-section-autofill" compact collapsible defaultCollapsed actions={
                        <button
                          className="ghost-button"
                          onClick={() =>
                            void runAction('Fill selected page', async () => {
                              await api.autofillPageFromScenes(selectedPage.id, uiLanguage);
                              await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                            })
                          }
                          type="button"
                        >
                          <Wand2 size={16} />
                          {translateUiString(uiLanguage, 'Fill selected page')}
                        </button>
                      }>
                        <div className="muted small">{translateUiString(uiLanguage, 'Use this after the story plan when a single page still needs refinement.')}</div>
                      </PanelSection>

                      <PanelSection
                        title="Balloons"
                        className="page-section-balloons"
                        collapsible
                        defaultCollapsed
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
                          <InputField label="Font size" value={balloonDraft.font_size} onChange={(value) => setBalloonDraft({ ...balloonDraft, font_size: value })} />
                          <InputField label="Font family" value={balloonDraft.font_family} onChange={(value) => setBalloonDraft({ ...balloonDraft, font_family: value })} />
                        </div>
                        <details className="advanced-disclosure">
                          <summary>{translateUiString(uiLanguage, 'Advanced balloon geometry')}</summary>
                          <div className="form-grid two">
                            <TextAreaField label="Position JSON" rows={4} value={balloonDraft.position_json} onChange={(value) => setBalloonDraft({ ...balloonDraft, position_json: value })} />
                            <TextAreaField label="Tail JSON / null" rows={4} value={balloonDraft.tail_json} onChange={(value) => setBalloonDraft({ ...balloonDraft, tail_json: value })} />
                          </div>
                          <div className="form-grid two">
                            <InputField label="Panel order ref" value={balloonDraft.panel_order_reference} onChange={(value) => setBalloonDraft({ ...balloonDraft, panel_order_reference: value })} />
                            <InputField label="Z-index" value={balloonDraft.z_index} onChange={(value) => setBalloonDraft({ ...balloonDraft, z_index: value })} />
                          </div>
                        </details>
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
                  </div>
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
      {lightboxImageUrl !== null ? (
        <div className="image-lightbox" onClick={closeImageLightbox} role="presentation">
          <div className="image-lightbox-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="image-lightbox-header">
              <strong>{lightboxTitle}</strong>
              <button className="ghost-button image-lightbox-close" onClick={closeImageLightbox} type="button">
                ×
              </button>
            </div>
            <div className="image-lightbox-body">
              <img alt="" src={lightboxImageUrl} />
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </UiLanguageContext.Provider>
  );
}

function PanelSection(props: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const language = useContext(UiLanguageContext);
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);
  return (
    <section className={`panel-section ${props.compact ? 'compact' : ''} ${collapsed ? 'collapsed' : ''} ${props.className ?? ''}`.trim()}>
      {props.collapsible ? (
        <div className="section-header">
          <button className="section-toggle" onClick={() => setCollapsed((current) => !current)} type="button">
            <div className="section-toggle-copy">
              <h2>{translateUiString(language, props.title)}</h2>
              {props.subtitle !== undefined ? <div className="muted">{translateUiString(language, props.subtitle)}</div> : null}
            </div>
            <ChevronDown className={`section-toggle-icon ${collapsed ? '' : 'open'}`.trim()} size={16} />
          </button>
          <div className="section-toggle-actions">
            {props.actions}
          </div>
        </div>
      ) : (
        <div className="section-header">
          <div>
            <h2>{translateUiString(language, props.title)}</h2>
            {props.subtitle !== undefined ? <div className="muted">{translateUiString(language, props.subtitle)}</div> : null}
          </div>
          {props.actions}
        </div>
      )}
      {!collapsed ? props.children : null}
    </section>
  );
}

function NoticeBanner(props: { notice: NoticeState }) {
  return <div className={`notice ${props.notice.type}`}>{props.notice.message}</div>;
}

function StatusBadge(props: { value: string }) {
  const language = useContext(UiLanguageContext);
  return <span className={`status-badge status-${props.value}`}>{translateUiString(language, props.value)}</span>;
}

function InputField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const language = useContext(UiLanguageContext);
  return (
    <label className="field">
      <span>{translateUiString(language, props.label)}</span>
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
  const language = useContext(UiLanguageContext);
  return (
    <label className="field">
      <span>{translateUiString(language, props.label)}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {translateUiString(language, label)}
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
  const language = useContext(UiLanguageContext);
  return (
    <label className="field">
      <span>{translateUiString(language, props.label)}</span>
      <textarea rows={props.rows} value={props.value} onChange={(event) => props.onChange(event.target.value)} spellCheck={false} />
    </label>
  );
}

function CharacterStructuredFieldsEditor(props: {
  value: CharacterStructuredFieldsDraft;
  onChange: (nextValue: CharacterStructuredFieldsDraft) => void;
}) {
  const update = (patch: Partial<CharacterStructuredFieldsDraft>): void => {
    props.onChange({
      ...props.value,
      ...patch,
    });
  };

  return (
    <div className="character-fields-stack">
      <div className="character-fields-group">
        <div className="character-fields-group-title">Identity</div>
        <div className="form-grid three compact-grid">
          <SelectField label="Gender" value={props.value.gender_expression} onChange={(value) => update({ gender_expression: value })} options={CHARACTER_GENDER_OPTIONS} />
          <SelectField label="Age range" value={props.value.age_range} onChange={(value) => update({ age_range: value })} options={CHARACTER_AGE_RANGE_OPTIONS} />
          <SelectField label="Skin tone" value={props.value.skin_tone} onChange={(value) => update({ skin_tone: value })} options={CHARACTER_SKIN_TONE_OPTIONS} />
          <SelectField label="First impression" value={props.value.first_impression} onChange={(value) => update({ first_impression: value })} options={CHARACTER_FIRST_IMPRESSION_OPTIONS} />
          <SelectField label="Standing style" value={props.value.standing_style} onChange={(value) => update({ standing_style: value })} options={CHARACTER_STANDING_STYLE_OPTIONS} />
          <SelectField label="Default expression" value={props.value.default_expression} onChange={(value) => update({ default_expression: value })} options={CHARACTER_DEFAULT_EXPRESSION_OPTIONS} />
          <SelectField label="Height" value={props.value.height} onChange={(value) => update({ height: value })} options={CHARACTER_HEIGHT_OPTIONS} />
          <SelectField label="Body type" value={props.value.build} onChange={(value) => update({ build: value })} options={CHARACTER_BUILD_OPTIONS} />
          <SelectField label="Art style" value={props.value.art_style} onChange={(value) => update({ art_style: value })} options={CHARACTER_ART_STYLE_OPTIONS} />
        </div>
      </div>

      <div className="character-fields-group">
        <div className="character-fields-group-title">Anchors</div>
        <div className="form-grid two compact-grid">
          <InputField label="Visual anchor" value={props.value.visual_anchor} onChange={(value) => update({ visual_anchor: value })} />
          <InputField label="Signature feature" value={props.value.signature_feature} onChange={(value) => update({ signature_feature: value })} />
        </div>
        <div className="form-grid two compact-grid">
          <InputField label="Silhouette keywords" value={props.value.silhouette_keywords} onChange={(value) => update({ silhouette_keywords: value })} />
          <InputField label="Distinguishing features" value={props.value.distinguishing_features} onChange={(value) => update({ distinguishing_features: value })} />
        </div>
        <div className="form-grid four compact-grid">
          <InputField label="Head/body ratio" value={props.value.head_to_body_ratio} onChange={(value) => update({ head_to_body_ratio: value })} />
          <InputField label="Shoulder width" value={props.value.shoulder_width} onChange={(value) => update({ shoulder_width: value })} />
          <InputField label="Leg length" value={props.value.leg_length} onChange={(value) => update({ leg_length: value })} />
          <InputField label="Posture axis" value={props.value.posture_axis} onChange={(value) => update({ posture_axis: value })} />
        </div>
      </div>

      <div className="character-fields-group">
        <div className="character-fields-group-title">Face</div>
        <div className="form-grid four compact-grid">
          <SelectField label="Face shape" value={props.value.face_shape} onChange={(value) => update({ face_shape: value })} options={CHARACTER_FACE_SHAPE_OPTIONS} />
          <SelectField label="Eyebrow shape" value={props.value.eyebrow_shape} onChange={(value) => update({ eyebrow_shape: value })} options={CHARACTER_EYEBROW_SHAPE_OPTIONS} />
          <SelectField label="Nose shape" value={props.value.nose_shape} onChange={(value) => update({ nose_shape: value })} options={CHARACTER_NOSE_SHAPE_OPTIONS} />
          <SelectField label="Mouth shape" value={props.value.mouth_shape} onChange={(value) => update({ mouth_shape: value })} options={CHARACTER_MOUTH_SHAPE_OPTIONS} />
          <SelectField label="Eye color" value={props.value.eye_color} onChange={(value) => update({ eye_color: value })} options={CHARACTER_EYE_COLOR_OPTIONS} />
          <SelectField label="Eye shape" value={props.value.eye_shape} onChange={(value) => update({ eye_shape: value })} options={CHARACTER_EYE_SHAPE_OPTIONS} />
          <SelectField label="Eyelid type" value={props.value.eyelid_type} onChange={(value) => update({ eyelid_type: value })} options={CHARACTER_EYELID_TYPE_OPTIONS} />
          <InputField label="Eye size" value={props.value.eye_size} onChange={(value) => update({ eye_size: value })} />
          <InputField label="Eye angle" value={props.value.eye_angle} onChange={(value) => update({ eye_angle: value })} />
          <InputField label="Pupil style" value={props.value.pupil_style} onChange={(value) => update({ pupil_style: value })} />
          <InputField label="Under-eye detail" value={props.value.under_eye_detail} onChange={(value) => update({ under_eye_detail: value })} />
          <InputField label="Mouth default" value={props.value.mouth_default} onChange={(value) => update({ mouth_default: value })} />
        </div>
      </div>

      <div className="character-fields-group">
        <div className="character-fields-group-title">Hair</div>
        <div className="form-grid five compact-grid">
          <SelectField label="Hair color" value={props.value.hair_color} onChange={(value) => update({ hair_color: value })} options={CHARACTER_HAIR_COLOR_OPTIONS} />
          <SelectField label="Hair length" value={props.value.hair_length} onChange={(value) => update({ hair_length: value })} options={CHARACTER_HAIR_LENGTH_OPTIONS} />
          <SelectField label="Hair style" value={props.value.hair_style} onChange={(value) => update({ hair_style: value })} options={CHARACTER_HAIR_STYLE_OPTIONS} />
          <SelectField label="Hair arrangement" value={props.value.hair_arrangement} onChange={(value) => update({ hair_arrangement: value })} options={CHARACTER_HAIR_ARRANGEMENT_OPTIONS} />
          <SelectField label="Bangs" value={props.value.hair_bangs} onChange={(value) => update({ hair_bangs: value })} options={CHARACTER_HAIR_BANGS_OPTIONS} />
        </div>
        <div className="form-grid three compact-grid">
          <InputField label="Front shape" value={props.value.hair_front_shape} onChange={(value) => update({ hair_front_shape: value })} />
          <InputField label="Side hair" value={props.value.hair_side_hair} onChange={(value) => update({ hair_side_hair: value })} />
          <InputField label="Back shape" value={props.value.hair_back_shape} onChange={(value) => update({ hair_back_shape: value })} />
        </div>
      </div>

      <div className="character-fields-group">
        <div className="character-fields-group-title">Outfit</div>
        <div className="form-grid three compact-grid">
          <SelectField label="Category" value={props.value.clothing_category} onChange={(value) => update({ clothing_category: value })} options={CHARACTER_CLOTHING_CATEGORY_OPTIONS} />
          <SelectField label="Main color" value={props.value.clothing_main_color} onChange={(value) => update({ clothing_main_color: value })} options={CHARACTER_CLOTHING_COLOR_OPTIONS} />
          <SelectField label="Impression" value={props.value.clothing_impression} onChange={(value) => update({ clothing_impression: value })} options={CHARACTER_CLOTHING_IMPRESSION_OPTIONS} />
          <InputField label="Collar shape" value={props.value.collar_shape} onChange={(value) => update({ collar_shape: value })} />
          <InputField label="Sleeve length" value={props.value.sleeve_length} onChange={(value) => update({ sleeve_length: value })} />
          <InputField label="Skirt or pants" value={props.value.skirt_or_pants_shape} onChange={(value) => update({ skirt_or_pants_shape: value })} />
          <InputField label="Shoes" value={props.value.shoes} onChange={(value) => update({ shoes: value })} />
          <InputField label="Legwear" value={props.value.socks_or_legwear} onChange={(value) => update({ socks_or_legwear: value })} />
        </div>
        <TextAreaField label="Clothing details" rows={2} value={props.value.clothing_description} onChange={(value) => update({ clothing_description: value })} />
      </div>
    </div>
  );
}

function PanelAssignmentEditor(props: {
  assignments: PanelAssignmentDraft[];
  availableEntities: EntityRecord[];
  allEntities: EntityRecord[];
  pendingEntityId: string;
  onPendingEntityIdChange: (value: string) => void;
  onAddEntity: (entityId: string) => void;
  onChange: (nextValue: PanelAssignmentDraft[]) => void;
}) {
  const updateAssignment = (
    entityId: string,
    patch: Partial<PanelAssignmentDraft>,
  ): void => {
    props.onChange(
      props.assignments.map((assignment) =>
        assignment.entity_id === entityId ? { ...assignment, ...patch } : assignment,
      ),
    );
  };

  const removeAssignment = (entityId: string): void => {
    props.onChange(props.assignments.filter((assignment) => assignment.entity_id !== entityId));
  };

  return (
    <div className="stack">
      <div className="section-header">
        <div>
          <h3>Characters in panel</h3>
          <div className="muted">Pick who appears first, then refine pose, facing, and effects per character.</div>
        </div>
      </div>
      <div className="toolbar">
        <label className="field" style={{ minWidth: '16rem' }}>
          <span>Add character</span>
          <select
            value={props.pendingEntityId}
            onChange={(event) => props.onPendingEntityIdChange(event.target.value)}
          >
            {props.availableEntities.length === 0 ? (
              <option value="">No more entities</option>
            ) : (
              props.availableEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          className="secondary-button"
          disabled={props.pendingEntityId.length === 0}
          onClick={() => props.onAddEntity(props.pendingEntityId)}
          type="button"
        >
          <Save size={16} />
          Add to panel
        </button>
      </div>
      {props.assignments.length === 0 ? (
        <div className="muted">No characters assigned yet.</div>
      ) : (
        props.assignments.map((assignment) => {
          const entity = props.allEntities.find((entry) => entry.id === assignment.entity_id);

          return (
            <div key={assignment.entity_id} className="panel-section compact">
              <div className="section-header">
                <div>
                  <h3>{entity?.name ?? assignment.entity_id}</h3>
                  <div className="muted">Placement first, then expression, pose, and effect.</div>
                </div>
                <button
                  className="ghost-button danger"
                  onClick={() => removeAssignment(assignment.entity_id)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="form-grid four">
                <SelectField
                  label="Role"
                  value={assignment.role}
                  onChange={(value) => updateAssignment(assignment.entity_id, { role: value as PanelAssignmentDraft['role'] })}
                  options={PANEL_ENTITY_ROLE_OPTIONS}
                />
                <SelectField
                  label="Placement"
                  value={assignment.position}
                  onChange={(value) =>
                    updateAssignment(assignment.entity_id, { position: value as PanelAssignmentDraft['position'] })
                  }
                  options={PANEL_ENTITY_POSITION_OPTIONS}
                />
                <SelectField
                  label="Facing"
                  value={assignment.facing_direction}
                  onChange={(value) =>
                    updateAssignment(assignment.entity_id, {
                      facing_direction: value as PanelAssignmentDraft['facing_direction'],
                    })
                  }
                  options={PANEL_ENTITY_FACING_OPTIONS}
                />
                <InputField
                  label="State override ID"
                  value={assignment.state_id}
                  onChange={(value) => updateAssignment(assignment.entity_id, { state_id: value })}
                />
              </div>
              <div className="form-grid three">
                <SelectField
                  label="Expression"
                  value={assignment.expression}
                  onChange={(value) =>
                    updateAssignment(assignment.entity_id, {
                      expression: value as PanelAssignmentDraft['expression'],
                      custom_expression: value === 'custom' ? assignment.custom_expression : '',
                    })
                  }
                  options={PANEL_ENTITY_EXPRESSION_OPTIONS}
                />
                <SelectField
                  label="Pose"
                  value={assignment.action}
                  onChange={(value) =>
                    updateAssignment(assignment.entity_id, {
                      action: value as PanelAssignmentDraft['action'],
                      custom_action: value === 'custom' ? assignment.custom_action : '',
                    })
                  }
                  options={PANEL_ENTITY_POSE_OPTIONS}
                />
                <InputField
                  label="Effect"
                  value={assignment.effect_note}
                  onChange={(value) => updateAssignment(assignment.entity_id, { effect_note: value })}
                />
              </div>
              {assignment.expression === 'custom' || assignment.action === 'custom' ? (
                <div className="form-grid two">
                  {assignment.expression === 'custom' ? (
                    <InputField
                      label="Custom expression"
                      value={assignment.custom_expression}
                      onChange={(value) =>
                        updateAssignment(assignment.entity_id, { custom_expression: value })
                      }
                    />
                  ) : (
                    <div />
                  )}
                  {assignment.action === 'custom' ? (
                    <InputField
                      label="Custom pose"
                      value={assignment.custom_action}
                      onChange={(value) => updateAssignment(assignment.entity_id, { custom_action: value })}
                    />
                  ) : (
                    <div />
                  )}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function PanelDialogueEditor(props: {
  dialogueInPanel: boolean;
  dialogues: PanelDialogueDraft[];
  entities: EntityRecord[];
  onChange: (nextValue: PanelDialogueDraft[]) => void;
}) {
  const updateDialogue = (index: number, patch: Partial<PanelDialogueDraft>): void => {
    props.onChange(
      props.dialogues.map((dialogue, currentIndex) =>
        currentIndex === index ? { ...dialogue, ...patch } : dialogue,
      ),
    );
  };

  const removeDialogue = (index: number): void => {
    props.onChange(props.dialogues.filter((_, currentIndex) => currentIndex !== index));
  };

  const addDialogue = (): void => {
    props.onChange([
      ...props.dialogues,
      {
        entity_id: '',
        text: '',
        type: 'speech',
        position: 'top',
      },
    ]);
  };

  return (
    <div className="stack">
      <div className="section-header">
        <div>
          <h3>Dialogue</h3>
          <div className="muted">
            {props.dialogueInPanel
              ? 'These lines will be considered inside the generated panel art.'
              : 'These lines stay outside the generated panel art.'}
          </div>
        </div>
        <button className="ghost-button" onClick={addDialogue} type="button">
          <Save size={16} />
          Add line
        </button>
      </div>
      {props.dialogues.length === 0 ? (
        <div className="muted">No dialogue lines yet.</div>
      ) : (
        props.dialogues.map((dialogue, index) => (
          <div key={`${dialogue.entity_id}-${index}`} className="panel-section compact">
            <div className="section-header">
              <div>
                <h3>Line {index + 1}</h3>
              </div>
              <button className="ghost-button danger" onClick={() => removeDialogue(index)} type="button">
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-grid three">
              <label className="field">
                <span>Speaker</span>
                <select
                  value={dialogue.entity_id}
                  onChange={(event) => updateDialogue(index, { entity_id: event.target.value })}
                >
                  <option value="">Narration / none</option>
                  {props.entities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </label>
              <SelectField
                label="Type"
                value={dialogue.type}
                onChange={(value) => updateDialogue(index, { type: value as PanelDialogueDraft['type'] })}
                options={PANEL_DIALOGUE_TYPE_OPTIONS}
              />
              <SelectField
                label="Placement"
                value={dialogue.position}
                onChange={(value) =>
                  updateDialogue(index, { position: value as PanelDialogueDraft['position'] })
                }
                options={PANEL_DIALOGUE_POSITION_OPTIONS}
              />
            </div>
            <TextAreaField
              label="Line"
              rows={2}
              value={dialogue.text}
              onChange={(value) => updateDialogue(index, { text: value })}
            />
          </div>
        ))
      )}
    </div>
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
  selectedEntityId: string | null,
  api: LyraApiClient,
  setImportingImage: (nextValue: boolean) => void,
  setNotice: (nextValue: NoticeState) => void,
  setEntityDraft: (nextValue: EntityDraft | ((current: EntityDraft) => EntityDraft)) => void,
  setUploadedReferenceCandidatesByEntityId: (
    nextValue:
      | Record<string, ReferenceCandidate[]>
      | ((current: Record<string, ReferenceCandidate[]>) => Record<string, ReferenceCandidate[]>),
  ) => void,
  setUploadedReferenceSourceByEntityId: (
    nextValue:
      | Record<string, string>
      | ((current: Record<string, string>) => Record<string, string>),
  ) => void,
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
    if (selectedEntityId !== null) {
      setUploadedReferenceCandidatesByEntityId((current) => ({
        ...current,
        [selectedEntityId]: dedupeReferenceCandidates([
          {
            s3_key: result.tmp_image_s3_key,
            cdn_url: result.tmp_image_cdn_url,
            source: 'upload',
          },
          ...(current[selectedEntityId] ?? []),
        ]).slice(0, 3),
      }));
      setUploadedReferenceSourceByEntityId((current) => ({
        ...current,
        [selectedEntityId]: result.tmp_image_s3_key,
      }));
    }
    setNotice({ type: 'success', message: 'Image analyzed. Generate full-body candidates next.' });
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
    composition_source: panel.composition.source,
    composition_gallery_item_id: panel.composition.gallery_item_id ?? '',
    composition_prompt: panel.composition.composition_prompt ?? '',
    shot_type: panel.composition.shot_type ?? '',
    angle: panel.composition.angle ?? '',
    custom_note: panel.composition.custom_note ?? '',
    dialogue_in_panel: panel.dialogue_in_panel,
    dialogues: panel.dialogue.flatMap((line) =>
      line.type === 'sfx'
        ? []
        : [
            {
              entity_id: line.entity_id ?? '',
              text: line.text,
              type: line.type,
              position: line.position,
            },
          ],
    ),
    sfx_text: panel.sfx_text ?? '',
    background_note: panel.background_note ?? '',
    panel_notes: panel.panel_notes ?? '',
    assignments: panel.entities.map((assignment) => ({
      entity_id: assignment.entity_id,
      role: assignment.role,
      position: assignment.position,
      facing_direction: assignment.facing_direction ?? '',
      expression: assignment.expression,
      custom_expression: assignment.custom_expression ?? '',
      action: assignment.action,
      custom_action: assignment.custom_action ?? '',
      effect_note: assignment.effect_note ?? '',
      state_id: assignment.state_id ?? '',
    })),
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

function toCreateWorkPayload(draft: WorkDraft): Record<string, unknown> {
  return {
    title: draft.title,
    genre: nullableString(draft.genre),
    world_setting: nullableString(draft.world_setting),
    theme: nullableString(draft.theme),
    main_entity_ids: splitCsv(draft.main_entity_ids),
    starting_point: nullableString(draft.starting_point),
    ending_point: nullableString(draft.ending_point),
    overall_flow: nullableString(draft.overall_flow),
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

function toCreateChapterPayload(draft: ChapterDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'chapter order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    starting_state: nullableString(draft.starting_state),
    ending_state: nullableString(draft.ending_state),
    emotion_curve: nullableString(draft.emotion_curve),
    entities_involved: splitCsv(draft.entities_involved),
    key_beats: splitLines(draft.key_beats),
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

function toCreateEpisodePayload(draft: EpisodeDraft): Record<string, unknown> {
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
  };
}

function toEntityPayload(draft: EntityDraft): Record<string, unknown> {
  return {
    entity_type: draft.entity_type,
    name: draft.name,
    free_description: nullableString(draft.free_description),
    prompt_supplement: nullableString(draft.prompt_supplement),
    structured_fields:
      draft.entity_type === 'character'
        ? parseJson<Record<string, unknown>>(serializeCharacterStructuredFieldsDraft(parseCharacterStructuredFieldsDraft(draft.structured_fields)))
        : parseJson<Record<string, unknown>>(draft.structured_fields),
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

function toCreateScenePayload(draft: SceneDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'scene order'),
    location: nullableString(draft.location),
    time: nullableString(draft.time),
    atmosphere: nullableString(draft.atmosphere),
    involved_entity_ids: splitCsv(draft.involved_entity_ids),
  };
}

function toPanelPayload(draft: PanelDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'panel order'),
    panel_role: draft.panel_role,
    panel_size: draft.panel_size,
    situation_text: nullableString(draft.situation_text),
    composition: {
      source: draft.composition_source,
      gallery_item_id:
        draft.composition_source === 'gallery' ? requiredString(draft.composition_gallery_item_id, 'gallery composition') : null,
      composition_prompt: nullableString(draft.composition_prompt),
      shot_type: emptyStringToNull(draft.shot_type),
      angle: emptyStringToNull(draft.angle),
      custom_note: nullableString(draft.custom_note),
    },
    dialogue: draft.dialogues.map((dialogue) => ({
      entity_id: dialogue.entity_id.trim().length === 0 ? null : dialogue.entity_id.trim(),
      text: requiredString(dialogue.text, 'dialogue text'),
      type: dialogue.type,
      position: dialogue.position,
    })),
    dialogue_in_panel: draft.dialogue_in_panel,
    sfx_text: nullableString(draft.sfx_text),
    background_note: nullableString(draft.background_note),
    panel_notes: nullableString(draft.panel_notes),
  };
}

function toPanelAssignmentsPayload(draft: PanelDraft): Record<string, unknown> {
  return {
    entities: draft.assignments.map((assignment) => ({
      entity_id: assignment.entity_id,
      role: assignment.role,
      expression: assignment.expression,
      custom_expression:
        assignment.expression === 'custom'
          ? requiredString(assignment.custom_expression, 'custom expression')
          : null,
      action: assignment.action,
      custom_action:
        assignment.action === 'custom' ? requiredString(assignment.custom_action, 'custom pose') : null,
      position: assignment.position,
      facing_direction: emptyStringToNull(assignment.facing_direction),
      effect_note: nullableString(assignment.effect_note),
      state_id: nullableUuidString(assignment.state_id, 'state override id'),
    })),
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

function createEmptyPageSettingsDraft(): PageSettingsDraft {
  return {
    dialogue_mode: 'mixed',
    page_dialogue_toggle: true,
    style_reference_title: '',
    style_reference_notes: '',
    story_source_scene_ids: [],
    story_page_purpose: '',
    story_continuity_note: '',
  };
}

function toPageSettingsDraft(page: PageRecord): PageSettingsDraft {
  const layoutConfig = toRecord(page.layout_config);
  const styleReference = toRecord(layoutConfig.style_reference);
  return {
    dialogue_mode: page.dialogue_mode,
    page_dialogue_toggle: page.page_dialogue_toggle,
    style_reference_title: readString(styleReference.title),
    style_reference_notes: readString(styleReference.notes),
    story_source_scene_ids: Array.isArray(page.story_source_scene_ids) ? page.story_source_scene_ids : [],
    story_page_purpose: page.story_page_purpose ?? '',
    story_continuity_note: page.story_continuity_note ?? '',
  };
}

function toPageSettingsPayload(draft: PageSettingsDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    dialogue_mode: draft.dialogue_mode,
    page_dialogue_toggle: draft.page_dialogue_toggle,
    story_source_scene_ids: draft.story_source_scene_ids,
    story_page_purpose: nullableString(draft.story_page_purpose),
    story_continuity_note: nullableString(draft.story_continuity_note),
  };
  if (draft.style_reference_title.trim().length > 0) {
    payload.style_reference = {
      title: draft.style_reference_title.trim(),
      notes: nullableString(draft.style_reference_notes),
    };
  }
  return payload;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function resolveStorySourceScenes(sceneIds: string[], scenes: SceneRecord[]): SceneRecord[] {
  return sceneIds
    .map((sceneId) => scenes.find((scene) => scene.id === sceneId) ?? null)
    .filter((scene): scene is SceneRecord => scene !== null);
}

function formatStorySourceSceneLabel(scene: SceneRecord, uiLanguage: UiLanguage): string {
  const location = scene.location ?? (uiLanguage === 'ja' ? '場所未設定' : 'Unknown location');
  const parts = [`${uiLanguage === 'ja' ? 'シーン' : 'Scene'} ${scene.order}`, location];
  if (scene.time !== null) {
    parts.push(scene.time);
  }
  return parts.join(' / ');
}

function sanitizeFilename(value: string): string {
  const sanitized = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code <= 31 || '<>:"/\\|?*'.includes(character)) {
        return '-';
      }
      return character;
    })
    .join('')
    .trim();
  return sanitized.length > 0 ? sanitized : 'lyra-pages';
}

function inferImageExtension(contentType: string | null): string {
  if (contentType === 'image/webp') {
    return 'webp';
  }
  if (contentType === 'image/jpeg') {
    return 'jpg';
  }
  return 'png';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCharacterStructuredFieldsDraft(value: string): CharacterStructuredFieldsDraft {
  const parsed = parseJson<Record<string, unknown>>(value);
  const hair = toRecord(parsed.hair);
  const eyes = toRecord(parsed.eyes);
  const clothing = toRecord(parsed.clothing);
  const characterIdentity = toRecord(parsed.character_identity);
  const proportions = toRecord(parsed.proportions);
  const faceDetail = toRecord(parsed.face_detail);
  const hairDetail = toRecord(parsed.hair_detail);
  const outfitDetail = toRecord(parsed.outfit_detail);
  const silhouetteKeywords = Array.isArray(characterIdentity.silhouette_keywords)
    ? characterIdentity.silhouette_keywords.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : '';

  return {
    gender_expression: readString(parsed.gender_expression),
    age_range: readString(parsed.age_range),
    skin_tone: readString(parsed.skin_tone),
    first_impression: readString(parsed.first_impression),
    standing_style: readString(parsed.standing_style),
    default_expression: readString(parsed.default_expression),
    face_shape: readString(parsed.face_shape),
    eyebrow_shape: readString(parsed.eyebrow_shape),
    nose_shape: readString(parsed.nose_shape),
    mouth_shape: readString(parsed.mouth_shape),
    height: readString(parsed.height),
    build: readString(parsed.build),
    hair_color: readString(hair.color),
    hair_length: readString(hair.length),
    hair_style: readString(hair.style),
    hair_arrangement: readString(hair.arrangement),
    hair_bangs: readString(hair.bangs),
    eye_color: readString(eyes.color),
    eye_shape: readString(eyes.shape),
    eyelid_type: readString(eyes.eyelid_type),
    visual_anchor: readString(characterIdentity.visual_anchor),
    signature_feature: readString(characterIdentity.signature_feature),
    silhouette_keywords: silhouetteKeywords,
    head_to_body_ratio: readString(proportions.head_to_body_ratio),
    shoulder_width: readString(proportions.shoulder_width),
    leg_length: readString(proportions.leg_length),
    posture_axis: readString(proportions.posture_axis),
    eye_size: readString(faceDetail.eye_size),
    eye_angle: readString(faceDetail.eye_angle),
    pupil_style: readString(faceDetail.pupil_style),
    under_eye_detail: readString(faceDetail.under_eye_detail),
    mouth_default: readString(faceDetail.mouth_default),
    hair_front_shape: readString(hairDetail.front_shape),
    hair_side_hair: readString(hairDetail.side_hair),
    hair_back_shape: readString(hairDetail.back_shape),
    clothing_category: readString(clothing.category),
    clothing_main_color: readString(clothing.main_color),
    clothing_impression: readString(clothing.impression),
    collar_shape: readString(outfitDetail.collar_shape),
    sleeve_length: readString(outfitDetail.sleeve_length),
    skirt_or_pants_shape: readString(outfitDetail.skirt_or_pants_shape),
    shoes: readString(outfitDetail.shoes),
    socks_or_legwear: readString(outfitDetail.socks_or_legwear),
    clothing_description: readString(clothing.description),
    distinguishing_features: readString(parsed.distinguishing_features),
    art_style: readString(parsed.art_style),
  };
}

function serializeCharacterStructuredFieldsDraft(value: CharacterStructuredFieldsDraft): string {
  const structuredFields: Record<string, unknown> = {};

  assignIfNotBlank(structuredFields, 'gender_expression', value.gender_expression);
  assignIfNotBlank(structuredFields, 'age_range', value.age_range);
  assignIfNotBlank(structuredFields, 'skin_tone', value.skin_tone);
  assignIfNotBlank(structuredFields, 'first_impression', value.first_impression);
  assignIfNotBlank(structuredFields, 'standing_style', value.standing_style);
  assignIfNotBlank(structuredFields, 'default_expression', value.default_expression);
  assignIfNotBlank(structuredFields, 'face_shape', value.face_shape);
  assignIfNotBlank(structuredFields, 'eyebrow_shape', value.eyebrow_shape);
  assignIfNotBlank(structuredFields, 'nose_shape', value.nose_shape);
  assignIfNotBlank(structuredFields, 'mouth_shape', value.mouth_shape);
  assignIfNotBlank(structuredFields, 'height', value.height);
  assignIfNotBlank(structuredFields, 'build', value.build);
  assignIfNotBlank(structuredFields, 'distinguishing_features', value.distinguishing_features);
  assignIfNotBlank(structuredFields, 'art_style', value.art_style);

  const hair: Record<string, unknown> = {};
  assignIfNotBlank(hair, 'color', value.hair_color);
  assignIfNotBlank(hair, 'length', value.hair_length);
  assignIfNotBlank(hair, 'style', value.hair_style);
  assignIfNotBlank(hair, 'arrangement', value.hair_arrangement);
  assignIfNotBlank(hair, 'bangs', value.hair_bangs);
  if (Object.keys(hair).length > 0) {
    structuredFields.hair = hair;
  }

  const eyes: Record<string, unknown> = {};
  assignIfNotBlank(eyes, 'color', value.eye_color);
  assignIfNotBlank(eyes, 'shape', value.eye_shape);
  assignIfNotBlank(eyes, 'eyelid_type', value.eyelid_type);
  if (Object.keys(eyes).length > 0) {
    structuredFields.eyes = eyes;
  }

  const clothing: Record<string, unknown> = {};
  assignIfNotBlank(clothing, 'category', value.clothing_category);
  assignIfNotBlank(clothing, 'main_color', value.clothing_main_color);
  assignIfNotBlank(clothing, 'impression', value.clothing_impression);
  assignIfNotBlank(clothing, 'description', value.clothing_description);
  if (Object.keys(clothing).length > 0) {
    structuredFields.clothing = clothing;
  }

  const characterIdentity: Record<string, unknown> = {};
  assignIfNotBlank(characterIdentity, 'visual_anchor', value.visual_anchor);
  assignIfNotBlank(characterIdentity, 'signature_feature', value.signature_feature);
  const silhouetteKeywords = splitCsv(value.silhouette_keywords);
  if (silhouetteKeywords.length > 0) {
    characterIdentity.silhouette_keywords = silhouetteKeywords;
  }
  if (Object.keys(characterIdentity).length > 0) {
    structuredFields.character_identity = characterIdentity;
  }

  const proportions: Record<string, unknown> = {};
  assignIfNotBlank(proportions, 'head_to_body_ratio', value.head_to_body_ratio);
  assignIfNotBlank(proportions, 'shoulder_width', value.shoulder_width);
  assignIfNotBlank(proportions, 'leg_length', value.leg_length);
  assignIfNotBlank(proportions, 'posture_axis', value.posture_axis);
  if (Object.keys(proportions).length > 0) {
    structuredFields.proportions = proportions;
  }

  const faceDetail: Record<string, unknown> = {};
  assignIfNotBlank(faceDetail, 'eye_size', value.eye_size);
  assignIfNotBlank(faceDetail, 'eye_angle', value.eye_angle);
  assignIfNotBlank(faceDetail, 'pupil_style', value.pupil_style);
  assignIfNotBlank(faceDetail, 'under_eye_detail', value.under_eye_detail);
  assignIfNotBlank(faceDetail, 'mouth_default', value.mouth_default);
  if (Object.keys(faceDetail).length > 0) {
    structuredFields.face_detail = faceDetail;
  }

  const hairDetail: Record<string, unknown> = {};
  assignIfNotBlank(hairDetail, 'front_shape', value.hair_front_shape);
  assignIfNotBlank(hairDetail, 'side_hair', value.hair_side_hair);
  assignIfNotBlank(hairDetail, 'back_shape', value.hair_back_shape);
  if (Object.keys(hairDetail).length > 0) {
    structuredFields.hair_detail = hairDetail;
  }

  const outfitDetail: Record<string, unknown> = {};
  assignIfNotBlank(outfitDetail, 'collar_shape', value.collar_shape);
  assignIfNotBlank(outfitDetail, 'sleeve_length', value.sleeve_length);
  assignIfNotBlank(outfitDetail, 'skirt_or_pants_shape', value.skirt_or_pants_shape);
  assignIfNotBlank(outfitDetail, 'shoes', value.shoes);
  assignIfNotBlank(outfitDetail, 'socks_or_legwear', value.socks_or_legwear);
  if (Object.keys(outfitDetail).length > 0) {
    structuredFields.outfit_detail = outfitDetail;
  }

  return JSON.stringify(structuredFields, null, 2);
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

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assignIfNotBlank(target: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = trimmed;
  }
}

const EMPTY_OPTION: [string, string] = ['', '-'];
const CHARACTER_GENDER_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['female', 'Female'],
  ['male', 'Male'],
  ['androgynous', 'Androgynous'],
  ['unspecified', 'Unspecified'],
];
const CHARACTER_AGE_RANGE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['child', 'Child'],
  ['early_teens', 'Early teens'],
  ['late_teens', 'Late teens'],
  ['twenties', 'Twenties'],
  ['thirties', 'Thirties'],
  ['forties_plus', 'Forties+'],
  ['ageless', 'Ageless'],
];
const CHARACTER_SKIN_TONE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['fair', 'Fair'],
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['tan', 'Tan'],
  ['deep', 'Deep'],
  ['custom', 'Custom'],
];
const CHARACTER_FIRST_IMPRESSION_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['bright_friendly', 'Bright friendly'],
  ['quiet_neat', 'Quiet neat'],
  ['cool_distant', 'Cool distant'],
  ['gentle_soft', 'Gentle soft'],
  ['serious_reliable', 'Serious reliable'],
  ['mysterious_fragile', 'Mysterious fragile'],
  ['energetic_bold', 'Energetic bold'],
];
const CHARACTER_STANDING_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['upright_neat', 'Upright neat'],
  ['natural_relaxed', 'Natural relaxed'],
  ['shy_reserved', 'Shy reserved'],
  ['confident_open', 'Confident open'],
  ['still_quiet', 'Still quiet'],
];
const CHARACTER_DEFAULT_EXPRESSION_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['soft_smile', 'Soft smile'],
  ['calm_neutral', 'Calm neutral'],
  ['serious_focus', 'Serious focus'],
  ['cheerful_smile', 'Cheerful smile'],
  ['shy_reserved', 'Shy reserved'],
  ['cool_unfazed', 'Cool unfazed'],
];
const CHARACTER_BUILD_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['petite', 'Petite'],
  ['slender', 'Slender'],
  ['average', 'Average'],
  ['athletic', 'Athletic'],
  ['muscular', 'Muscular'],
  ['curvy', 'Curvy'],
];
const CHARACTER_HEIGHT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['short', 'Short'],
  ['average', 'Average'],
  ['tall', 'Tall'],
];
const CHARACTER_FACE_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['round', 'Round'],
  ['oval', 'Oval'],
  ['heart', 'Heart'],
  ['square', 'Square'],
  ['diamond', 'Diamond'],
  ['long', 'Long'],
  ['soft_triangle', 'Soft triangle'],
  ['custom', 'Custom'],
];
const CHARACTER_EYEBROW_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['straight', 'Straight'],
  ['soft_arch', 'Soft arch'],
  ['high_arch', 'High arch'],
  ['thick', 'Thick'],
  ['thin', 'Thin'],
  ['sharp', 'Sharp'],
  ['custom', 'Custom'],
];
const CHARACTER_NOSE_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['small', 'Small'],
  ['straight', 'Straight'],
  ['button', 'Button'],
  ['sharp', 'Sharp'],
  ['rounded', 'Rounded'],
  ['broad', 'Broad'],
  ['custom', 'Custom'],
];
const CHARACTER_MOUTH_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['soft', 'Soft'],
  ['full', 'Full'],
  ['thin', 'Thin'],
  ['wide', 'Wide'],
  ['smirk', 'Smirk'],
  ['serious', 'Serious'],
  ['custom', 'Custom'],
];
const CHARACTER_HAIR_COLOR_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['black', 'Black'],
  ['brown', 'Brown'],
  ['blonde', 'Blonde'],
  ['silver', 'Silver'],
  ['white', 'White'],
  ['blue', 'Blue'],
  ['red', 'Red'],
  ['pink', 'Pink'],
  ['purple', 'Purple'],
  ['custom', 'Custom'],
];
const CHARACTER_HAIR_LENGTH_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['very_short', 'Very short'],
  ['short', 'Short'],
  ['medium', 'Medium'],
  ['long', 'Long'],
  ['very_long', 'Very long'],
];
const CHARACTER_HAIR_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['straight', 'Straight'],
  ['wavy', 'Wavy'],
  ['curly', 'Curly'],
  ['wild', 'Wild'],
];
const CHARACTER_HAIR_ARRANGEMENT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['down', 'Down'],
  ['ponytail', 'Ponytail'],
  ['twin_tails', 'Twin tails'],
  ['bun', 'Bun'],
  ['braid', 'Braid'],
  ['half_up', 'Half up'],
  ['custom', 'Custom'],
];
const CHARACTER_EYE_COLOR_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['black', 'Black'],
  ['brown', 'Brown'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['red', 'Red'],
  ['gold', 'Gold'],
  ['silver', 'Silver'],
  ['purple', 'Purple'],
  ['custom', 'Custom'],
];
const CHARACTER_EYE_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['gentle', 'Gentle'],
  ['sharp', 'Sharp'],
  ['round', 'Round'],
  ['narrow', 'Narrow'],
];
const CHARACTER_EYELID_TYPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['single', 'Single'],
  ['double', 'Double'],
];
const CHARACTER_HAIR_BANGS_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['none', 'None'],
  ['light', 'Light'],
  ['standard', 'Standard'],
  ['heavy', 'Heavy'],
  ['side_swept', 'Side swept'],
  ['blunt', 'Blunt'],
];
const CHARACTER_CLOTHING_CATEGORY_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['military', 'Military'],
  ['school', 'School'],
  ['casual', 'Casual'],
  ['suit', 'Suit'],
  ['fantasy', 'Fantasy'],
  ['japanese', 'Japanese'],
  ['streetwear', 'Streetwear'],
  ['hoodie', 'Hoodie'],
  ['sports', 'Sports'],
  ['winter_coat', 'Winter coat'],
  ['workwear', 'Workwear'],
  ['armor', 'Armor'],
  ['gothic', 'Gothic'],
  ['formal_dress', 'Formal dress'],
  ['idol_stage', 'Idol stage'],
  ['custom', 'Custom'],
];
const CHARACTER_CLOTHING_COLOR_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['black', 'Black'],
  ['white', 'White'],
  ['navy', 'Navy'],
  ['gray', 'Gray'],
  ['brown', 'Brown'],
  ['red', 'Red'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['custom', 'Custom'],
];
const CHARACTER_CLOTHING_IMPRESSION_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['formal', 'Formal'],
  ['practical', 'Practical'],
  ['elegant', 'Elegant'],
  ['rough', 'Rough'],
  ['cute', 'Cute'],
  ['custom', 'Custom'],
];
const CHARACTER_ART_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['anime', 'Anime'],
  ['semi_realistic', 'Semi-realistic'],
  ['manga', 'Manga'],
  ['painterly', 'Painterly'],
];
const PANEL_ROLE_OPTIONS: Array<[PanelDraft['panel_role'], string]> = [
  ['establish', 'Establish'],
  ['action', 'Action'],
  ['reaction', 'Reaction'],
  ['emphasis', 'Emphasis'],
  ['transition', 'Transition'],
  ['pause', 'Pause'],
  ['impact', 'Impact'],
];
const PANEL_SIZE_OPTIONS: Array<[PanelDraft['panel_size'], string]> = [
  ['standard', 'Standard'],
  ['large', 'Large'],
  ['wide', 'Wide'],
  ['narrow', 'Narrow'],
  ['splash', 'Splash'],
];
const PANEL_COMPOSITION_SOURCE_OPTIONS: Array<[PanelDraft['composition_source'], string]> = [
  ['ai_auto', 'AI auto'],
  ['gallery', 'Gallery'],
  ['custom', 'Custom'],
];
const PANEL_SHOT_TYPE_OPTIONS: Array<[PanelDraft['shot_type'], string]> = [
  ['', '-'],
  ['full_body', 'Full body'],
  ['half_body', 'Half body'],
  ['close_up', 'Close up'],
  ['wide', 'Wide'],
  ['extreme_close_up', 'Extreme close up'],
];
const PANEL_ANGLE_OPTIONS: Array<[PanelDraft['angle'], string]> = [
  ['', '-'],
  ['front', 'Front'],
  ['side', 'Side'],
  ['three_quarter', 'Three quarter'],
  ['bird_eye', 'Bird eye'],
  ['worm_eye', 'Worm eye'],
  ['dutch_angle', 'Dutch angle'],
];
const PANEL_ENTITY_ROLE_OPTIONS: Array<[PanelAssignmentDraft['role'], string]> = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['background', 'Background'],
];
const PANEL_ENTITY_POSITION_OPTIONS: Array<[PanelAssignmentDraft['position'], string]> = [
  ['left', 'Left'],
  ['center', 'Center'],
  ['right', 'Right'],
  ['background', 'Background'],
];
const PANEL_ENTITY_FACING_OPTIONS: Array<[PanelAssignmentDraft['facing_direction'], string]> = [
  ['', '-'],
  ['front', 'Front'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['away', 'Away'],
  ['three_quarter_left', '3/4 left'],
  ['three_quarter_right', '3/4 right'],
];
const PANEL_ENTITY_EXPRESSION_OPTIONS: Array<[PanelAssignmentDraft['expression'], string]> = [
  ['determined', 'Determined'],
  ['calm', 'Calm'],
  ['angry', 'Angry'],
  ['sad', 'Sad'],
  ['surprised', 'Surprised'],
  ['custom', 'Custom'],
];
const PANEL_ENTITY_POSE_OPTIONS: Array<[PanelAssignmentDraft['action'], string]> = [
  ['standing_firm', 'Standing firm'],
  ['attacking', 'Attacking'],
  ['defending', 'Defending'],
  ['running', 'Running'],
  ['custom', 'Custom'],
];
const PANEL_DIALOGUE_TYPE_OPTIONS: Array<[PanelDialogueDraft['type'], string]> = [
  ['speech', 'Speech'],
  ['thought', 'Thought'],
  ['narration', 'Narration'],
  ['shout', 'Shout'],
  ['whisper', 'Whisper'],
];
const PANEL_DIALOGUE_POSITION_OPTIONS: Array<[PanelDialogueDraft['position'], string]> = [
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['center', 'Center'],
];
const FRAME_TEMPLATE_OPTIONS: Array<[string, string]> = [
  ['standard_4', 'Standard 4'],
  ['top_wide_3', 'Top wide 3'],
  ['standard_6', 'Standard 6'],
  ['dense_8', 'Dense 8'],
  ['climax_2', 'Climax 2'],
  ['splash_1', 'Splash 1'],
  ['action_5', 'Action 5'],
  ['battle_7', 'Battle 7'],
];

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
    panel_role: 'action',
    panel_size: 'standard',
    situation_text: '',
    composition_source: 'ai_auto',
    composition_gallery_item_id: '',
    composition_prompt: '',
    shot_type: '',
    angle: '',
    custom_note: '',
    dialogue_in_panel: true,
    dialogues: [],
    sfx_text: '',
    background_note: '',
    panel_notes: '',
    assignments: [],
  };
}

function createEmptyPanelAssignmentDraft(entityId: string): PanelAssignmentDraft {
  return {
    entity_id: entityId,
    role: 'primary',
    position: 'center',
    facing_direction: '',
    expression: 'determined',
    custom_expression: '',
    action: 'standing_firm',
    custom_action: '',
    effect_note: '',
    state_id: '',
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

function dedupeReferenceCandidates(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const seenKeys = new Set<string>();

  return candidates.filter((candidate) => {
    if (seenKeys.has(candidate.s3_key)) {
      return false;
    }

    seenKeys.add(candidate.s3_key);
    return true;
  });
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

function emptyStringToNull(value: string): string | null {
  return value.trim().length === 0 ? null : value;
}

function requiredString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}

function nullableUuidString(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw new Error(`${label} is invalid`);
  }

  return trimmed;
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




