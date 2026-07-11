import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
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
  Users,
  Wand2,
} from 'lucide-react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { decodeJwtPayload, LyraApiClient, type BlobResponse } from './lib/api';
import { shouldAllowManualTokenAuth } from './lib/authMode';
import { ORGANIZATION_FEATURES_AVAILABLE } from './lib/featureFlags';
import { formatUserFacingError, formatUserFacingErrorMessage } from './lib/userFacingErrors';
import {
  beginCognitoLogin,
  buildCognitoLogoutUrl,
  clearCognitoSession,
  completeCognitoRedirectIfPresent,
  getCognitoApiToken,
  getCognitoAuthConfig,
  isCognitoSessionCompatible,
  readCompatibleStoredCognitoSession,
  refreshCognitoSession,
  storeCognitoSession,
  type CognitoAuthConfig,
  type CognitoSession,
} from './lib/cognitoAuth';
import type {
  ChapterRecord,
  EntityRecord,
  EpisodeRecord,
  GenerationJobRecord,
  PageRecord,
  PanelFrameRecord,
  PanelRecord,
  SceneRecord,
  StoryEpisodeImprovementRecord,
  BillingBalanceRecord,
  OrganizationAuditLogRecord,
  OrganizationBillingPlanRecord,
  OrganizationInvitationPreviewRecord,
  OrganizationInvitationRecord,
  OrganizationInvoiceRecord,
  OrganizationMemberRecord,
  WorkRecord,
} from './types/api';

type WorkspaceTab = 'story' | 'entities' | 'pages' | 'account' | 'tutorial';
type UiLanguage = 'ja' | 'en';
type SubscriptionPlanCode = 'free' | 'standard' | 'premium' | 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
type ConsumerSubscriptionCheckoutPlanCode = 'standard' | 'premium';
type SubscriptionCheckoutPlanCode = Exclude<SubscriptionPlanCode, 'free'>;
type CreditCheckoutPackageCode = 'credits_200' | 'credits_1000' | 'credits_3000';
type EnterprisePlanCode = 'enterprise_a' | 'enterprise_b' | 'enterprise_c';
type OrganizationDetailPanelKey = 'billing' | 'usage' | 'invoices' | 'audit' | 'members' | 'invitations';

interface SubscriptionPlanOption {
  plan_code: SubscriptionCheckoutPlanCode;
  display_name_ja: string;
  display_name_en: string;
  monthly_credits: number;
  amount_jpy: number;
  minimum_contract_months: number;
  trial_days: number;
  is_enterprise: boolean;
  configured: boolean;
}

const MAX_EPISODE_PAGES = 32;

const subscriptionPurchaseOptions: Array<{
  code: ConsumerSubscriptionCheckoutPlanCode;
  credits: number;
  priceJpy: number;
  label: { en: string; ja: string };
}> = [
  {
    code: 'standard',
    credits: 50,
    priceJpy: 1000,
    label: { en: 'Standard', ja: '\u30b9\u30bf\u30f3\u30c0\u30fc\u30c9' },
  },
  {
    code: 'premium',
    credits: 175,
    priceJpy: 3500,
    label: { en: 'Premium', ja: '\u30d7\u30ec\u30df\u30a2\u30e0' },
  },
];

const organizationRoleOptions: Array<{
  value: OrganizationMemberRecord['role'];
  label: { en: string; ja: string };
}> = [
  { value: 'owner', label: { en: 'Owner', ja: '\u30aa\u30fc\u30ca\u30fc' } },
  { value: 'admin', label: { en: 'Admin', ja: '\u7ba1\u7406\u8005' } },
  { value: 'billing', label: { en: 'Billing', ja: '\u8acb\u6c42\u7ba1\u7406' } },
  { value: 'editor', label: { en: 'Editor', ja: '\u7de8\u96c6\u8005' } },
  { value: 'viewer', label: { en: 'Viewer', ja: '\u95b2\u89a7\u8005' } },
];

const organizationMemberStatusOptions: Array<{
  value: Extract<OrganizationMemberRecord['status'], 'active' | 'suspended'>;
  label: { en: string; ja: string };
}> = [
  { value: 'active', label: { en: 'Active', ja: '有効' } },
  { value: 'suspended', label: { en: 'Suspended', ja: '停止中' } },
];

const creditPurchaseOptions: Array<{
  code: CreditCheckoutPackageCode;
  credits: number;
  priceJpy: number;
}> = [
  { code: 'credits_200', credits: 10, priceJpy: 220 },
  { code: 'credits_1000', credits: 50, priceJpy: 1100 },
  { code: 'credits_3000', credits: 150, priceJpy: 3300 },
];

const creditUsageItems: Array<{ en: string; ja: string }> = [
  { en: 'Character preview / import: 1 credit', ja: '\u30ad\u30e3\u30e9\u30d7\u30ec\u30d3\u30e5\u30fc\u30fb\u53d6\u308a\u8fbc\u307f: 1\u30af\u30ec\u30b8\u30c3\u30c8' },
  { en: 'Page generation: 3 credits+', ja: '\u30da\u30fc\u30b8\u751f\u6210: 3\u30af\u30ec\u30b8\u30c3\u30c8\u4ee5\u4e0a' },
  { en: 'Text AI: free', ja: '\u30c6\u30ad\u30b9\u30c8AI: \u7121\u6599' },
];
interface NoticeState {
  type: 'error' | 'success' | 'info';
  message: string;
}

interface BillingReturnMarker {
  kind: 'subscription' | 'credits' | 'portal';
  createdAt: number;
  planCode?: SubscriptionCheckoutPlanCode;
  packageCode?: CreditCheckoutPackageCode;
  organizationId?: string;
  initialPlanCode?: SubscriptionPlanCode;
  initialTotalCredits?: number;
  initialPurchasedCredits?: number;
  initialOrganizationPlanCode?: EnterprisePlanCode;
  initialOrganizationTotalCredits?: number;
  initialOrganizationPurchasedCredits?: number;
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
  story_input_mode: 'structured' | 'full';
  story_full_draft: string;
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
  aliases: string;
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

interface PanelFrameDraft {
  id: string;
  panel_id: string;
  reading_order: string;
  border_style: PanelFrameRecord['border_style'];
  border_width: string;
  border_color: string;
  z_index: string;
  vertices: Array<{ x: string; y: string }>;
}

interface FramePreviewDefinition {
  vertices: Array<{ x: number; y: number }>;
  readingOrder?: number;
  borderStyle?: PanelFrameRecord['border_style'];
}

interface GenericStructuredFieldRow {
  key: string;
  value: string;
}

interface ReferenceCandidate {
  candidate_token: string;
  source: 'upload' | 'generated';
}

type ExportFormat = 'pdf' | 'image';

const manualTokenStorageKey = 'lyra:web:manual-token';
const trackedJobsStorageKey = 'lyra:web:tracked-jobs';
const uiLanguageStorageKey = 'lyra:web:ui-language';
const billingReturnPendingStorageKey = 'lyra:web:billing-return-pending';
const billingReturnVerificationIntervalMs = 2_000;
const billingReturnVerificationTimeoutMs = 45_000;
const UiLanguageContext = createContext<UiLanguage>('ja');
const UI_JA_DICTIONARY: Record<string, string> = {
  Story: 'ストーリー',
  Entities: 'キャラクター',
  Pages: 'ページ',
  Work: '作品',
  Chapter: '章',
  Episode: '話',
  Works: '作品一覧',
  'New work': '新しい作品',
  'Create work': '作品を作成',
  'Loading works...': '作品一覧を読み込み中...',
  'Could not load works.': '作品一覧を読み込めませんでした。',
  'No works yet.': '作品はまだありません。',
  Retry: '再読み込み',
  'Sign in again': '再ログイン',
  Chapters: '章',
  Episodes: '話',
  Title: 'タイトル',
  Genre: 'ジャンル',
  World: '世界観',
  Theme: 'テーマ',
  Status: '状態',
  'World setting': '世界観',
  'Overall flow': '全体の流れ',
  'Starting point': '開始地点',
  'Ending point': '終着点',
  'Main characters': '主要キャラ',
  'Chapter title': '章タイトル',
  'Episode draft': '話の下書き',
  'Story input mode': 'ストーリー入力方式',
  'Split sections': '分割入力',
  'Whole draft': '全体入力',
  'Whole story draft': '全体ストーリー',
  'Improved full story': '改善された全体ストーリー',
  'Apply full story': '全体ストーリーへ反映',
  'Estimated pages': '想定ページ数',
  Purpose: '目的',
  Introduction: '導入',
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
  'Improved introduction': '改善された導入',
  'Improved middle': '改善された中盤',
  'Improved climax': '改善されたクライマックス',
  'Improved ending hook': '改善された引き',
  Frames: 'コマ割り',
  Panels: 'コマ',
  'Page settings': 'ページ設定',
  'Dialogue mode': 'セリフの扱い',
  'Dialogue toggle': 'ページ全体でセリフを画像に含める',
  'Style reference title': '画風制約の作品名',
  'Style reference notes': '画風制約メモ',
  'Story sources': '話の材料',
  'Source scenes': '元シーン',
  'Page purpose': 'ページの目的',
  'Continuity note': 'つながりメモ',
  Name: '名前',
  'Free description': '自由記述',
  'Prompt supplement': '補足プロンプト',
  'Structured fields': '構造化項目',
  Field: '項目',
  Value: '値',
  'Add field': '項目を追加',
  'No structured fields yet.': '構造化項目はまだありません。',
  Format: '形式',
  Filename: 'ファイル名',
  'Export selected': '選択ページを保存',
  'Export all': 'すべて保存',
  'Image baked': '画像にセリフを焼き込む',
  Mixed: '混在',
  Page: 'ページ',
  Export: '保存',
  'Generated preview': '生成プレビュー',
  'Confirmed references': '確定済みレファレンス',
  'Character list': 'キャラ一覧',
  'Character editor': 'キャラ編集',
  'Story context': 'ストーリー文脈',
  'Target episode': '対象の話',
  'Chapter / Episode': '章と話',
  'Import / References': '取り込み / レファレンス',
  Credits: 'クレジット',
  Jobs: 'ジョブ',
  Tutorial: 'チュートリアル',
  'First run guide': '初回の進め方',
  'Current plan': '現在のプラン',
  Current: '現在',
  active: '有効',
  trialing: '試用中',
  past_due: '支払い遅延',
  canceled: '解約済み',
  unpaid: '未払い',
  incomplete: '支払い未完了',
  incomplete_expired: '支払い期限切れ',
  paused: '一時停止中',
  paid: '支払い済み',
  failed: '失敗',
  Free: 'フリー',
  'Manage paid plans in Stripe.': '有料プランの変更・解約は「サブスク・請求を管理」で行ってください。',
  'production console': '制作コンソール',
  Generate: '生成',
  Confirm: '確定',
  Reopen: '再編集',
  Template: 'テンプレート',
  Apply: '適用',
  'Save frames': 'コマ割りを保存',
  'Advanced frame geometry': 'コマ形状の詳細調整',
  'Frame geometry': 'コマ形状',
  'Linked panel': '対応コマ',
  'No linked panel': '未紐づけ',
  'Border style': '枠線',
  Solid: '実線',
  Dashed: '破線',
  'Border width': '枠線幅',
  'Border color': '枠線色',
  Vertex: '頂点',
  'Save frame geometry': 'コマ形状を保存',
  Role: '役割',
  Size: 'サイズ',
  Situation: '状況',
  'Composition source': '構図メモ',
  'Advanced panel options': 'コマの詳細設定',
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
  Type: '種類',
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
  Effect: '効果',
  'Custom expression': '自由入力の表情',
  'Custom pose': '自由入力のポーズ',
  'Add line': '行を追加',
  'No dialogue lines yet.': 'まだセリフ行はありません。',
  'Speaker is required for speech, thought, shout, and whisper lines.': 'セリフ・思考・叫び・ささやきには話者が必要です。',
  'Narration / none': 'ナレーション / なし',
  Draft: '下書き',
  Reviewing: '確認中',
  Ready: '準備完了',
  Save: '保存',
  'Save work': '作品を保存',
  'Create chapter': '章を追加',
  'Delete chapter': '章を削除',
  'Create episode': '話を追加',
  'Save episode': '話を保存',
  'Delete episode': '話を削除',
  'Create scene': 'シーンを作成',
  'Delete entity': 'キャラを削除',
  'Create entity': 'キャラを作成',
  'Save entity': 'キャラを保存',
  'Generate reference': 'プレビュー生成',
  'Confirm references': 'レファレンス確定',
  'Delete reference': 'レファレンス削除',
  'Save page settings': 'ページ設定を保存',
  'Save story sources': '話の材料を保存',
  'Delete panel': 'コマを削除',
  'Checkout standard': 'サブスク手続き',
  'Checkout subscription': 'サブスク手続き',
  'Checkout credits': 'クレジット購入',
  'Open portal': '請求管理',
  'Generate page skeleton': 'ページ骨格生成',
  'Save chapter': '章を保存',
  'Add chapter': '章を追加',
  'Add episode': '話を追加',
  'Generate page plan': 'ページ骨格生成',
  'Regenerate page plan': 'ページ骨格を上書き再生成',
  'Apply story plan': '話全体を反映',
  'Improve draft': '改善する',
  'Apply all': 'すべて反映',
  'Apply to title': 'タイトルへ反映',
  'Apply purpose': '目的へ反映',
  'Apply introduction': '導入へ反映',
  'Apply middle': '中盤へ反映',
  'Apply climax': 'クライマックスへ反映',
  'Apply ending hook': '引きへ反映',
  'Reset draft': '下書きを戻す',
  'Use token': 'トークンを使う',
  Create: '作成',
  'Save selected': '選択中を保存',
  'Signed in': 'ログイン中',
  'No work selected': '作品が選択されていません',
  'Create or select a work from the left panel to start editing.': '左側で作品を作成または選択すると編集を始められます。',
  'Choose the current work, chapter, and episode while editing characters.': 'キャラ編集中の作品・章・話を選択します。',
  'New character': '新規キャラ',
  'Importing image...': '画像を取り込み中...',
  'Drop or choose image': '画像をドロップまたは選択',
  'Select a preview and confirm it as the primary image.': 'プレビューを選んで確定します。',
  'No preview yet.': 'まだプレビューはありません。',
  'Delete with the button only. Clicking the image will not delete it.': '削除はボタンから行います。画像クリックでは削除されません。',
  'No confirmed references yet.': '確定済みレファレンスはまだありません。',
  'Creating a new character. Saving here will add a new record and will not overwrite existing characters.': '新規キャラ作成中です。保存すると既存キャラを上書きせず、新しいキャラとして追加します。',
  'Editing the selected character.': '選択中のキャラを編集しています。',
  'Delete this character? This cannot be undone.': 'このキャラを削除しますか？この操作は元に戻せません。',
  'Delete this reference image? This cannot be undone.': 'このレファレンス画像を削除しますか？この操作は元に戻せません。',
  'Delete this panel? This can break the frame/panel count until frames are adjusted.': 'このコマを削除しますか？コマ割りを調整するまで、枠数とコマ数が一致しない場合があります。',
  'Use reference': '候補に含める',
  'Primary reference': 'メインにする',
  upload: 'アップロード',
  generated: '生成',
  'Frame count and panel count do not match. Adjust frames or panels before generating.': 'コマ割り数とコマ数が一致していません。生成前に調整してください。',
  'Page generation is blocked until panel layout and panel content match.': 'コマ割りとコマ内容の数が一致するまでページ生成はできません。',
  'Current count: frames {frames} / panels {panels}. Apply a panel layout template to sync them before generating.': '現在: コマ割り {frames} / コマ内容 {panels}。生成前にテンプレートを適用して数を揃えてください。',
  'Go to panel layout': 'コマ割りへ移動',
  'Create character': 'キャラを作成',
  'Save character': 'キャラを保存',
  'Generate page': 'ページ生成',
  'Confirm page': 'ページ確定',
  'Reopen page': '再編集',
  'Apply frame template': 'テンプレートを適用',
  'Apply panel layout': 'コマ割りを変更',
  'Panel layout': 'コマ割り',
  'Create panel': 'コマを作成',
  'Save panel': 'コマを保存',
  'Save scene': 'シーンを保存',
  'Subscription plan': 'サブスクリプション',
  'Add 50 credits / ¥1,100': '50クレジットを追加 / 1,100円',
  'Billing portal': '請求管理',
  page_generate: 'ページ生成',
  entity_generate: 'キャラ生成',
  episode_story_autofill: '話全体を反映',
  'Switch story context for page editing.': 'ページ編集対象の作品・章・話を選択します。',
  'Double-click image to enlarge': '画像をダブルクリックで拡大',
  'Loading current page plan.': '現在のページ骨格を読み込んでいます。',
  'Regenerating will replace the current pages for this episode.': '再生成すると、この話の現在のページが置き換わります。',
  'Regenerating the page plan will replace the current pages for this episode.': 'ページ骨格を上書き再生成すると、この話の現在のページを置き換えます。',
  Primary: 'メイン',
  Delete: '削除',
  'Generate full-body preview': '全身プレビュー生成',
  'Preview generation costs 1 credit.': 'プレビュー生成 1cr',
  'Image import costs 1 credit.': '画像取り込み 1cr',
  'Page generation starts at 3 credits.': 'ページ生成 3crから',
  'Text AI actions use no credits.': 'テキストAI 0cr',
  'No recent jobs.': '最近のジョブはありません。',
  'Only PNG, JPEG, and WebP are allowed.': 'PNG/JPEG/WebPのみ対応しています。',
  'Image file is too large.': '画像が大きすぎます。',
  'Image analyzed. Generate preview next.': '画像解析が完了しました。次にプレビューを生成してください。',
  Total: '合計',
  Monthly: '月次',
  Purchased: '購入分',
  Identity: '基本情報',
  Anchors: '再現アンカー',
  Face: '顔',
  Hair: '髪',
  Outfit: '服装',
  Gender: '性別表現',
  'Age range': '年齢帯',
  'Skin tone': '肌の色',
  'First impression': '第一印象',
  'Standing style': '立ち姿',
  Aliases: '別名・通称',
  'Add alias': '別名を追加',
  'No aliases yet.': 'まだ別名はありません。',
  'Alias placeholder': '別名を入力',
  'Default expression': '既定表情',
  Height: '身長感',
  'Body type': '体格',
  'Art style': '絵柄',
  'Visual anchor': '視覚アンカー',
  'Signature feature': '特徴',
  'Silhouette keywords': 'シルエットの要点',
  'Distinguishing features': '見分けポイント',
  'Head/body ratio': '頭身',
  'Shoulder width': '肩幅',
  'Leg length': '脚の長さ',
  'Posture axis': '姿勢の軸',
  'Hair color': '髪色',
  'Hair length': '髪の長さ',
  'Hair style': '髪型',
  'Hair arrangement': '髪のまとめ方',
  Bangs: '前髪',
  'Eye color': '瞳の色',
  'Eye shape': '目の形',
  Eyelids: 'まぶた',
  'Face shape': '顔の形',
  Eyebrows: '眉',
  Nose: '鼻',
  Mouth: '口',
  'Outfit category': '服装カテゴリ',
  'Outfit silhouette': '服装シルエット',
  'Main colors': '主な色',
  'Key accessories': '小物',
  'Speech style': '話し方',
  'Catchphrases': '口癖',
  'Pronouns': '一人称・二人称',
  'Mobile navigation': 'モバイルナビゲーション',
  English: '英語',
  Language: '言語',
  Account: 'アカウント',
  'Log out': 'ログアウト',
  'Work overview': '作品概要',
  'Advanced work context': '作品概要の詳細',
  'Body proportion details': '体型バランスの詳細',
  Guide: 'ガイド',
  Panel: 'コマ',
  'Move earlier': '前へ移動',
  'Move later': '後ろへ移動',
  'Move panel up': 'コマを前へ移動',
  'Move panel down': 'コマを後ろへ移動',
  'Z-index': '重なり順',
  'Style constraints': '画風制約',
  'Import reference': 'レファレンス取り込み',
  'Preview / Confirm': 'プレビュー / 確定',
  Preview: 'プレビュー',
  Add: '追加',
  'Move up': '上へ移動',
  'Move down': '下へ移動',
  'Custom value': '自由入力',
  'Custom / unsynced': 'カスタム / 未同期',
  'Untitled chapter': '無題の章',
  'Untitled episode': '無題の話',
  'No location': '場所未設定',
  'AI improved': 'AI改善済み',
  'Characters in panel': 'コマ内のキャラ',
  'Pick who appears first, then refine pose, facing, and effects per character.': '登場キャラを選び、キャラごとのポーズ・向き・効果を調整します。',
  'Placement first, then expression, pose, and effect.': '配置を決めてから、表情・ポーズ・効果を調整します。',
  'These lines will be considered inside the generated panel art.': 'これらのセリフは生成画像内に含める前提で扱います。',
  'These lines stay outside the generated panel art.': 'これらのセリフは生成画像の外側で扱います。',
  'You do not need to fill every blank field.': 'すべての空欄を埋める必要はありません。',
  'Lyra AI manga editor': 'Lyra AI漫画エディタ',
  'Sign in or create an account': 'ログイン・アカウント登録はこちら',
  Email: 'メールアドレス',
  'Send magic link': 'ログインリンクを送信',
  'Magic link sent.': 'ログインリンクを送信しました。',
  'Manual bearer token': '手動トークン',
  'Supabase client is not configured.': 'ログイン設定がまだ完了していません。',
  'Applying story plan to pages and panels. This process can take around 20 minutes.': 'ページとコマへ反映中です。この処理は20分程度かかる場合があります。',
};

const UI_JA_OPTION_DICTIONARY: Record<string, string> = {
  Character: 'キャラクター',
  Nonhuman: '人外',
  Object: '物体',
  Image: '画像',
  PDF: 'PDF',
  Custom: 'カスタム',
  Female: '女性',
  Male: '男性',
  Androgynous: '中性的',
  Unspecified: '指定なし',
  Child: '子ども',
  'Early teens': '10代前半',
  'Late teens': '10代後半',
  Twenties: '20代',
  Thirties: '30代',
  'Forties+': '40代以上',
  Ageless: '年齢不詳',
  Fair: '色白',
  Light: '明るめ',
  Medium: '中間',
  Tan: '小麦色',
  Deep: '濃いめ',
  'Bright friendly': '明るく親しみやすい',
  'Quiet neat': '静かで整った印象',
  'Cool distant': 'クールで距離感がある',
  'Gentle soft': '穏やかで柔らかい',
  'Serious reliable': '真面目で信頼感がある',
  'Mysterious fragile': '神秘的で儚い',
  'Energetic bold': '活発で大胆',
  'Stoic reserved': '寡黙で控えめ',
  'Rugged calm': '無骨で落ち着いた',
  'Sharp elite': '鋭くエリート感がある',
  'Playful confident': '遊び心があり自信がある',
  'Mature composed': '大人びて落ち着いた',
  'Upright neat': '背筋を伸ばした整った立ち姿',
  'Natural relaxed': '自然でリラックスした立ち姿',
  'Shy reserved': '内気で控えめ',
  'Confident open': '自信があり開いた姿勢',
  'Still quiet': '静かに佇む',
  'Arms crossed': '腕組み',
  'Hands in pockets': 'ポケットに手',
  'Guarded stance': '警戒した立ち姿',
  'Wide grounded stance': '足を広げた安定姿勢',
  'Elegant upright': '優雅に直立',
  'Soft smile': '柔らかな笑み',
  'Calm neutral': '落ち着いた無表情',
  'Serious focus': '真剣な集中',
  'Cheerful smile': '明るい笑顔',
  'Cool unfazed': 'クールで動じない',
  'Stern look': '厳しい表情',
  'Tired neutral': '疲れた無表情',
  'Confident smirk': '自信のある笑み',
  'Bored gaze': '退屈そうな視線',
  'Teasing smile': 'からかうような笑み',
  Petite: '小柄',
  Slender: '細身',
  Average: '標準',
  Athletic: '引き締まった体型',
  Muscular: '筋肉質',
  Curvy: '曲線的',
  Lean: 'すらりとした体型',
  Stocky: 'がっしり',
  'Broad build': '肩幅のある体格',
  'Large build': '大柄',
  'Very short height': 'かなり低身長',
  Short: '低め',
  Tall: '高め',
  'Very tall height': 'かなり高身長',
  Round: '丸型',
  Oval: '卵型',
  Heart: 'ハート型',
  Square: '四角型',
  Diamond: 'ダイヤ型',
  Long: '長め',
  'Soft triangle': '柔らかい三角形',
  Straight: 'ストレート',
  'Soft arch': '緩やかなアーチ',
  'High arch': '高いアーチ',
  Thick: '太め',
  Thin: '細め',
  Sharp: 'シャープ',
  Small: '小さめ',
  Button: '丸い小鼻',
  Rounded: '丸みあり',
  Broad: '広め',
  Soft: '柔らかい',
  Full: 'ふっくら',
  Wide: '広め',
  Smirk: 'にやり',
  Serious: '真面目',
  Black: '黒',
  Brown: '茶',
  'Dark brown': '暗い茶',
  Blonde: '金髪',
  'Ash blonde': 'アッシュブロンド',
  Auburn: '赤茶',
  Silver: '銀',
  Gray: '灰',
  White: '白',
  Blue: '青',
  Green: '緑',
  Red: '赤',
  Pink: 'ピンク',
  Purple: '紫',
  'Two tone': 'ツートーン',
  'Very short': 'かなり短い',
  'Very long': 'かなり長い',
  Wavy: 'ウェーブ',
  Curly: 'カール',
  Wild: 'ワイルド',
  Tousled: '無造作',
  Spiky: 'ツンツン',
  Fluffy: 'ふわふわ',
  Slick: 'なでつけ',
  Coarse: '硬め',
  Shaved: '剃り込み',
  Down: '下ろし髪',
  'Short cut': 'ショートカット',
  'Buzz cut': '坊主',
  'Crew cut': 'クルーカット',
  'Two block': 'ツーブロック',
  Undercut: 'アンダーカット',
  'Fade cut': 'フェードカット',
  'Side part': '七三分け',
  'Center part': 'センター分け',
  'Comma hair': 'コンマヘア',
  'Slick back': 'オールバック',
  'Messy short': '無造作ショート',
  Pompadour: 'ポンパドール',
  'Short bob': 'ショートボブ',
  'Medium layered': 'ミディアムレイヤー',
  'Wolf cut': 'ウルフカット',
  'Long straight': 'ロングストレート',
  Ponytail: 'ポニーテール',
  'Side ponytail': 'サイドポニー',
  'Twin tails': 'ツインテール',
  Bun: 'お団子',
  'Man bun': 'マンバン',
  Topknot: 'トップノット',
  Braid: '三つ編み',
  'Half up': 'ハーフアップ',
  'Tied back': '後ろ結び',
  'Shaved sides': '刈り上げ',
  'shaved sides': '刈り上げ',
  Gold: '金',
  Gentle: '優しい',
  Narrow: '細い',
  Single: '一重',
  Double: '二重',
  'small eyes': '小さな目',
  'balanced eyes': '標準的な目',
  'large eyes': '大きな目',
  'very large eyes': 'かなり大きな目',
  'level eye line': '水平な目線',
  'slightly upturned eyes': '少しつり目',
  'strongly upturned eyes': '強いつり目',
  'slightly downturned eyes': '少したれ目',
  'drooping eyes': 'たれ目',
  'small pupils': '小さな瞳孔',
  'large pupils': '大きな瞳孔',
  'sharp pupils': '鋭い瞳孔',
  'soft round pupils': '丸く柔らかい瞳孔',
  'bright reflective pupils': '光を反射する瞳',
  'none visible': '目立たない',
  'soft shadows': '薄い影',
  'defined lower lash line': '下まつげの線',
  'slight eye bags': '薄い目袋',
  'heavy eye bags': '濃い目袋',
  'closed neutral mouth': '閉じた自然な口',
  'slight smile': 'かすかな笑み',
  'firm straight mouth': '固い一文字口',
  'soft parted lips': '少し開いた柔らかい口',
  None: 'なし',
  Standard: '標準',
  Heavy: '重め',
  'Side swept': '横流し',
  Blunt: 'ぱっつん',
  Parted: '分け前髪',
  'Center parted': 'センター分け',
  Curtain: 'カーテンバング',
  'Messy bangs': '無造作前髪',
  'Short bangs': '短い前髪',
  'Long bangs': '長い前髪',
  'straight front line': 'まっすぐな前髪ライン',
  'center-parted front': 'センター分けの前髪',
  'rounded front curve': '丸みのある前髪',
  'side-swept front': '横流しの前髪',
  'blunt front': 'ぱっつん前髪',
  'short textured front': '短く動きのある前髪',
  'comma front': 'コンマ風前髪',
  'curtain front': 'カーテン風前髪',
  'messy front': '無造作な前髪',
  'swept-up front': '上げた前髪',
  'short side locks': '短いサイド髪',
  'soft cheek framing': '頬を囲む柔らかい髪',
  'long side locks': '長いサイド髪',
  'tucked behind ears': '耳かけ',
  'trimmed sides': '整えたサイド',
  'faded sides': 'フェードしたサイド',
  sideburns: 'もみあげ',
  'ear-length sides': '耳丈のサイド',
  'clean bob back': '整ったボブ後ろ髪',
  'layered back': 'レイヤーの後ろ髪',
  'straight long back': 'まっすぐな長い後ろ髪',
  'ponytail fall': 'ポニーテールの垂れ',
  'braided back': '編み込みの後ろ髪',
  'tapered nape': '襟足を絞った形',
  'short clipped back': '短く刈った後ろ髪',
  'undercut back': 'アンダーカットの後ろ髪',
  'tied-back hair': '後ろで結んだ髪',
  'long loose back': '長く下ろした後ろ髪',
  'wolf nape': 'ウルフ風の襟足',
  Military: 'ミリタリー',
  School: '学生服',
  Casual: 'カジュアル',
  Suit: 'スーツ',
  'Business casual': 'ビジネスカジュアル',
  'Lab coat': '白衣',
  'Trench coat': 'トレンチコート',
  Tactical: 'タクティカル',
  'Traditional formal': '伝統的な正装',
  'Street jacket': 'ストリートジャケット',
  Fantasy: 'ファンタジー',
  Japanese: '和装',
  Streetwear: 'ストリートウェア',
  Hoodie: 'パーカー',
  Sports: 'スポーツ',
  'Winter coat': '冬用コート',
  Workwear: '作業着',
  Armor: '鎧',
  Gothic: 'ゴシック',
  'Formal dress': 'フォーマルドレス',
  'Idol stage': 'アイドル衣装',
  Navy: 'ネイビー',
  Formal: 'フォーマル',
  Practical: '実用的',
  Elegant: '上品',
  Rough: 'ラフ',
  Cute: 'かわいい',
  'round collar': '丸襟',
  'sharp collar': '鋭い襟',
  'standing collar': '立ち襟',
  'sailor collar': 'セーラー襟',
  'hooded neckline': 'フード付き首元',
  Sleeveless: 'ノースリーブ',
  'Short sleeves': '半袖',
  'Three-quarter sleeves': '七分袖',
  'Long sleeves': '長袖',
  'Wide sleeves': '広袖',
  'Short skirt': '短いスカート',
  'Long skirt': '長いスカート',
  'Straight pants': 'ストレートパンツ',
  'Wide pants': 'ワイドパンツ',
  Slacks: 'スラックス',
  Jeans: 'ジーンズ',
  'Cargo pants': 'カーゴパンツ',
  Shorts: 'ショートパンツ',
  Loafers: 'ローファー',
  Sneakers: 'スニーカー',
  Boots: 'ブーツ',
  'Dress shoes': '革靴',
  'Combat boots': 'コンバットブーツ',
  Heels: 'ヒール',
  'School shoes': '学生靴',
  'Bare legs': '素足',
  'Ankle socks': 'くるぶし丈ソックス',
  'Knee socks': '膝丈ソックス',
  'Thigh-high socks': 'サイハイソックス',
  Tights: 'タイツ',
  'Simple uniform detailing': 'シンプルな制服ディテール',
  'Layered practical details': '重ね着風の実用ディテール',
  'Ornamental trim': '装飾的な縁取り',
  'Combat utility details': '戦闘用の実用ディテール',
  'Minimal clean design': '装飾の少ない clean な設計',
  Anime: 'アニメ調',
  'Semi-realistic': 'セミリアル',
  Manga: '漫画調',
  Painterly: '絵画調',
  'Face + hair balance': '顔と髪のバランス',
  'Eye line': '目線',
  'Silhouette outline': 'シルエット輪郭',
  'Posture read': '姿勢の読み取り',
  'Outfit shape': '服装の形',
  'Color blocking': '色の配置',
  'Accessory / prop': '小物・持ち物',
  'Hair shape': '髪型',
  'Eye color contrast': '瞳色の対比',
  'Expression gap': '表情のギャップ',
  'Silhouette edge': 'シルエットの端',
  Accessory: 'アクセサリー',
  'Scar / mark': '傷・印',
  Stance: '立ち姿',
  'Compact silhouette': 'コンパクトなシルエット',
  'Tall and slender': '背が高く細身',
  'Broad-shouldered': '肩幅が広い',
  'Long coat outline': 'ロングコートの輪郭',
  'Skirt line': 'スカートライン',
  'Military block': 'ミリタリー調の塊感',
  'Soft rounded outline': '柔らかい丸みの輪郭',
  'Beauty mark': 'ほくろ',
  Scar: '傷',
  'Eye bags': '目袋',
  Fang: '八重歯',
  Ahoge: 'アホ毛',
  'Hair streak': 'メッシュ',
  Glasses: '眼鏡',
  Stubble: '無精ひげ',
  Beard: 'ひげ',
  Goatee: 'あごひげ',
  Earrings: 'イヤリング',
  'Thick eyebrows': '太い眉',
  'Sharp jawline': '鋭い輪郭',
  'about six heads tall': '約6頭身',
  'about six and a half heads tall': '約6.5頭身',
  'about seven heads tall': '約7頭身',
  'about seven and a half heads tall': '約7.5頭身',
  'about eight heads tall': '約8頭身',
  'narrow shoulders': '狭い肩幅',
  'balanced shoulders': '標準的な肩幅',
  'broad shoulders': '広い肩幅',
  'short legs': '短めの脚',
  'balanced leg length': '標準的な脚の長さ',
  'long legs': '長い脚',
  'centered and straight': '中心がまっすぐ',
  'slightly forward-leaning': '少し前傾',
  'slightly backward-leaning': '少し後傾',
  'soft inward posture': '柔らかく内向き',
  'open outward posture': '開いた外向き',
  Establish: '導入',
  Action: 'アクション',
  Reaction: 'リアクション',
  Emphasis: '強調',
  Transition: '転換',
  Pause: '間',
  Impact: 'インパクト',
  Large: '大きい',
  Splash: '見開き風',
  'AI auto': 'AI自動',
  Gallery: 'ギャラリー',
  'Full body': '全身',
  'Half body': '半身',
  'Close up': 'アップ',
  'Extreme close up': '極端なアップ',
  Front: '正面',
  Side: '横',
  'Three quarter': '斜め',
  'Bird eye': '俯瞰',
  'Worm eye': 'あおり',
  'Dutch angle': '斜め構図',
  Secondary: 'サブ',
  Left: '左',
  Center: '中央',
  Right: '右',
  Away: '背面',
  '3/4 left': '左斜め',
  '3/4 right': '右斜め',
  Determined: '決意',
  Calm: '落ち着き',
  Angry: '怒り',
  Sad: '悲しみ',
  Surprised: '驚き',
  'Standing firm': 'しっかり立つ',
  Attacking: '攻撃',
  Defending: '防御',
  Running: '走る',
  Speech: 'セリフ',
  Thought: '思考',
  Narration: 'ナレーション',
  Shout: '叫び',
  Whisper: 'ささやき',
  Top: '上',
  Bottom: '下',
  'Standard 4': '標準4コマ',
  'Stacked wide 4': '横長4段',
  'Top wide 3': '上段広め3コマ',
  'Standard 6': '標準6コマ',
  'Dense 8': '密集8コマ',
  'Climax 2': 'クライマックス2コマ',
  'Splash 1': '大ゴマ1コマ',
  'Action 5': 'アクション5コマ',
  'Battle 7': 'バトル7コマ',
  'Vertical 2': '縦2コマ',
  'Bottom wide 3': '下段広め3コマ',
  'Wide top 4': '上段広め4コマ',
  'Wide bottom 4': '下段広め4コマ',
  'Tall left 4': '左縦長4コマ',
  'Right tall 4': '右縦長4コマ',
  'Balanced 5': 'バランス5コマ',
  'Middle wide 5': '中段広め5コマ',
  'Top wide 5': '上段広め5コマ',
  'Split 6': '分割6コマ',
  Dashed: '破線',
};

function normalizeUiLanguage(value: string): UiLanguage {
  return value === 'en' ? 'en' : 'ja';
}

function readStoredUiLanguage(): UiLanguage {
  if (typeof window === 'undefined') {
    return 'ja';
  }

  return normalizeUiLanguage(window.localStorage.getItem(uiLanguageStorageKey) ?? 'ja');
}

function translateUiString(language: UiLanguage, value: string): string {
  if (language === 'en') {
    return value;
  }

  if (value === 'episode_page_skeleton') {
    return '\u30da\u30fc\u30b8\u9aa8\u683c\u751f\u6210';
  }

  const exact = UI_JA_DICTIONARY[value] ?? UI_JA_OPTION_DICTIONARY[value];
  if (exact !== undefined) {
    return exact;
  }

  if (/^Page \d+$/.test(value)) {
    return value.replace(/^Page (\d+)$/, '$1\u30da\u30fc\u30b8');
  }

  if (/^Line \d+$/.test(value)) {
    return value.replace(/^Line (\d+)$/, '$1\u884c');
  }

  if (/^(\d+) records$/.test(value)) {
    return value.replace(/^(\d+) records$/, '$1\u4ef6');
  }

  return value;
}

function formatFramePanelMismatchDetail(
  language: UiLanguage,
  frameCount: number,
  panelCount: number,
): string {
  return translateUiString(
    language,
    'Current count: frames {frames} / panels {panels}. Apply a panel layout template to sync them before generating.',
  )
    .replace('{frames}', String(frameCount))
    .replace('{panels}', String(panelCount));
}

function formatDeletePanelConfirmMessage(language: UiLanguage, panelOrder: number): string {
  return language === 'ja'
    ? `${panelOrder}\u30b3\u30de\u76ee\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f\u6b8b\u308a\u306e\u30b3\u30de\u756a\u53f7\u3068\u30b3\u30de\u5272\u308a\u306f\u81ea\u52d5\u3067\u8a70\u3081\u307e\u3059\u3002`
    : `Delete panel ${panelOrder}? Remaining panel order and frames will be compacted automatically.`;
}

function formatPanelOrderLabel(language: UiLanguage, panelOrder: number): string {
  return language === 'ja' ? `${panelOrder}\u30b3\u30de\u76ee` : `Panel ${panelOrder}`;
}

function formatPanelRoleLabel(language: UiLanguage, panelRole: PanelRecord['panel_role']): string {
  const label = PANEL_ROLE_OPTIONS.find(([value]) => value === panelRole)?.[1] ?? panelRole;
  return translateUiString(language, label);
}

function getEpisodeStoryAutofillProgressMessage(job: GenerationJobRecord): string {
  const progressMessage = readStringResultField(job, 'progress_message');
  return progressMessage ?? 'Applying story plan to pages and panels. This process can take around 20 minutes.';
}

function getJobProgressText(job: GenerationJobRecord, language: UiLanguage): string | null {
  const progressMessage = readStringResultField(job, 'progress_message');
  if (progressMessage === null) {
    return null;
  }

  const translatedMessage = translateUiString(language, progressMessage);
  const chunkLabel = getJobProgressChunkLabel(job);
  return chunkLabel === null ? translatedMessage : `${translatedMessage} (${chunkLabel})`;
}

function getJobFailureText(job: GenerationJobRecord, language: UiLanguage): string | null {
  if (job.status !== 'failed') {
    return null;
  }

  return formatUserFacingErrorMessage({ message: job.error_message }, language);
}

function getJobProgressChunkLabel(job: GenerationJobRecord): string | null {
  const currentChunk = readNumberResultField(job, 'progress_current_chunk');
  const totalChunks = readNumberResultField(job, 'progress_total_chunks');
  if (currentChunk === null || totalChunks === null || totalChunks <= 1) {
    return null;
  }

  return `${currentChunk}/${totalChunks}`;
}

function getJobProgressPercent(job: GenerationJobRecord): number | null {
  const currentChunk = readNumberResultField(job, 'progress_current_chunk');
  const totalChunks = readNumberResultField(job, 'progress_total_chunks');
  if (currentChunk === null || totalChunks === null || totalChunks <= 0) {
    return null;
  }

  const boundedCurrent = Math.min(Math.max(currentChunk, 0), totalChunks);
  return Math.round((boundedCurrent / totalChunks) * 100);
}

function getJobProgressBarState(job: GenerationJobRecord): { percent: number | null; tone: 'active' | 'queued' | 'completed' | 'failed' } | null {
  const isActive = job.status === 'queued' || job.status === 'processing';
  const hasPersistedProgress = readStringResultField(job, 'progress_message') !== null;
  if (!isActive && !hasPersistedProgress) {
    return null;
  }

  if (job.status === 'completed') {
    return { percent: 100, tone: 'completed' };
  }

  if (job.status === 'failed') {
    return { percent: 100, tone: 'failed' };
  }

  return {
    percent: getJobProgressPercent(job),
    tone: job.status === 'queued' ? 'queued' : 'active',
  };
}

function readStringResultField(job: GenerationJobRecord, field: string): string | null {
  const value = job.result?.[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumberResultField(job: GenerationJobRecord, field: string): number | null {
  const value = job.result?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatShortId(id: string): string {
  return id.slice(0, 8);
}

function formatActionSuccessMessage(language: UiLanguage, actionLabel: string, translatedLabel: string): string {
  const isAsyncGenerationAction =
    actionLabel === 'Generate page' ||
    actionLabel === 'Generate reference' ||
    actionLabel === 'Generate page skeleton' ||
    actionLabel === 'Apply story plan';
  if (language === 'ja') {
    return isAsyncGenerationAction ? `${translatedLabel}\u3092\u958b\u59cb\u3057\u307e\u3057\u305f\u3002` : `${translatedLabel}\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f\u3002`;
  }

  return isAsyncGenerationAction ? `${translatedLabel} started.` : `${translatedLabel} completed.`;
}

function pickUiText(language: UiLanguage, english: string, japanese: string): string {
  return language === 'en' ? english : japanese;
}

function formatJpy(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatIsoDateTime(language: UiLanguage, isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatInvoiceKind(language: UiLanguage, invoice: OrganizationInvoiceRecord): string {
  if (invoice.kind === 'credit_purchase') {
    return pickUiText(language, 'Credit purchase', 'クレジット購入');
  }
  return pickUiText(language, 'Subscription', 'サブスク');
}

function formatAuditAction(language: UiLanguage, log: OrganizationAuditLogRecord): string {
  const labels: Record<string, { en: string; ja: string }> = {
    'organization.created': { en: 'Organization created', ja: '法人作成' },
    'organization.updated': { en: 'Organization updated', ja: '法人更新' },
    'member.invited': { en: 'Member invited', ja: 'メンバー招待' },
    'member.invitation_resent': { en: 'Invitation resent', ja: '招待再送' },
    'member.invitation_revoked': { en: 'Invitation revoked', ja: '招待取消' },
    'member.invitation_email_sent': { en: 'Invitation email sent', ja: '招待メール送信' },
    'member.invitation_email_failed': { en: 'Invitation email failed', ja: '招待メール失敗' },
    'member.joined': { en: 'Member joined', ja: 'メンバー参加' },
    'member.role_updated': { en: 'Member role updated', ja: 'メンバー権限更新' },
    'member.suspended': { en: 'Member suspended', ja: 'メンバー停止' },
    'member.reactivated': { en: 'Member reactivated', ja: 'メンバー復帰' },
    'member.removed': { en: 'Member removed', ja: 'メンバー削除' },
    'work.created': { en: 'Work created', ja: '作品作成' },
    'work.updated': { en: 'Work updated', ja: '作品更新' },
    'chapter.created': { en: 'Chapter created', ja: '章作成' },
    'chapter.updated': { en: 'Chapter updated', ja: '章更新' },
    'chapter.deleted': { en: 'Chapter deleted', ja: '章削除' },
    'chapter.moved': { en: 'Chapter moved', ja: '章並び替え' },
    'episode.created': { en: 'Episode created', ja: '話作成' },
    'episode.updated': { en: 'Episode updated', ja: '話更新' },
    'episode.deleted': { en: 'Episode deleted', ja: '話削除' },
    'episode.moved': { en: 'Episode moved', ja: '話並び替え' },
    'episode.page_skeleton_queued': { en: 'Page skeleton queued', ja: 'ページ骨格生成開始' },
    'episode.page_skeleton_generated': { en: 'Page skeleton generated', ja: 'ページ骨格生成' },
    'episode.story_autofill_queued': { en: 'Story applied to pages', ja: '話全体を反映開始' },
    'entity.created': { en: 'Character created', ja: 'キャラ作成' },
    'entity.updated': { en: 'Character updated', ja: 'キャラ更新' },
    'entity.deleted': { en: 'Character deleted', ja: 'キャラ削除' },
    'entity.reference_generation_queued': { en: 'Reference generation queued', ja: '参照生成開始' },
    'entity.reference_confirmed': { en: 'Reference confirmed', ja: '参照確定' },
    'entity.reference_deleted': { en: 'Reference deleted', ja: '参照削除' },
    'page.settings_updated': { en: 'Page settings updated', ja: 'ページ設定更新' },
    'page.layout_template_applied': { en: 'Panel layout applied', ja: 'コマ割り適用' },
    'page.autofill_from_scenes_applied': { en: 'Page autofill applied', ja: 'ページ補完' },
    'page.generation_queued': { en: 'Page generation queued', ja: 'ページ生成開始' },
    'page.confirmed': { en: 'Page confirmed', ja: 'ページ確定' },
    'page.reopened': { en: 'Page reopened', ja: 'ページ再編集' },
    'panel.created': { en: 'Panel created', ja: 'コマ作成' },
    'panel.updated': { en: 'Panel updated', ja: 'コマ更新' },
    'panel.deleted': { en: 'Panel deleted', ja: 'コマ削除' },
    'panel.reordered': { en: 'Panels reordered', ja: 'コマ並び替え' },
    'panel_frame.template_applied': { en: 'Panel frame template applied', ja: 'コマ枠テンプレ適用' },
    'panel_frame.replaced': { en: 'Panel frames replaced', ja: 'コマ枠更新' },
    'scene.created': { en: 'Scene created', ja: 'シーン作成' },
    'scene.updated': { en: 'Scene updated', ja: 'シーン更新' },
    'scene.deleted': { en: 'Scene deleted', ja: 'シーン削除' },
    'entity_state.created': { en: 'Character state created', ja: 'キャラ状態作成' },
    'entity_state.updated': { en: 'Character state updated', ja: 'キャラ状態更新' },
    'credit.granted': { en: 'Credits granted', ja: 'クレジット付与' },
    'credit.consumed': { en: 'Credits consumed', ja: 'クレジット消費' },
    'credit.refunded': { en: 'Credits refunded', ja: 'クレジット返却' },
    'billing.portal_opened': { en: 'Billing portal opened', ja: '請求ポータル表示' },
    'subscription.updated': { en: 'Subscription updated', ja: 'サブスク更新' },
    'generation.started': { en: 'Generation started', ja: '生成開始' },
    'generation.completed': { en: 'Generation completed', ja: '生成完了' },
    'generation.failed': { en: 'Generation failed', ja: '生成失敗' },
    'work.exported': { en: 'Work exported', ja: '作品保存' },
  };
  const label = labels[log.action];
  return label === undefined ? log.action : pickUiText(language, label.en, label.ja);
}

function formatInvitationSendStatus(language: UiLanguage, status: OrganizationInvitationRecord['send_status']): string {
  const labels: Record<OrganizationInvitationRecord['send_status'], { en: string; ja: string }> = {
    not_sent: { en: 'Not sent', ja: '未送信' },
    sending: { en: 'Sending', ja: '送信中' },
    sent: { en: 'Sent', ja: '送信済み' },
    failed: { en: 'Failed', ja: '送信失敗' },
  };
  return pickUiText(language, labels[status].en, labels[status].ja);
}

function formatInvitationDeliveryNotice(
  language: UiLanguage,
  status: 'disabled' | 'sent' | 'failed',
): string {
  if (status === 'sent') {
    return pickUiText(language, 'Invitation email sent.', '招待メールを送信しました。');
  }
  if (status === 'disabled') {
    return pickUiText(
      language,
      'Email delivery is not configured. Copy and share the invitation link.',
      'メール送信は未設定です。招待リンクをコピーして共有してください。',
    );
  }
  return pickUiText(
    language,
    'Invitation email failed. Copy the link or try resending.',
    '招待メールの送信に失敗しました。リンクをコピーするか、再送してください。',
  );
}

function formatInvitationSendError(language: UiLanguage, message: string): string {
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes('accessdenied') ||
    lowerMessage.includes('not authorized') ||
    lowerMessage.includes('ses') ||
    lowerMessage.includes('arn:')
  ) {
    return pickUiText(
      language,
      'Email delivery is not available. Copy the invitation link and share it directly.',
      'メール送信を利用できません。招待リンクをコピーして直接共有してください。',
    );
  }
  return pickUiText(
    language,
    'Invitation email could not be sent. Copy the invitation link or try resending.',
    '招待メールを送信できませんでした。招待リンクをコピーするか、再送してください。',
  );
}

function formatPlanLabel(language: UiLanguage, planCode: SubscriptionPlanCode): string {
  const labels: Record<SubscriptionPlanCode, { en: string; ja: string }> = {
    free: { en: 'Free', ja: 'フリー' },
    standard: { en: 'Standard', ja: 'スタンダード' },
    premium: { en: 'Premium', ja: 'プレミアム' },
    enterprise_a: { en: 'Enterprise A', ja: 'エンタープライズ A' },
    enterprise_b: { en: 'Enterprise B', ja: 'エンタープライズ B' },
    enterprise_c: { en: 'Enterprise C', ja: 'エンタープライズ C' },
  };
  const label = labels[planCode];
  return pickUiText(language, label.en, label.ja);
}

function getSubscriptionPlanRank(planCode: SubscriptionPlanCode): number {
  switch (planCode) {
    case 'enterprise_c':
      return 5;
    case 'enterprise_b':
      return 4;
    case 'enterprise_a':
      return 3;
    case 'premium':
      return 2;
    case 'standard':
      return 1;
    case 'free':
      return 0;
  }
}

function formatOrganizationRoleLabel(language: UiLanguage, role: OrganizationMemberRecord['role']): string {
  const match = organizationRoleOptions.find((option) => option.value === role);
  return match === undefined ? role : pickUiText(language, match.label.en, match.label.ja);
}

function formatOrganizationMemberStatusLabel(language: UiLanguage, status: OrganizationMemberRecord['status']): string {
  if (status === 'removed') {
    return pickUiText(language, 'Removed', '削除済み');
  }
  if (status === 'invited') {
    return pickUiText(language, 'Invited', '招待中');
  }
  const match = organizationMemberStatusOptions.find((option) => option.value === status);
  return match === undefined ? status : pickUiText(language, match.label.en, match.label.ja);
}

const tutorialSteps: Array<{
  title: { en: string; ja: string };
  steps: Array<{ en: string; ja: string }>;
}> = [
  {
    title: { en: 'Story', ja: 'ストーリー' },
    steps: [
      { en: 'Create a work from New work after entering at least a title.', ja: 'まずタイトルを入れて、新しい作品を作成します。' },
      { en: 'The work overview is optional. Add world setting or overall flow only when it helps.', ja: '作品の概要は任意です。世界観や全体の流れは、必要な範囲だけ書けば十分です。' },
      { en: 'Add a chapter, then add episodes inside that chapter.', ja: '章を追加し、その章の中に話を追加します。' },
      { en: 'Write the episode in the full story field. This is the main source for page planning.', ja: '話は全体入力欄にまとめて書きます。ここがページ骨格やコマ内容の主な材料になります。' },
      { en: 'Story AI can improve the current episode and apply the result back into the fields.', ja: 'ストーリーAIを使うと、現在の話を改善して入力欄へ反映できます。' },
      { en: 'Scenes are optional. Add location, time, and atmosphere when you want more control over page planning.', ja: 'シーンは任意です。場所・時間帯・雰囲気を細かく指定したい時だけ使います。' },
    ],
  },
  {
    title: { en: 'Characters', ja: 'キャラクター' },
    steps: [
      { en: 'Press New character and fill the fields you already know.', ja: '新規キャラを押し、分かっている項目から入力します。' },
      { en: 'You do not need to fill every blank field. Save the selected character before generation.', ja: 'すべての空欄を埋める必要はありません。生成前に、選択中のキャラを保存してください。' },
      { en: 'Generate a full-body preview, then confirm the image you want to use as the reference.', ja: '全身プレビューを生成し、使いたい画像をレファレンスとして確定します。' },
      { en: 'Confirmed references are what page generation uses for character consistency.', ja: 'ページ生成では、確定済みレファレンスを使ってキャラの一貫性を保ちます。' },
      { en: 'To use your own image, import it first. You can confirm the imported image or generate a new preview from it.', ja: '自分の画像を使う場合は先に取り込みます。取り込み画像の確定や、そこからの再プレビュー生成もできます。' },
    ],
  },
  {
    title: { en: 'Pages And Export', ja: 'ページ生成と保存' },
    steps: [
      { en: 'After creating the needed characters, return to Story and press Generate page plan.', ja: '必要なキャラを作成したら、ストーリーに戻ってページ骨格を生成します。' },
      { en: 'Page plan generation creates pages, frames, and panel slots. It can take a few minutes.', ja: 'ページ骨格生成ではページ、枠、コマ欄を作ります。数分かかる場合があります。' },
      { en: 'Use Apply story plan when you want the story distributed into panel details, characters, camera, background, and dialogue.', ja: '話をコマごとの状況、登場人物、カメラ、背景、セリフへ分配したい時は、話全体を反映します。' },
      { en: 'Apply story plan can take up to about 20 minutes. Keep the screen open while it is running.', ja: '話全体を反映は20分程度かかる場合があります。処理中は画面を開いたまま待ってください。' },
      { en: 'Open Pages, review each page, and adjust panel content, frame template, panel order, or panel count.', ja: 'ページを開き、各ページのコマ内容、コマ割り、コマ順、コマ数を調整します。' },
      { en: 'When ready, press Generate page. The image is created from the current saved page inputs.', ja: '調整できたらページ生成を押します。現在保存されているページ入力から画像を作ります。' },
      { en: 'If the image is not right, edit the panel inputs, save, and generate the page again.', ja: '結果が合わない場合は、コマ入力を修正して保存し、もう一度ページ生成します。' },
      { en: 'When finished, choose pages and file format, then download them.', ja: '完成したらページとファイル形式を選び、ダウンロードします。' },
    ],
  },
];
const selectedOrganizationStorageKey = 'lyra:web:selected-organization';
const selectedWorkStorageKey = 'lyra:web:selected-work';
const selectedChapterStorageKey = 'lyra:web:selected-chapter';
const selectedEpisodeStorageKey = 'lyra:web:selected-episode';
const selectedPageStorageKey = 'lyra:web:selected-page';
const pendingOrganizationInviteTokenStorageKey = 'lyra.pendingOrganizationInviteToken';
const cognitoRefreshSkewMs = 120_000;
const maxBrowserTimeoutMs = 2_147_483_647;
const splashVisibleMs = 2_000;
const splashFadeMs = 650;
const supabaseAuthConfigured = hasSupabaseAuthConfig();
const cognitoAuthConfig = getCognitoAuthConfig(
  {
    VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
    VITE_COGNITO_DOMAIN: import.meta.env.VITE_COGNITO_DOMAIN,
    VITE_COGNITO_LOGOUT_URI: import.meta.env.VITE_COGNITO_LOGOUT_URI,
    VITE_COGNITO_REDIRECT_URI: import.meta.env.VITE_COGNITO_REDIRECT_URI,
    VITE_COGNITO_SCOPES: import.meta.env.VITE_COGNITO_SCOPES,
    VITE_COGNITO_API_TOKEN_USE: import.meta.env.VITE_COGNITO_API_TOKEN_USE,
  },
  typeof window === 'undefined' ? undefined : window.location.origin,
);
const devAuthBypass =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'
    ? {
        email:
          typeof import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL === 'string' &&
          import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL.length > 0
            ? import.meta.env.VITE_DEV_AUTH_BYPASS_EMAIL
            : 'dev@local.lyra',
        token: 'dev-auth-bypass',
      }
    : null;
const manualTokenAuthAllowed = shouldAllowManualTokenAuth({
  MODE: import.meta.env.MODE,
  PROD: import.meta.env.PROD,
});

function readInviteTokenFromLocation(location: Location): string | null {
  const match = location.pathname.match(/^\/invite\/([^/]+)\/?$/u);
  if (match === null) {
    return null;
  }

  try {
    const token = decodeURIComponent(match[1]).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [manualToken, setManualToken] = useStoredString(window.sessionStorage, manualTokenStorageKey, '');
  const [cognitoSession, setCognitoSession] = useState<CognitoSession | null>(() =>
    cognitoAuthConfig === null ? null : readCompatibleStoredCognitoSession(cognitoAuthConfig, window.sessionStorage),
  );
  const [cognitoAuthError, setCognitoAuthError] = useState<string | null>(null);
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(null);
  const [supabaseSession, setSupabaseSession] = useState<Session | null>(null);
  const [pendingAuth, setPendingAuth] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [splashExiting, setSplashExiting] = useState(false);
  const publicApi = useMemo(() => new LyraApiClient(() => null), []);
  const inviteTokenFromPath = readInviteTokenFromLocation(window.location);

  useEffect(() => {
    const exitTimeout = window.setTimeout(() => {
      setSplashExiting(true);
    }, splashVisibleMs);
    const removeTimeout = window.setTimeout(() => {
      setShowSplash(false);
    }, splashVisibleMs + splashFadeMs);

    return () => {
      window.clearTimeout(exitTimeout);
      window.clearTimeout(removeTimeout);
    };
  }, []);

  useEffect(() => {
    if (devAuthBypass !== null) {
      setPendingAuth(false);
      return;
    }

    let active = true;
    let unsubscribe: (() => void) | null = null;

    const initializeAuth = async (): Promise<void> => {
      if (cognitoAuthConfig !== null) {
        const result = await completeCognitoRedirectIfPresent(
          cognitoAuthConfig,
          window.sessionStorage,
          window.location,
          window.history,
        );
        if (!active) {
          return;
        }

        if (result.session !== null) {
          setCognitoSession(result.session);
        }
        if (result.error !== null) {
          setCognitoAuthError(formatUserFacingErrorMessage({ message: result.error }, readStoredUiLanguage()));
        }
      }

      if (!supabaseAuthConfigured) {
        setPendingAuth(false);
        return;
      }

      const { createSupabaseBrowserClient } = await import('./lib/supabase');
      const loadedSupabaseClient = createSupabaseBrowserClient();
      if (!active) {
        return;
      }

      setSupabaseClient(loadedSupabaseClient);
      if (loadedSupabaseClient === null) {
        setPendingAuth(false);
        return;
      }

      const { data } = await loadedSupabaseClient.auth.getSession();
      if (!active) {
        return;
      }
      setSupabaseSession(data.session);
      setPendingAuth(false);

      const {
        data: { subscription },
      } = loadedSupabaseClient.auth.onAuthStateChange((_event, session) => {
        setSupabaseSession(session);
        setPendingAuth(false);
      });
      unsubscribe = () => subscription.unsubscribe();
    };

    void initializeAuth().catch((error: unknown) => {
      if (active) {
        setCognitoAuthError(toMessage(error, readStoredUiLanguage()));
        setPendingAuth(false);
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (devAuthBypass !== null || cognitoAuthConfig === null || cognitoSession === null) {
      return;
    }

    let active = true;
    const refreshDelayMs = getCognitoRefreshDelay(cognitoSession.expiresAt, Date.now());
    const timeoutId = window.setTimeout(() => {
      void refreshCognitoSession(cognitoAuthConfig, cognitoSession)
        .then((nextSession) => {
          if (!active) {
            return;
          }
          if (nextSession === null) {
            clearCognitoSession(window.sessionStorage);
            setCognitoSession(null);
            setCognitoAuthError(toMessage(new Error('Cognito session expired. Please sign in again.'), readStoredUiLanguage()));
            return;
          }

          if (!isCognitoSessionCompatible(cognitoAuthConfig, nextSession)) {
            clearCognitoSession(window.sessionStorage);
            setCognitoSession(null);
            setCognitoAuthError(toMessage(new Error('Cognito session no longer matches this app. Please sign in again.'), readStoredUiLanguage()));
            return;
          }

          storeCognitoSession(window.sessionStorage, nextSession);
          setCognitoSession(nextSession);
          setCognitoAuthError(null);
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          clearCognitoSession(window.sessionStorage);
          setCognitoSession(null);
          setCognitoAuthError(toMessage(error, readStoredUiLanguage()));
        });
    }, refreshDelayMs);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [cognitoSession]);

  const renderWithSplash = (content: ReactNode): ReactNode => (
    <>
      {content}
      {showSplash ? <SplashOverlay exiting={splashExiting} /> : null}
    </>
  );

  if (pendingAuth) {
    return renderWithSplash(
      <div className="screen-center">
        <LoaderCircle className="spin" size={24} />
      </div>,
    );
  }

  const cognitoApiToken =
    cognitoAuthConfig !== null && cognitoSession !== null
      ? getCognitoApiToken(cognitoAuthConfig, cognitoSession)
      : null;
  const accessToken = devAuthBypass !== null
    ? devAuthBypass.token
    : cognitoApiToken ??
      supabaseSession?.access_token ??
      (manualTokenAuthAllowed && manualToken.length > 0 ? manualToken : null);
  if (accessToken === null) {
    if (inviteTokenFromPath !== null) {
      return renderWithSplash(
        <InviteLandingScreen
          token={inviteTokenFromPath}
          authenticated={false}
          api={publicApi}
          authError={cognitoAuthError}
          onAccept={async () => undefined}
          onLogin={async () => {
            if (cognitoAuthConfig === null) {
              throw new Error(
                readStoredUiLanguage() === 'en'
                  ? 'Sign-in is not configured. Please contact the site administrator.'
                  : 'ログイン設定が未完了です。サイト管理者に連絡してください。',
              );
            }
            await beginCognitoLogin(cognitoAuthConfig, window.sessionStorage, window.location, window.crypto);
          }}
        />,
      );
    }

    return renderWithSplash(
      <AuthScreen
        cognitoAuthConfig={cognitoAuthConfig}
        cognitoAuthError={cognitoAuthError}
        manualTokenAuthAllowed={manualTokenAuthAllowed}
        manualToken={manualToken}
        onCognitoLogin={async () => {
          if (cognitoAuthConfig !== null) {
            await beginCognitoLogin(cognitoAuthConfig, window.sessionStorage, window.location, window.crypto);
          }
        }}
        onManualTokenChange={setManualToken}
        supabaseClient={supabaseClient}
      />,
    );
  }

  const payload = devAuthBypass !== null ? null : decodeJwtPayload(cognitoSession?.idToken ?? accessToken);
  const email = devAuthBypass !== null
    ? devAuthBypass.email
    : (typeof payload?.email === 'string' ? payload.email : null) ??
      (typeof payload?.username === 'string' ? payload.username : null) ??
      supabaseSession?.user.email ??
      'session';
  const authSessionKey = devAuthBypass !== null
    ? `dev:${devAuthBypass.email}`
    : typeof payload?.sub === 'string' && payload.sub.length > 0
      ? `sub:${payload.sub}`
      : `email:${email}`;
  const authedApi = new LyraApiClient(() => accessToken);

  if (inviteTokenFromPath !== null) {
    return renderWithSplash(
      <InviteLandingScreen
        token={inviteTokenFromPath}
        authenticated={true}
        api={authedApi}
        authError={cognitoAuthError}
        onAccept={async () => {
          const workspace = await authedApi.acceptOrganizationInvitation(inviteTokenFromPath);
          window.sessionStorage.removeItem(pendingOrganizationInviteTokenStorageKey);
          window.localStorage.setItem(
            scopedStorageKey(selectedOrganizationStorageKey, authSessionKey),
            workspace.organization.id,
          );
          window.history.replaceState(null, '', '/');
          window.location.assign('/');
        }}
        onLogin={async () => undefined}
      />,
    );
  }

  return renderWithSplash(
    <StudioShell
      key={authSessionKey}
      authSessionKey={authSessionKey}
      email={email}
      token={accessToken}
      supabaseClient={supabaseClient}
      onAuthExpired={async () => {
        clearCognitoSession(window.sessionStorage);
        setCognitoSession(null);
        setSupabaseSession(null);
        setManualToken('');
        setCognitoAuthError(formatUserFacingErrorMessage({ status: 401 }, readStoredUiLanguage()));
        if (supabaseClient !== null) {
          await supabaseClient.auth.signOut().catch(() => undefined);
        }
      }}
      onLogout={async () => {
        const hadCognitoSession = cognitoSession !== null;
        clearCognitoSession(window.sessionStorage);
        setCognitoSession(null);
        if (supabaseClient !== null) {
          await supabaseClient.auth.signOut();
        }
        setManualToken('');
        if (hadCognitoSession && cognitoAuthConfig !== null) {
          window.location.assign(buildCognitoLogoutUrl(cognitoAuthConfig));
        }
      }}
    />,
  );
}

function SplashOverlay(props: { exiting: boolean }) {
  return (
    <div className={`splash-overlay${props.exiting ? ' exiting' : ''}`} aria-hidden="true">
      <img className="splash-logo" src="/start_lyra.jpg" alt="" />
    </div>
  );
}

function useIsMobileViewport(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 760px)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const updateMatches = (): void => setMatches(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener('change', updateMatches);
    return () => mediaQuery.removeEventListener('change', updateMatches);
  }, []);

  return matches;
}

function getCognitoRefreshDelay(expiresAt: number, now: number): number {
  const delayMs = expiresAt - now - cognitoRefreshSkewMs;
  return Math.min(Math.max(delayMs, 0), maxBrowserTimeoutMs);
}

function hasSupabaseAuthConfig(): boolean {
  return (
    typeof import.meta.env.VITE_SUPABASE_URL === 'string' &&
    import.meta.env.VITE_SUPABASE_URL.length > 0 &&
    typeof import.meta.env.VITE_SUPABASE_ANON_KEY === 'string' &&
    import.meta.env.VITE_SUPABASE_ANON_KEY.length > 0
  );
}

function AuthScreen(props: {
  cognitoAuthConfig: CognitoAuthConfig | null;
  cognitoAuthError: string | null;
  manualTokenAuthAllowed: boolean;
  manualToken: string;
  onCognitoLogin: () => Promise<void>;
  onManualTokenChange: (nextValue: string) => void;
  supabaseClient: SupabaseClient | null;
}) {
  const language = normalizeUiLanguage(
    typeof window !== 'undefined' && window.localStorage.getItem(uiLanguageStorageKey) === 'en' ? 'en' : 'ja',
  );
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftToken, setDraftToken] = useState(props.manualToken);
  const visibleNotice = notice ?? (
    props.cognitoAuthError === null ? null : { type: 'error', message: props.cognitoAuthError } satisfies NoticeState
  );

  const submitMagicLink = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (props.supabaseClient === null) {
      setNotice({ type: 'error', message: translateUiString(language, 'Supabase client is not configured.') });
      return;
    }

    try {
      setBusy(true);
      const { error } = await props.supabaseClient.auth.signInWithOtp({ email });
      if (error !== null) {
        throw error;
      }
      setNotice({ type: 'success', message: translateUiString(language, 'Magic link sent.') });
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error, language) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="eyebrow">Lyra</div>
        <h1>Lyra Japan</h1>
        <p className="muted">{translateUiString(language, 'Lyra AI manga editor')}</p>
        {visibleNotice !== null ? <NoticeBanner notice={visibleNotice} /> : null}
        {props.cognitoAuthConfig !== null ? (
          <div className="stack">
            <button className="primary-button" onClick={() => void props.onCognitoLogin()} type="button">
              <KeyRound size={16} />
              {translateUiString(language, 'Sign in or create an account')}
            </button>
          </div>
        ) : null}
        {props.supabaseClient !== null ? (
          <form className="stack" onSubmit={submitMagicLink}>
            <label className="field">
              <span>{translateUiString(language, 'Email')}</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              {translateUiString(language, 'Send magic link')}
            </button>
          </form>
        ) : null}
        {props.manualTokenAuthAllowed ? (
          <>
            <div className="divider" />
            <div className="stack">
              <label className="field">
                <span>{translateUiString(language, 'Manual bearer token')}</span>
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
                {translateUiString(language, 'Use token')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function InviteLandingScreen(props: {
  token: string;
  authenticated: boolean;
  api: LyraApiClient;
  authError: string | null;
  onAccept: () => Promise<void>;
  onLogin: () => Promise<void>;
}) {
  const language = normalizeUiLanguage(
    typeof window !== 'undefined' && window.localStorage.getItem(uiLanguageStorageKey) === 'en' ? 'en' : 'ja',
  );
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const updateNow = (): void => setNowMs(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const previewQuery = useQuery({
    queryKey: ['organization-invitation-preview', props.token],
    queryFn: () => props.api.previewOrganizationInvitation(props.token),
    retry: false,
  });
  const preview = previewQuery.data ?? null;
  const invitationUnavailable =
    preview !== null &&
    (preview.invitation.status !== 'pending' ||
      (nowMs > 0 && Date.parse(preview.invitation.expires_at) <= nowMs));
  const canProceedWithInvite = !busy && !invitationUnavailable;
  const visibleNotice =
    notice ??
    (props.authError === null ? null : { type: 'error', message: props.authError } satisfies NoticeState);

  const acceptInvite = async (): Promise<void> => {
    try {
      setBusy(true);
      setNotice(null);
      await props.onAccept();
      setNotice({
        type: 'success',
        message: pickUiText(language, 'Joined the organization.', '法人ワークスペースに参加しました。'),
      });
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error, language) });
    } finally {
      setBusy(false);
    }
  };

  const beginLogin = async (): Promise<void> => {
    try {
      setBusy(true);
      window.sessionStorage.setItem(pendingOrganizationInviteTokenStorageKey, props.token);
      await props.onLogin();
    } catch (error) {
      window.sessionStorage.removeItem(pendingOrganizationInviteTokenStorageKey);
      setNotice({ type: 'error', message: toMessage(error, language) });
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card invite-card">
        <div className="eyebrow">Lyra</div>
        <h1>{pickUiText(language, 'Organization invitation', '法人ワークスペースへの招待')}</h1>
        {visibleNotice !== null ? <NoticeBanner notice={visibleNotice} /> : null}
        {previewQuery.isLoading ? (
          <div className="screen-inline-status">
            <LoaderCircle className="spin" size={18} />
            <span>{pickUiText(language, 'Checking invitation...', '招待リンクを確認しています...')}</span>
          </div>
        ) : previewQuery.isError ? (
          <NoticeBanner
            notice={{
              type: 'info',
              message: pickUiText(
                language,
                'The invitation could not be checked before sign-in. If this is the latest link, sign in or register with the invited email and Lyra will check it again.',
                'ログイン前の招待確認に失敗しました。最新のリンクであれば、招待されたメールアドレスでログインまたは登録すると再確認します。',
              ),
            }}
          />
        ) : preview !== null ? (
          <>
            <InvitePreviewDetails language={language} preview={preview} />
            {invitationUnavailable ? (
              <NoticeBanner
                notice={{
                  type: 'error',
                  message: pickUiText(
                    language,
                    'This invitation is expired, revoked, or already used. Ask the organization owner to resend it.',
                    'この招待は期限切れ、取り消し済み、または使用済みです。管理者に再送を依頼してください。',
                  ),
                }}
              />
            ) : null}
          </>
        ) : null}
        <p className="muted compact-copy">
          {pickUiText(
            language,
            'Use the same email address that received this invitation. New users can register from the sign-in page.',
            '招待されたメールアドレスと同じメールでログインまたは登録してください。未登録の場合もログイン画面から登録できます。',
          )}
        </p>
        <div className="stack">
          {props.authenticated ? (
            <button
              className="primary-button"
              disabled={!canProceedWithInvite}
              onClick={() => void acceptInvite()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {pickUiText(language, 'Join organization', '参加する')}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={!canProceedWithInvite}
              onClick={() => void beginLogin()}
              type="button"
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}
              {pickUiText(language, 'Sign in or register to join', 'ログインまたは登録して参加')}
            </button>
          )}
          <button className="secondary-button" onClick={() => window.location.assign('/')} type="button">
            {pickUiText(language, 'Back to Lyra', 'Lyraへ戻る')}
          </button>
        </div>
      </div>
    </div>
  );
}
function InvitePreviewDetails(props: {
  language: UiLanguage;
  preview: OrganizationInvitationPreviewRecord;
}) {
  return (
    <div className="invite-preview">
      <div>
        <span>{pickUiText(props.language, 'Organization', '組織')}</span>
        <strong>{props.preview.organization.name}</strong>
      </div>
      <div>
        <span>{pickUiText(props.language, 'Invited email', '招待メール')}</span>
        <strong>{props.preview.invitation.email}</strong>
      </div>
      <div>
        <span>{pickUiText(props.language, 'Role', '権限')}</span>
        <strong>{formatOrganizationRoleLabel(props.language, props.preview.invitation.role)}</strong>
      </div>
      <div>
        <span>{pickUiText(props.language, 'Expires at', '有効期限')}</span>
        <strong>{formatIsoDateTime(props.language, props.preview.invitation.expires_at)}</strong>
      </div>
    </div>
  );
}
function StudioShell(props: {
  authSessionKey: string;
  email: string;
  token: string;
  supabaseClient: SupabaseClient | null;
  onAuthExpired: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const onAuthExpired = props.onAuthExpired;
  const api = useMemo(() => new LyraApiClient(() => props.token), [props.token]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useStoredString(
    window.localStorage,
    scopedStorageKey(selectedOrganizationStorageKey, props.authSessionKey),
    '',
  );
  const activeOrganizationId =
    ORGANIZATION_FEATURES_AVAILABLE && selectedOrganizationId.trim().length > 0 ? selectedOrganizationId : null;
  const scopedQueryKey = useCallback(
    (queryKey: readonly unknown[]): readonly unknown[] => [
      'session',
      props.authSessionKey,
      'workspace',
      activeOrganizationId ?? 'personal',
      ...queryKey,
    ],
    [props.authSessionKey, activeOrganizationId],
  );
  const sessionQueryKey = useCallback(
    (queryKey: readonly unknown[]): readonly unknown[] => ['session', props.authSessionKey, ...queryKey],
    [props.authSessionKey],
  );
  const invalidateScopedQuery = useCallback(
    (queryKey: readonly unknown[]): Promise<void> =>
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(queryKey) }),
    [queryClient, scopedQueryKey],
  );
  const [uiLanguageStored, setUiLanguageStored] = useStoredString(window.localStorage, uiLanguageStorageKey, 'ja');
  const uiLanguage = normalizeUiLanguage(uiLanguageStored);
  const uiLanguageRef = useRef<UiLanguage>(uiLanguage);
  const pendingInviteAcceptRef = useRef(false);
  const isMobileViewport = useIsMobileViewport();
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [trackedJobIds, setTrackedJobIds] = useStoredString(
    window.localStorage,
    scopedStorageKey(trackedJobsStorageKey, props.authSessionKey),
    '[]',
  );
  const [selectedWorkId, setSelectedWorkId] = useStoredString(
    window.localStorage,
    scopedStorageKey(selectedWorkStorageKey, props.authSessionKey),
    '',
  );
  const [selectedChapterId, setSelectedChapterId] = useStoredString(
    window.localStorage,
    scopedStorageKey(selectedChapterStorageKey, props.authSessionKey),
    '',
  );
  const [selectedEpisodeId, setSelectedEpisodeId] = useStoredString(
    window.localStorage,
    scopedStorageKey(selectedEpisodeStorageKey, props.authSessionKey),
    '',
  );
  const [selectedPageId, setSelectedPageId] = useStoredString(
    window.localStorage,
    scopedStorageKey(selectedPageStorageKey, props.authSessionKey),
    '',
  );
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
  const [entityEditorMode, setEntityEditorMode] = useState<'edit' | 'create'>('edit');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [sceneDraft, setSceneDraft] = useState<SceneDraft>(createEmptySceneDraft());
  const [selectedSceneId, setSelectedSceneId] = useState('');
  const [pageSettingsDraft, setPageSettingsDraft] = useState<PageSettingsDraft>(createEmptyPageSettingsDraft());
  const [panelDraft, setPanelDraft] = useState<PanelDraft>(createEmptyPanelDraft());
  const [selectedPanelId, setSelectedPanelId] = useState('');
  const [panelEntityToAddId, setPanelEntityToAddId] = useState('');
  const [frameTemplateId, setFrameTemplateId] = useState('standard_4');
  const [frameDrafts, setFrameDrafts] = useState<PanelFrameDraft[]>([]);
  const [importingImage, setImportingImage] = useState(false);
  const [uploadedReferenceCandidatesByEntityId, setUploadedReferenceCandidatesByEntityId] = useState<Record<string, ReferenceCandidate[]>>({});
  const [generatedReferenceCandidatesByEntityId, setGeneratedReferenceCandidatesByEntityId] = useState<Record<string, ReferenceCandidate[]>>({});
  const [uploadedReferenceSourceByEntityId, setUploadedReferenceSourceByEntityId] = useState<Record<string, string>>({});
  const [referenceSelection, setReferenceSelection] = useState<string[]>([]);
  const [referencePrimaryKey, setReferencePrimaryKey] = useState('');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportSelectedPageIds, setExportSelectedPageIds] = useState<string[]>([]);
  const [exportFilename, setExportFilename] = useState('lyra-pages');
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);
  const [lightboxTitle, setLightboxTitle] = useState('');
  const [layoutPreviewTemplateId, setLayoutPreviewTemplateId] = useState<string | null>(null);
  const [organizationDraft, setOrganizationDraft] = useState<{
    name: string;
    legal_name: string;
    billing_email: string;
  }>({
    name: '',
    legal_name: '',
    billing_email: props.email,
  });
  const [organizationInviteDraft, setOrganizationInviteDraft] = useState<{
    email: string;
    role: OrganizationMemberRecord['role'];
  }>({
    email: '',
    role: 'editor',
  });
  const [organizationInvitationShareUrl, setOrganizationInvitationShareUrl] = useState('');
  const [collapsedOrganizationPanels, setCollapsedOrganizationPanels] = useState<
    Partial<Record<OrganizationDetailPanelKey, boolean>>
  >({});
  const handledJobsRef = useRef<Set<string>>(new Set());
  const lastWorkspaceRefreshRef = useRef(0);
  const billingVerificationTargetRef = useRef<BillingReturnMarker | null>(null);
  const [billingReturnChecking, setBillingReturnChecking] = useState(false);

  useEffect(() => {
    uiLanguageRef.current = uiLanguage;
  }, [uiLanguage]);

  useEffect(() => {
    if (!isMobileViewport && activeTab === 'tutorial') {
      setActiveTab('story');
    }
  }, [activeTab, isMobileViewport]);

  useEffect(() => {
    if (!ORGANIZATION_FEATURES_AVAILABLE && selectedOrganizationId.trim().length > 0) {
      setSelectedOrganizationId('');
    }
  }, [selectedOrganizationId, setSelectedOrganizationId]);

  useEffect(() => {
    setSelectedWorkId('');
    setSelectedChapterId('');
    setSelectedEpisodeId('');
    setSelectedPageId('');
    setSelectedEntityId('');
    setSelectedSceneId('');
    setSelectedPanelId('');
    setEntityEditorMode('edit');
  }, [
    activeOrganizationId,
    setSelectedWorkId,
    setSelectedChapterId,
    setSelectedEpisodeId,
    setSelectedPageId,
    setSelectedEntityId,
    setSelectedSceneId,
    setSelectedPanelId,
  ]);

  const trackedJobList = useMemo(() => parseTrackedJobIds(trackedJobIds), [trackedJobIds]);

  const organizationWorkspacesQuery = useQuery({
    queryKey: sessionQueryKey(['organizations']),
    queryFn: () => api.getOrganizationWorkspaces(),
    enabled: ORGANIZATION_FEATURES_AVAILABLE,
  });
  const organizationWorkspaces = useMemo(
    () => (ORGANIZATION_FEATURES_AVAILABLE ? (organizationWorkspacesQuery.data?.organizations ?? []) : []),
    [organizationWorkspacesQuery.data?.organizations],
  );
  const activeOrganizationWorkspace =
    activeOrganizationId === null
      ? null
      : organizationWorkspaces.find((workspace) => workspace.organization.id === activeOrganizationId) ?? null;
  const activeOrganizationRole = activeOrganizationWorkspace?.membership.role ?? null;
  const canManageActiveOrganization =
    activeOrganizationRole === 'owner' || activeOrganizationRole === 'admin';
  const canManageActiveOrganizationMembers = canManageActiveOrganization;
  const canViewActiveOrganizationBilling =
    activeOrganizationRole === 'owner' || activeOrganizationRole === 'billing';
  const canManageActiveOrganizationBilling = canViewActiveOrganizationBilling;
  const canViewActiveOrganizationUsage =
    activeOrganizationRole === 'owner' ||
    activeOrganizationRole === 'admin';
  const canViewActiveOrganizationAudit =
    canViewActiveOrganizationUsage ||
    activeOrganizationRole === 'billing';
  const canViewActiveOrganizationWorks =
    activeOrganizationId === null ||
    (activeOrganizationWorkspace !== null && activeOrganizationRole !== 'billing');
  const canCreateActiveOrganizationWorks =
    activeOrganizationId === null ||
    activeOrganizationRole === 'owner' ||
    activeOrganizationRole === 'admin' ||
    activeOrganizationRole === 'editor';
  const organizationBalanceQuery = useQuery({
    queryKey: sessionQueryKey(['organization-balance', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationBalance(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && activeOrganizationWorkspace !== null,
  });
  const organizationMembersQuery = useQuery({
    queryKey: sessionQueryKey(['organization-members', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationMembers(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canManageActiveOrganizationMembers,
  });
  const organizationInvitationsQuery = useQuery({
    queryKey: sessionQueryKey(['organization-invitations', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationInvitations(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canManageActiveOrganizationMembers,
  });
  const organizationBillingQuery = useQuery({
    queryKey: sessionQueryKey(['organization-billing', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationBilling(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canViewActiveOrganizationBilling,
  });
  const organizationUsageQuery = useQuery({
    queryKey: sessionQueryKey(['organization-usage', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationUsage(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canViewActiveOrganizationUsage,
  });
  const organizationAuditLogsQuery = useQuery({
    queryKey: sessionQueryKey(['organization-audit-logs', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationAuditLogs(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canViewActiveOrganizationAudit,
  });
  const organizationInvoicesQuery = useQuery({
    queryKey: sessionQueryKey(['organization-invoices', activeOrganizationId ?? '']),
    queryFn: () => api.getOrganizationInvoices(activeOrganizationId ?? ''),
    enabled: activeOrganizationId !== null && canViewActiveOrganizationBilling,
  });
  const organizationMembers = useMemo(
    () => organizationMembersQuery.data?.members ?? [],
    [organizationMembersQuery.data?.members],
  );
  const organizationInvitations = useMemo(
    () => organizationInvitationsQuery.data?.invitations ?? [],
    [organizationInvitationsQuery.data?.invitations],
  );
  const activeOrganizationBalance = organizationBalanceQuery.data ?? activeOrganizationWorkspace?.balance ?? null;
  const activeOrganizationSubscription = organizationBillingQuery.data?.subscription ?? null;
  const organizationSubscriptionPlans = organizationBillingQuery.data?.subscription_plans ?? [];
  const organizationUsageSummary = organizationUsageQuery.data?.summary ?? null;
  const organizationAuditLogs = organizationAuditLogsQuery.data?.audit_logs ?? [];
  const organizationInvoices = organizationInvoicesQuery.data?.invoices ?? [];
  const organizationBillingBusy =
    busyAction === 'Checkout organization subscription' ||
    busyAction === 'Checkout organization credits' ||
    busyAction === 'Open organization portal';
  const hasActiveOrganizationSubscription = activeOrganizationSubscription !== null;
  const activeOrganizationPlanCode =
    hasActiveOrganizationSubscription && isEnterpriseSubscriptionCheckoutPlanCode(activeOrganizationSubscription.plan_code)
      ? activeOrganizationSubscription.plan_code
      : null;
  const isOrganizationPanelCollapsed = (panelKey: OrganizationDetailPanelKey): boolean =>
    collapsedOrganizationPanels[panelKey] === true;
  const toggleOrganizationPanel = (panelKey: OrganizationDetailPanelKey): void => {
    setCollapsedOrganizationPanels((current) => ({
      ...current,
      [panelKey]: current[panelKey] !== true,
    }));
  };
  const canSelectOrganizationSubscriptionPlan = (plan: OrganizationBillingPlanRecord): boolean => {
    if (
      !canManageActiveOrganizationBilling ||
      organizationBillingBusy ||
      activeOrganizationWorkspace === null ||
      !plan.configured
    ) {
      return false;
    }

    if (!hasActiveOrganizationSubscription) {
      return true;
    }

    if (activeOrganizationPlanCode === plan.plan_code) {
      return false;
    }

    if (activeOrganizationPlanCode === null) {
      return true;
    }

    return getSubscriptionPlanRank(plan.plan_code) > getSubscriptionPlanRank(activeOrganizationPlanCode);
  };

  useEffect(() => {
    if (!ORGANIZATION_FEATURES_AVAILABLE) {
      window.sessionStorage.removeItem(pendingOrganizationInviteTokenStorageKey);
      return;
    }

    const pendingToken = window.sessionStorage.getItem(pendingOrganizationInviteTokenStorageKey);
    if (pendingToken === null || pendingToken.trim().length === 0 || pendingInviteAcceptRef.current) {
      return;
    }

    pendingInviteAcceptRef.current = true;
    void api.acceptOrganizationInvitation(pendingToken.trim())
      .then((workspace) => {
        window.sessionStorage.removeItem(pendingOrganizationInviteTokenStorageKey);
        setSelectedOrganizationId(workspace.organization.id);
        setNotice({
          type: 'success',
          message: pickUiText(uiLanguageRef.current, 'Joined the organization.', '法人ワークスペースに参加しました。'),
        });
        void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
        void queryClient.invalidateQueries({
          queryKey: sessionQueryKey(['organization-balance', workspace.organization.id]),
        });
      })
      .catch((error: unknown) => {
        setNotice({
          type: 'error',
          message: toMessage(error, uiLanguageRef.current),
        });
      })
      .finally(() => {
        pendingInviteAcceptRef.current = false;
      });
  }, [api, queryClient, sessionQueryKey, setSelectedOrganizationId]);

  useEffect(() => {
    if (
      activeOrganizationId !== null &&
      organizationWorkspacesQuery.isSuccess &&
      activeOrganizationWorkspace === null
    ) {
      setSelectedOrganizationId('');
    }
  }, [
    activeOrganizationId,
    activeOrganizationWorkspace,
    organizationWorkspacesQuery.isSuccess,
    setSelectedOrganizationId,
  ]);

  useEffect(() => {
    if (
      activeOrganizationId !== null &&
      activeOrganizationRole === 'billing' &&
      (activeTab === 'story' || activeTab === 'entities' || activeTab === 'pages')
    ) {
      setActiveTab('account');
    }
  }, [activeOrganizationId, activeOrganizationRole, activeTab]);

  const worksQuery = useQuery({
    queryKey: scopedQueryKey(['works']),
    queryFn: () => api.getWorks(activeOrganizationId),
    enabled: canViewActiveOrganizationWorks,
  });
  const works = useMemo(() => worksQuery.data?.works ?? [], [worksQuery.data?.works]);
  const showWorksLoading = works.length === 0 && worksQuery.isLoading;
  const showWorksError = works.length === 0 && worksQuery.isError;
  const showWorksEmpty = works.length === 0 && worksQuery.isSuccess;
  const worksErrorMessage = showWorksError ? toMessage(worksQuery.error, uiLanguage) : null;
  const worksErrorNeedsLogin = showWorksError && isApiStatus(worksQuery.error, 401);
  const balanceQuery = useQuery({
    queryKey: scopedQueryKey(['billing-balance']),
    queryFn: () => api.getBalance(),
  });

  const selectedWork = works.find((work) => work.id === selectedWorkId) ?? null;
  const selectedWorkScopedId = selectedWork?.id ?? '';

  const chaptersQuery = useQuery({
    queryKey: scopedQueryKey(['chapters', selectedWorkScopedId]),
    queryFn: () => api.getChapters(selectedWorkScopedId, activeOrganizationId),
    enabled: selectedWork !== null,
  });
  const chapters = useMemo(() => chaptersQuery.data?.chapters ?? [], [chaptersQuery.data?.chapters]);
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null;

  const episodesQuery = useQuery({
    queryKey: scopedQueryKey(['episodes', selectedChapter?.id ?? '']),
    queryFn: () => api.getEpisodes(selectedChapter?.id ?? '', activeOrganizationId),
    enabled: selectedChapter !== null,
  });
  const episodes = useMemo(() => episodesQuery.data?.episodes ?? [], [episodesQuery.data?.episodes]);
  const selectedEpisode = episodes.find((episode) => episode.id === selectedEpisodeId) ?? episodes[0] ?? null;

  const entitiesQuery = useQuery({
    queryKey: scopedQueryKey(['entities', selectedWorkScopedId]),
    queryFn: () => api.getEntities(selectedWorkScopedId, activeOrganizationId),
    enabled: selectedWork !== null,
  });
  const entities = useMemo(() => entitiesQuery.data?.entities ?? [], [entitiesQuery.data?.entities]);
  const selectedWorkEntityIds = useMemo(
    () => new Set(entities.map((entity) => entity.id)),
    [entities],
  );
  const loadedSelectedWorkEntityIds = entitiesQuery.isSuccess ? selectedWorkEntityIds : undefined;
  const selectedEntity =
    entityEditorMode === 'create'
      ? null
      : entities.find((entity) => entity.id === selectedEntityId) ?? entities[0] ?? null;

  const entityReferenceSetQuery = useQuery({
    queryKey: scopedQueryKey(['entity-reference-set', selectedEntity?.id ?? '']),
    queryFn: () => api.getEntityReferenceSet(selectedEntity?.id ?? '', activeOrganizationId),
    enabled: selectedEntity !== null,
  });

  const scenesQuery = useQuery({
    queryKey: scopedQueryKey(['scenes', selectedEpisode?.id ?? '']),
    queryFn: () => api.getScenes(selectedEpisode?.id ?? '', activeOrganizationId),
    enabled: selectedEpisode !== null,
  });
  const scenes = useMemo(() => scenesQuery.data?.scenes ?? [], [scenesQuery.data?.scenes]);
  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0] ?? null;

  const pagesQuery = useQuery({
    queryKey: scopedQueryKey(['pages', selectedEpisode?.id ?? '']),
    queryFn: () => api.getPages(selectedEpisode?.id ?? '', activeOrganizationId),
    enabled: selectedEpisode !== null,
  });
  const pages = useMemo(() => pagesQuery.data?.pages ?? [], [pagesQuery.data?.pages]);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;

  const compositionsQuery = useQuery({
    queryKey: scopedQueryKey(['compositions']),
    queryFn: () => api.getCompositions(),
  });
  const compositions = useMemo(
    () => compositionsQuery.data?.compositions ?? [],
    [compositionsQuery.data?.compositions],
  );

  const panelsQuery = useQuery({
    queryKey: scopedQueryKey(['panels', selectedPage?.id ?? '']),
    queryFn: () => api.getPanels(selectedPage?.id ?? '', activeOrganizationId),
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
    queryKey: scopedQueryKey(['frames', selectedPage?.id ?? '']),
    queryFn: () => api.getFrames(selectedPage?.id ?? '', activeOrganizationId),
    enabled: selectedPage !== null,
  });
  const frames = useMemo(() => framesQuery.data?.frames ?? [], [framesQuery.data?.frames]);
  const authExpiredHandledRef = useRef(false);
  const apiSessionExpired = [
    organizationWorkspacesQuery.error,
    organizationBalanceQuery.error,
    organizationMembersQuery.error,
    worksQuery.error,
    balanceQuery.error,
    chaptersQuery.error,
    episodesQuery.error,
    entitiesQuery.error,
    entityReferenceSetQuery.error,
    scenesQuery.error,
    pagesQuery.error,
    compositionsQuery.error,
    panelsQuery.error,
    framesQuery.error,
  ].some((error) => isApiStatus(error, 401));

  useEffect(() => {
    if (!apiSessionExpired || authExpiredHandledRef.current) {
      return;
    }

    authExpiredHandledRef.current = true;
    void onAuthExpired();
  }, [apiSessionExpired, onAuthExpired]);

  const generatedPages = useMemo(
    () => pages.filter((page) => page.generated_image !== null),
    [pages],
  );
  const exportablePages = useMemo(() => generatedPages.map((page) => page.id), [generatedPages]);
  const episodeHasExistingPagePlan = selectedEpisode !== null && (selectedEpisode.page_skeleton_generated || pages.length > 0);
  const skeletonContextLoading = selectedEpisode !== null && episodeHasExistingPagePlan && pagesQuery.isLoading;
  const skeletonActionLabel = episodeHasExistingPagePlan ? 'Regenerate page plan' : 'Generate page plan';
  const skeletonActionDisabled =
    selectedEpisode === null ||
    busyAction === 'Generate page skeleton';
  const skeletonActionMessage = skeletonContextLoading
    ? 'Loading current page plan.'
    : episodeHasExistingPagePlan
      ? 'Regenerating will replace the current pages for this episode.'
      : null;

  const jobQueries = useQueries({
    queries: trackedJobList.map((jobId) => ({
      queryKey: scopedQueryKey(['job', jobId]),
      queryFn: () => api.getJob(jobId),
      refetchInterval: (query: { state: { data: GenerationJobRecord | undefined } }) =>
        query.state.data?.status === 'queued' || query.state.data?.status === 'processing' ? 4000 : false,
    })),
  });
  const trackedJobs = jobQueries.map((query) => query.data).filter(isDefined);
  const jobs = trackedJobs.slice(0, 5);
  const activeJobs = trackedJobs.filter((job) => job.status === 'queued' || job.status === 'processing');
  const selectedEntityGenerationJob =
    selectedEntity === null
      ? null
      : [...activeJobs]
        .reverse()
        .find((job) => job.job_type === 'entity_generate' && job.params.entity_id === selectedEntity.id) ?? null;
  const selectedPageGenerationJob =
    selectedPage === null
      ? null
      : [...activeJobs]
        .reverse()
        .find((job) => job.job_type === 'page_generate' && job.params.page_id === selectedPage.id) ?? null;
  const selectedEpisodeStoryAutofillJob =
    selectedEpisode === null
      ? null
      : [...activeJobs]
        .reverse()
        .find((job) => job.job_type === 'episode_story_autofill' && job.params.episode_id === selectedEpisode.id) ?? null;
  const selectedEpisodePageSkeletonJob =
    selectedEpisode === null
      ? null
      : [...activeJobs]
        .reverse()
        .find((job) => job.job_type === 'episode_page_skeleton' && job.params.episode_id === selectedEpisode.id) ?? null;
  const skeletonGenerationMessage =
    selectedEpisodePageSkeletonJob !== null
      ? selectedEpisodePageSkeletonJob.status === 'queued'
        ? 'Queued. This process can take around 20 minutes.'
        : getEpisodeStoryAutofillProgressMessage(selectedEpisodePageSkeletonJob)
      : busyAction === 'Generate page skeleton'
        ? 'Generating page skeleton. This process can take around 20 minutes.'
      : null;
  const storyPlanProcessingMessage =
    selectedEpisodeStoryAutofillJob !== null
      ? selectedEpisodeStoryAutofillJob.status === 'queued'
        ? 'Queued. This process can take around 20 minutes.'
        : getEpisodeStoryAutofillProgressMessage(selectedEpisodeStoryAutofillJob)
      : busyAction === 'Apply story plan'
        ? 'Applying story plan to pages and panels. This process can take around 20 minutes.'
        : null;
  const selectedPageFrameCount = framesQuery.data?.frames.length ?? selectedPage?.frame_count ?? 0;
  const selectedPagePanelCount = panelsQuery.data?.panels.length ?? selectedPage?.panel_count ?? 0;
  const selectedPageHasFramePanelMismatch =
    selectedPage !== null && selectedPageFrameCount !== selectedPagePanelCount;
  const canPreviewFrameTemplate =
    frameTemplateId === CUSTOM_FRAME_TEMPLATE_ID
      ? frameDrafts.length > 0
      : FRAME_TEMPLATE_PANEL_COUNTS[frameTemplateId] !== undefined;
  const layoutPreviewFrames = useMemo(() => {
    if (layoutPreviewTemplateId === null) {
      return [];
    }

    if (layoutPreviewTemplateId === CUSTOM_FRAME_TEMPLATE_ID) {
      return frameDrafts.map(toFramePreviewDefinition).filter(isDefined);
    }

    return FRAME_TEMPLATE_PREVIEWS[layoutPreviewTemplateId] ?? [];
  }, [frameDrafts, layoutPreviewTemplateId]);

  useEffect(() => {
    if (selectedPage === null) {
      setFrameTemplateId('standard_4');
      return;
    }

    const nextTemplateId = resolveFrameTemplateSelection(
      selectedPage.layout_config,
      selectedPagePanelCount,
      selectedPageFrameCount,
      frameDrafts,
    );
    setFrameTemplateId((current) => (current === nextTemplateId ? current : nextTemplateId));
  }, [
    frameDrafts,
    selectedPage,
    selectedPageFrameCount,
    selectedPagePanelCount,
  ]);

  const generatePageDisabled =
    busyAction === 'Generate page' || selectedPageHasFramePanelMismatch;
  const entityPreviewGenerationMessage =
    selectedEntityGenerationJob !== null
      ? selectedEntityGenerationJob.status === 'queued'
        ? 'Queued. Starts soon.'
        : 'Generating preview. It updates when finished.'
      : busyAction === 'Generate reference'
        ? 'Generating preview. It updates when finished.'
        : null;
  const pageImageGenerationMessage =
    selectedPageGenerationJob !== null
      ? selectedPageGenerationJob.status === 'queued'
        ? 'Queued. Starts soon.'
        : 'Generating page. It updates when finished.'
      : busyAction === 'Generate page'
        ? 'Generating page. It updates when finished.'
        : null;

  const refreshWorkspaceQueries = useCallback((force = false): void => {
    const now = Date.now();
    if (!force && now - lastWorkspaceRefreshRef.current < 1500) {
      return;
    }
    lastWorkspaceRefreshRef.current = now;

    const queryKeys: Array<readonly unknown[]> = [
      ['works'],
      ['billing-balance'],
    ];

    if (selectedWorkId.length > 0) {
      queryKeys.push(['chapters', selectedWorkId], ['entities', selectedWorkId]);
    }
    if (selectedChapter !== null) {
      queryKeys.push(['episodes', selectedChapter.id]);
    }
    if (selectedEpisode !== null) {
      queryKeys.push(['scenes', selectedEpisode.id], ['pages', selectedEpisode.id]);
    }
    if (selectedPage !== null) {
      queryKeys.push(['frames', selectedPage.id], ['panels', selectedPage.id]);
    }

    for (const queryKey of queryKeys) {
      void invalidateScopedQuery(queryKey);
    }
    void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
    if (activeOrganizationId !== null) {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organization-balance', activeOrganizationId]) });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organization-members', activeOrganizationId]) });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organization-invitations', activeOrganizationId]) });
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organization-billing-plans', activeOrganizationId]) });
    }
  }, [
    activeOrganizationId,
    invalidateScopedQuery,
    queryClient,
    selectedWorkId,
    selectedChapter,
    selectedEpisode,
    selectedPage,
    sessionQueryKey,
  ]);

  const startBillingReturnVerification = useCallback((marker: BillingReturnMarker): void => {
    billingVerificationTargetRef.current = marker;
    setBillingReturnChecking(true);
    setNotice({ type: 'info', message: formatBillingReturnPendingMessage(uiLanguageRef.current, marker.kind) });
    refreshWorkspaceQueries(true);
  }, [refreshWorkspaceQueries]);

  useEffect(() => {
    const consumeBillingReturnMarker = (): BillingReturnMarker | null => {
      const marker = readBillingReturnMarker(window.sessionStorage.getItem(billingReturnPendingStorageKey));
      if (marker !== null) {
        window.sessionStorage.removeItem(billingReturnPendingStorageKey);
      }
      return marker;
    };

    const handlePageShow = (event: PageTransitionEvent): void => {
      const marker = event.persisted ? null : consumeBillingReturnMarker();
      if (marker !== null) {
        startBillingReturnVerification(marker);
        return;
      }

      if (event.persisted) {
        refreshWorkspaceQueries(true);
      }
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const marker = consumeBillingReturnMarker();
      if (marker !== null) {
        startBillingReturnVerification(marker);
      }
    };

    const initialMarker = consumeBillingReturnMarker();
    if (initialMarker !== null) {
      startBillingReturnVerification(initialMarker);
    }

    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshWorkspaceQueries, startBillingReturnVerification]);

  useEffect(() => {
    if (!billingReturnChecking) {
      return;
    }

    const intervalId = window.setInterval(() => refreshWorkspaceQueries(true), billingReturnVerificationIntervalMs);
    const timeoutId = window.setTimeout(() => {
      if (!billingReturnChecking) {
        return;
      }
      billingVerificationTargetRef.current = null;
      setBillingReturnChecking(false);
      setNotice({ type: 'info', message: formatBillingReturnTimeoutMessage(uiLanguageRef.current) });
    }, billingReturnVerificationTimeoutMs);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [billingReturnChecking, refreshWorkspaceQueries]);

  useEffect(() => {
    const marker = billingVerificationTargetRef.current;
    if (!billingReturnChecking || marker === null) {
      return;
    }

    const markerOrganizationWorkspace =
      marker.organizationId === undefined
        ? null
        : organizationWorkspaces.find((workspace) => workspace.organization.id === marker.organizationId) ?? null;
    const markerOrganizationBalance =
      marker.organizationId !== undefined && activeOrganizationId === marker.organizationId
        ? organizationBalanceQuery.data ?? markerOrganizationWorkspace?.balance ?? null
        : markerOrganizationWorkspace?.balance ?? null;

    if (
      !isBillingReturnSatisfied(balanceQuery.data, marker, {
        planCode:
          marker.organizationId !== undefined &&
          activeOrganizationId === marker.organizationId &&
          isEnterpriseSubscriptionCheckoutPlanCode(activeOrganizationSubscription?.plan_code)
            ? activeOrganizationSubscription.plan_code
            : null,
        totalCredits: markerOrganizationBalance?.total_credits ?? null,
        purchasedCredits: markerOrganizationBalance?.purchased_credits ?? null,
      })
    ) {
      return;
    }

    billingVerificationTargetRef.current = null;
    setBillingReturnChecking(false);
    setNotice({ type: 'success', message: formatBillingReturnSuccessMessage(uiLanguage, marker.kind) });
  }, [
    activeOrganizationId,
    activeOrganizationSubscription,
    balanceQuery.data,
    billingReturnChecking,
    organizationBalanceQuery.data,
    organizationWorkspaces,
    uiLanguage,
  ]);

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
    if (entityEditorMode === 'create') {
      return;
    }

    if (!entities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(entities[0]?.id ?? '');
    }
  }, [entities, entityEditorMode, selectedEntityId]);

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
    if (entityEditorMode === 'edit' && selectedEntity !== null) {
      setEntityDraft(toEntityDraft(selectedEntity));
    }
  }, [entityEditorMode, selectedEntity]);

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
    setFrameDrafts(frames.map(toPanelFrameDraft));
  }, [frames]);

  useEffect(() => {
    for (const job of [...trackedJobs].reverse()) {
      if (handledJobsRef.current.has(job.id)) {
        continue;
      }

      if (job.status === 'completed' || job.status === 'failed') {
        handledJobsRef.current.add(job.id);
        void invalidateScopedQuery(['billing-balance']);

        if (job.job_type === 'page_generate') {
          const pageId = typeof job.params.page_id === 'string' ? job.params.page_id : null;
          if (pageId !== null) {
            void invalidateScopedQuery(['panels', pageId]);
            void invalidateScopedQuery(['frames', pageId]);
          }

          void invalidateScopedQuery(['pages']);
        }
        if (job.job_type === 'episode_story_autofill') {
          const episodeId = typeof job.params.episode_id === 'string' ? job.params.episode_id : null;
          if (episodeId !== null) {
            void invalidateScopedQuery(['pages', episodeId]);
          }
          void invalidateScopedQuery(['pages']);
          void invalidateScopedQuery(['panels']);
          void invalidateScopedQuery(['frames']);
        }
        if (job.job_type === 'episode_page_skeleton') {
          const episodeId = typeof job.params.episode_id === 'string' ? job.params.episode_id : null;
          if (episodeId !== null) {
            void invalidateScopedQuery(['pages', episodeId]);
          }
          void invalidateScopedQuery(['episodes']);
          void invalidateScopedQuery(['pages']);
          void invalidateScopedQuery(['panels']);
          void invalidateScopedQuery(['frames']);
        }
        if (job.job_type === 'entity_generate') {
          const entityId = typeof job.params.entity_id === 'string' ? job.params.entity_id : null;
            if (entityId !== null) {
              const nextCandidates = extractGeneratedReferenceCandidates(job);
              if (nextCandidates.length > 0) {
                setGeneratedReferenceCandidatesByEntityId((current) =>
                  sameReferenceCandidates(current[entityId] ?? [], nextCandidates)
                    ? current
                    : {
                        ...current,
                        [entityId]: nextCandidates,
                      },
                );
              } else {
                setGeneratedReferenceCandidatesByEntityId((current) => {
                  if (current[entityId] === undefined) {
                    return current;
                  }

                  const remaining = { ...current };
                  delete remaining[entityId];
                  return remaining;
                });
              }
              void invalidateScopedQuery(['entity-reference-set', entityId]);
            }
          }
      }
    }
  }, [trackedJobs, invalidateScopedQuery]);

  const referenceCandidates = useMemo(() => {
    if (selectedEntity === null) {
      return [];
    }

    const uploadedCandidates = uploadedReferenceCandidatesByEntityId[selectedEntity.id] ?? [];
    const generatedReferenceCandidates = generatedReferenceCandidatesByEntityId[selectedEntity.id] ?? [];
    return dedupeReferenceCandidates([...uploadedCandidates, ...generatedReferenceCandidates]);
  }, [generatedReferenceCandidatesByEntityId, selectedEntity, uploadedReferenceCandidatesByEntityId]);

  const characterStructuredFields = useMemo(
    () => parseCharacterStructuredFieldsDraft(entityDraft.structured_fields),
    [entityDraft.structured_fields],
  );

  useEffect(() => {
    if (referenceCandidates.length === 0) {
      if (referenceSelection.length > 0) {
        setReferenceSelection([]);
      }
      if (referencePrimaryKey.length > 0) {
        setReferencePrimaryKey('');
      }
      return;
    }

    const hasSelectionForCurrentCandidates = referenceCandidates.some((candidate) =>
      referenceSelection.includes(candidate.candidate_token),
    );
    const firstSelectedCandidateKey = referenceSelection.find((selectedKey) =>
      referenceCandidates.some((candidate) => candidate.candidate_token === selectedKey),
    );

    if (!hasSelectionForCurrentCandidates) {
      setReferenceSelection(referenceCandidates.map((candidate) => candidate.candidate_token));
      setReferencePrimaryKey(referenceCandidates[0]?.candidate_token ?? '');
      return;
    }

    if (
      referencePrimaryKey.length > 0 &&
      !referenceSelection.includes(referencePrimaryKey) &&
      referenceCandidates.some((candidate) => candidate.candidate_token === referencePrimaryKey)
    ) {
      setReferenceSelection([...referenceSelection, referencePrimaryKey]);
      return;
    }

    if (!referenceCandidates.some((candidate) => candidate.candidate_token === referencePrimaryKey)) {
      setReferencePrimaryKey(firstSelectedCandidateKey ?? referenceCandidates[0]?.candidate_token ?? '');
    }
  }, [referenceCandidates, referencePrimaryKey, referenceSelection]);

  const saveCurrentEpisodeContext = async (): Promise<void> => {
    if (selectedEpisode !== null) {
      await api.updateEpisode(selectedEpisode.id, toEpisodeAutosavePayload(episodeDraft), activeOrganizationId);
    }

    if (selectedScene !== null) {
      await api.updateScene(selectedScene.id, toSceneAutosavePayload(sceneDraft), activeOrganizationId);
    }

    if (selectedChapter !== null) {
      await invalidateScopedQuery(['episodes', selectedChapter.id]);
    }
    if (selectedEpisode !== null) {
      await invalidateScopedQuery(['scenes', selectedEpisode.id]);
    }
  };

  const saveCurrentPageGenerationContext = async (): Promise<void> => {
    if (selectedPage !== null) {
      await api.updatePage(selectedPage.id, toPageSettingsPayload(pageSettingsDraft), activeOrganizationId);
    }

    if (selectedPage !== null && selectedPanel !== null) {
      const assignmentsPayload = toPanelAssignmentsPayload(panelDraft);
      await api.updatePanel(selectedPanel.id, toPanelPayload(panelDraft), activeOrganizationId);
      await api.replacePanelAssignments(selectedPanel.id, assignmentsPayload, activeOrganizationId);
    }
  };

  const saveCurrentEntityGenerationContext = async (): Promise<void> => {
    if (selectedEntity === null || selectedWork === null) {
      return;
    }

    const savedEntity = await api.updateEntity(selectedEntity.id, toEntityPayload(entityDraft), activeOrganizationId);
    cacheEntityRecord(savedEntity);
    setEntityDraft(toEntityDraft(savedEntity));
    await invalidateScopedQuery(['entities', selectedWork.id]);
  };

  const beginNewEntityDraft = (): void => {
    setEntityEditorMode('create');
    setSelectedEntityId('');
    setEntityDraft(createEmptyEntityDraft());
    setReferenceSelection([]);
    setReferencePrimaryKey('');
  };

  const selectEntityForEditing = (entityId: string): void => {
    setEntityEditorMode('edit');
    setSelectedEntityId(entityId);
    setReferenceSelection([]);
    setReferencePrimaryKey('');
  };

  const confirmUiAction = (message: string): boolean => window.confirm(translateUiString(uiLanguage, message));

  const refreshSelectedPagePanelData = async (pageId: string): Promise<void> => {
    await invalidateScopedQuery(['panels', pageId]);
    await invalidateScopedQuery(['frames', pageId]);
    if (selectedEpisode !== null) {
      await invalidateScopedQuery(['pages', selectedEpisode.id]);
    }
  };

  const reorderPanelWithinSelectedPage = async (
    panelId: string,
    direction: 'up' | 'down',
  ): Promise<void> => {
    if (selectedPage === null) {
      return;
    }

    const currentIndex = panels.findIndex((panel) => panel.id === panelId);
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= panels.length) {
      return;
    }

    const nextPanels = [...panels];
    const currentPanel = nextPanels[currentIndex];
    const targetPanel = nextPanels[targetIndex];
    if (currentPanel === undefined || targetPanel === undefined) {
      return;
    }
    nextPanels[currentIndex] = targetPanel;
    nextPanels[targetIndex] = currentPanel;

    await api.reorderPanels(selectedPage.id, nextPanels.map((panel) => panel.id), activeOrganizationId);
    setSelectedPanelId(panelId);
    await refreshSelectedPagePanelData(selectedPage.id);
  };

  const deletePanelFromSelectedPage = async (panel: PanelRecord): Promise<void> => {
    if (selectedPage === null) {
      return;
    }

    const deletedIndex = panels.findIndex((item) => item.id === panel.id);
    const remainingPanels = panels.filter((item) => item.id !== panel.id);
    const nextSelectedPanelId =
      remainingPanels[Math.min(deletedIndex, remainingPanels.length - 1)]?.id ?? '';

    await api.deletePanel(panel.id, activeOrganizationId);
    setSelectedPanelId(nextSelectedPanelId);
    await refreshSelectedPagePanelData(selectedPage.id);
  };

  const cacheEntityRecord = (entity: EntityRecord): void => {
    queryClient.setQueryData<{ entities: EntityRecord[] }>(scopedQueryKey(['entities', entity.work_id]), (current) => {
      if (current === undefined) {
        return { entities: [entity] };
      }

      const entityExists = current.entities.some((item) => item.id === entity.id);
      return {
        ...current,
        entities: entityExists
          ? current.entities.map((item) => (item.id === entity.id ? entity : item))
          : [entity, ...current.entities],
      };
    });
  };

  const removeEntityFromCache = (workId: string, entityId: string): void => {
    queryClient.setQueryData<{ entities: EntityRecord[] }>(scopedQueryKey(['entities', workId]), (current) =>
      current === undefined
        ? current
        : {
            ...current,
            entities: current.entities.filter((entity) => entity.id !== entityId),
          },
    );
  };

  const runAction = async (label: string, action: () => Promise<string | void>): Promise<void> => {
    try {
      setBusyAction(label);
      const customSuccessMessage = await action();
      const translatedLabel = translateUiString(uiLanguage, label);
      setNotice({
        type: 'success',
        message: customSuccessMessage ?? formatActionSuccessMessage(uiLanguage, label, translatedLabel),
      });
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error, uiLanguage) });
    } finally {
      setBusyAction(null);
    }
  };

  const runExternalRedirectAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      setBusyAction(label);
      setNotice({ type: 'info', message: formatExternalRedirectPendingMessage(uiLanguage, label) });
      await action();
    } catch (error) {
      setNotice({ type: 'error', message: toMessage(error, uiLanguage) });
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
      const { jsPDF } = await import('jspdf');
      const assets: Array<{ page: PageRecord; dataUrl: string }> = [];
      for (const page of targetPages) {
        const response = await api.exportPageImage(page.id, activeOrganizationId);
        assets.push({
          page,
          dataUrl: await blobToDataUrl(response.blob),
        });
      }
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
    for (const page of targetPages) {
      const response = await api.exportPageImage(page.id, activeOrganizationId);
      const extension = inferImageExtension(response.contentType);
      const filename = multiple ? `${baseName}-page-${String(page.page_number).padStart(2, '0')}.${extension}` : `${baseName}.${extension}`;
      triggerBlobDownload(response.blob, filename);
    }
  };

  const updateFrameDraft = (index: number, patch: Partial<PanelFrameDraft>): void => {
    setFrameDrafts((current) =>
      current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)),
    );
  };

  const updateFrameVertexDraft = (
    frameIndex: number,
    vertexIndex: number,
    axis: 'x' | 'y',
    value: string,
  ): void => {
    setFrameDrafts((current) =>
      current.map((draft, draftIndex) => {
        if (draftIndex !== frameIndex) {
          return draft;
        }

        return {
          ...draft,
          vertices: draft.vertices.map((vertex, currentVertexIndex) =>
            currentVertexIndex === vertexIndex ? { ...vertex, [axis]: value } : vertex,
          ),
        };
      }),
    );
  };

  const workspacePanel = (
    <PanelSection
      title={pickUiText(uiLanguage, 'Workspace', 'ワークスペース')}
      subtitle={
        ORGANIZATION_FEATURES_AVAILABLE
          ? pickUiText(
              uiLanguage,
              'Switch between personal work and organization work.',
              '\u500b\u4eba\u5229\u7528\u3068\u6cd5\u4eba\u5229\u7528\u3092\u5207\u308a\u66ff\u3048\u307e\u3059\u3002',
            )
          : pickUiText(
              uiLanguage,
              'Personal use is available now.',
              '\u73fe\u5728\u306f\u500b\u4eba\u5229\u7528\u306e\u307f\u3054\u5229\u7528\u3044\u305f\u3060\u3051\u307e\u3059\u3002',
            )
      }
      className="organization-panel"
      compact
    >
      {ORGANIZATION_FEATURES_AVAILABLE ? (
        <>
      <label className="field">
        <span>{pickUiText(uiLanguage, 'Current workspace', '\u73fe\u5728\u306e\u4f5c\u696d\u5834\u6240')}</span>
        <select value={activeOrganizationId ?? ''} onChange={(event) => setSelectedOrganizationId(event.target.value)}>
          <option value="">{pickUiText(uiLanguage, 'Personal', '\u500b\u4eba')}</option>
          {organizationWorkspaces.map((workspace) => (
            <option key={workspace.organization.id} value={workspace.organization.id}>
              {workspace.organization.name}
            </option>
          ))}
        </select>
      </label>

      {activeOrganizationWorkspace !== null ? (
        <div className="organization-active-card">
          <div className="organization-active-header">
            <div>
              <strong>{activeOrganizationWorkspace.organization.name}</strong>
              <span>
                {hasActiveOrganizationSubscription
                  ? activeOrganizationPlanCode === null
                    ? pickUiText(uiLanguage, 'Unknown plan', '\u4e0d\u660e\u306a\u30d7\u30e9\u30f3')
                    : formatPlanLabel(uiLanguage, activeOrganizationPlanCode)
                  : pickUiText(uiLanguage, 'No paid plan', '\u6709\u6599\u30d7\u30e9\u30f3\u672a\u5951\u7d04')}{' '}
                /{' '}
                {formatOrganizationRoleLabel(uiLanguage, activeOrganizationWorkspace.membership.role)}
              </span>
            </div>
            <StatusBadge value={activeOrganizationWorkspace.organization.status} />
          </div>
          <div className="metric-grid organization-metrics">
            <Metric
              label={pickUiText(uiLanguage, 'Shared credits', '\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8')}
              value={String(activeOrganizationBalance?.total_credits ?? 0)}
            />
            <Metric label={pickUiText(uiLanguage, 'Monthly', '\u6708\u984d\u5206')} value={String(activeOrganizationBalance?.monthly_credits ?? 0)} />
            <Metric label={pickUiText(uiLanguage, 'Purchased', '\u8ffd\u52a0\u5206')} value={String(activeOrganizationBalance?.purchased_credits ?? 0)} />
          </div>
          <div className="muted small">
            {pickUiText(
              uiLanguage,
              'Generation in this workspace consumes organization shared credits.',
              '\u3053\u306e\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u5185\u306e\u751f\u6210\u306f\u6cd5\u4eba\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8\u3092\u4f7f\u3044\u307e\u3059\u3002',
            )}
          </div>

          {canViewActiveOrganizationBilling ? (
          <OrganizationDetailPanel
            className="organization-billing-panel"
            collapsed={isOrganizationPanelCollapsed('billing')}
            meta={
              canManageActiveOrganizationBilling
                ? pickUiText(uiLanguage, 'Owner/Billing only', '\u30aa\u30fc\u30ca\u30fc\u30fb\u8acb\u6c42\u7ba1\u7406\u306e\u307f')
                : pickUiText(uiLanguage, 'Billing permission required', '\u8acb\u6c42\u7ba1\u7406\u6a29\u9650\u304c\u5fc5\u8981')
            }
            onToggle={() => toggleOrganizationPanel('billing')}
            title={pickUiText(uiLanguage, 'Organization billing', '\u6cd5\u4eba\u8acb\u6c42')}
          >
            <div className="billing-current-plan">
              <span>
                {pickUiText(uiLanguage, 'Current organization plan', '\u73fe\u5728\u306e\u6cd5\u4eba\u30d7\u30e9\u30f3')}
              </span>
              <strong>
                {activeOrganizationPlanCode === null
                  ? pickUiText(uiLanguage, 'No paid plan', '\u6709\u6599\u30d7\u30e9\u30f3\u672a\u5951\u7d04')
                  : formatPlanLabel(uiLanguage, activeOrganizationPlanCode)}
              </strong>
            </div>
            <div className="billing-current-plan">
              <span>{pickUiText(uiLanguage, 'Subscription status', '\u30b5\u30d6\u30b9\u30af\u72b6\u614b')}</span>
              <strong>
                {activeOrganizationSubscription === null
                  ? pickUiText(uiLanguage, 'Not started', '\u672a\u958b\u59cb')
                  : translateUiString(uiLanguage, activeOrganizationSubscription.status)}
              </strong>
            </div>
            <div className="billing-current-plan">
              <span>{pickUiText(uiLanguage, 'Next billing date', '\u6b21\u56de\u8acb\u6c42\u65e5')}</span>
              <strong>
                {activeOrganizationSubscription?.current_period_end === null ||
                activeOrganizationSubscription?.current_period_end === undefined
                  ? '-'
                  : formatIsoDateTime(uiLanguage, activeOrganizationSubscription.current_period_end)}
              </strong>
            </div>
            {activeOrganizationSubscription?.cancel_at_period_end === true ? (
              <div className="billing-note">
                {pickUiText(
                  uiLanguage,
                  'This subscription is scheduled to end at the current period end.',
                  '\u3053\u306e\u30b5\u30d6\u30b9\u30af\u306f\u73fe\u5728\u306e\u671f\u9593\u7d42\u4e86\u65e5\u306b\u505c\u6b62\u4e88\u5b9a\u3067\u3059\u3002',
                )}
              </div>
            ) : null}
            {organizationBillingQuery.isLoading ? (
              <div className="billing-loading">
                <LoaderCircle className="spin" size={16} />
                <span>{pickUiText(uiLanguage, 'Loading organization plans', '\u6cd5\u4eba\u30d7\u30e9\u30f3\u3092\u8aad\u307f\u8fbc\u307f\u4e2d')}</span>
              </div>
            ) : null}
            {organizationBillingQuery.isError ? (
              <div className="billing-note">
                {pickUiText(
                  uiLanguage,
                  'Organization billing plans could not be loaded. Please reload and try again.',
                  '\u6cd5\u4eba\u30d7\u30e9\u30f3\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u518d\u8aad\u307f\u8fbc\u307f\u5f8c\u306b\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
                )}
              </div>
            ) : null}
            {organizationSubscriptionPlans.map((plan) => {
              const isCurrent = activeOrganizationPlanCode === plan.plan_code;
              const canSelectPlan = canSelectOrganizationSubscriptionPlan(plan);
              const detailParts = [
                pickUiText(
                  uiLanguage,
                  `${plan.monthly_credits} shared credits / month`,
                  `\u6708${plan.monthly_credits}\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8`,
                ),
              ];
              if (plan.minimum_contract_months > 1) {
                detailParts.push(
                  pickUiText(
                    uiLanguage,
                    `${plan.minimum_contract_months} month minimum`,
                    `\u6700\u4f4e${plan.minimum_contract_months}\u304b\u6708`,
                  ),
                );
              }
              const statusLabel = !plan.configured
                ? pickUiText(uiLanguage, 'Setup required', '\u7ba1\u7406\u8005\u8a2d\u5b9a\u5f85\u3061')
                : isCurrent
                  ? pickUiText(uiLanguage, 'Current', '\u73fe\u5728')
                  : formatJpy(plan.amount_jpy);

              return (
                <button
                  className={`billing-option primary-billing-option ${isCurrent ? 'current' : ''}`}
                  disabled={!canSelectPlan}
                  key={plan.plan_code}
                  onClick={() =>
                    void runExternalRedirectAction('Checkout organization subscription', async () => {
                      const organizationId = activeOrganizationId ?? '';
                      const result = await api.createOrganizationSubscriptionCheckout(organizationId, plan.plan_code);
                      redirectToBillingUrl(
                        result.url,
                        createBillingReturnMarker('subscription', balanceQuery.data, {
                          planCode: plan.plan_code,
                          organizationId,
                          initialOrganizationPlanCode: activeOrganizationPlanCode ?? undefined,
                          initialOrganizationTotalCredits: activeOrganizationBalance?.total_credits ?? undefined,
                          initialOrganizationPurchasedCredits: activeOrganizationBalance?.purchased_credits ?? undefined,
                        }),
                      );
                    })
                  }
                  type="button"
                >
                  <span>
                    <strong>{pickUiText(uiLanguage, plan.display_name_en, plan.display_name_ja)}</strong>
                    <small>{detailParts.join(' / ')}</small>
                  </span>
                  <span className="billing-price">{statusLabel}</span>
                </button>
              );
            })}
            <div className="billing-note">
              {pickUiText(
                uiLanguage,
                'Paid plan changes, cancellation, and invoice details are managed from "Manage organization billing". Monthly plan credits reset to the plan allowance and do not roll over. Purchased credits roll over.',
                '有料プランの変更・解約・請求詳細は「法人請求を管理」で行ってください。毎月のプラン分クレジットは規定値に更新され、未使用分は繰り越されません。追加購入クレジットは繰り越されます。',
              )}
            </div>
            <div className="billing-pack-grid organization-credit-packs">
              {creditPurchaseOptions.map((pack) => (
                <button
                  className="billing-option"
                  disabled={!canManageActiveOrganizationBilling || organizationBillingBusy}
                  key={pack.code}
                  onClick={() =>
                    void runExternalRedirectAction('Checkout organization credits', async () => {
                      const organizationId = activeOrganizationId ?? '';
                      const result = await api.createOrganizationCreditCheckout(organizationId, pack.code);
                      redirectToBillingUrl(
                        result.url,
                        createBillingReturnMarker('credits', balanceQuery.data, {
                          packageCode: pack.code,
                          organizationId,
                          initialOrganizationPlanCode: activeOrganizationPlanCode ?? undefined,
                          initialOrganizationTotalCredits: activeOrganizationBalance?.total_credits ?? undefined,
                          initialOrganizationPurchasedCredits: activeOrganizationBalance?.purchased_credits ?? undefined,
                        }),
                      );
                    })
                  }
                  type="button"
                >
                  <span>
                    <strong>{pickUiText(uiLanguage, `${pack.credits} shared credits`, `${pack.credits}\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8`)}</strong>
                    <small>{pickUiText(uiLanguage, 'one-time add-on', '\u8ffd\u52a0\u8cfc\u5165')}</small>
                  </span>
                  <span className="billing-price">{formatJpy(pack.priceJpy)}</span>
                </button>
              ))}
            </div>
            <button
              className="ghost-button billing-portal-button"
              disabled={!canManageActiveOrganizationBilling || organizationBillingBusy}
              onClick={() =>
                void runExternalRedirectAction('Open organization portal', async () => {
                  const organizationId = activeOrganizationId ?? '';
                  const result = await api.createOrganizationCustomerPortal(organizationId);
                  redirectToBillingUrl(
                    result.url,
                    createBillingReturnMarker('portal', balanceQuery.data, {
                      organizationId,
                      initialOrganizationPlanCode: activeOrganizationPlanCode ?? undefined,
                      initialOrganizationTotalCredits: activeOrganizationBalance?.total_credits ?? undefined,
                      initialOrganizationPurchasedCredits: activeOrganizationBalance?.purchased_credits ?? undefined,
                    }),
                  );
                })
              }
              type="button"
            >
              <CreditCard size={16} />
              <span>{pickUiText(uiLanguage, 'Manage organization billing', '\u6cd5\u4eba\u8acb\u6c42\u3092\u7ba1\u7406')}</span>
            </button>
          </OrganizationDetailPanel>
          ) : (
            <div className="billing-note">
              {pickUiText(
                uiLanguage,
                'Billing details are shown only to owners and billing members.',
                '請求情報はオーナーと請求担当にのみ表示されます。',
              )}
            </div>
          )}

          {canViewActiveOrganizationUsage ? (
            <OrganizationDetailPanel
              className="organization-admin-panel"
              collapsed={isOrganizationPanelCollapsed('usage')}
              meta={
                organizationUsageQuery.isFetching
                  ? pickUiText(uiLanguage, 'Refreshing', '更新中')
                  : pickUiText(uiLanguage, 'Current month', '今月')
              }
              onToggle={() => toggleOrganizationPanel('usage')}
              title={pickUiText(uiLanguage, 'Usage summary', '利用状況')}
            >
              <div className="billing-block-header">
                <strong>{pickUiText(uiLanguage, 'Usage summary', '利用状況')}</strong>
                <div className="billing-block-actions">
                  <span>{organizationUsageQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : pickUiText(uiLanguage, 'Current month', '今月')}</span>
                  <button
                    className="ghost-button compact"
                    disabled={busyAction === 'Download organization usage CSV' || activeOrganizationId === null}
                    onClick={() =>
                      void runAction('Download organization usage CSV', async () => {
                        const response = await api.downloadOrganizationUsageCsv(activeOrganizationId ?? '');
                        const date = new Date().toISOString().slice(0, 10);
                        triggerBlobDownload(response.blob, `lyra-organization-usage-${date}.csv`);
                      })
                    }
                    type="button"
                  >
                    <Download size={14} />
                    <span>{pickUiText(uiLanguage, 'CSV', 'CSV保存')}</span>
                  </button>
                </div>
              </div>
              {organizationUsageSummary === null ? (
                <div className="muted small">{pickUiText(uiLanguage, 'No usage data yet.', 'まだ利用データはありません。')}</div>
              ) : (
                <>
                  <div className="metric-grid organization-metrics">
                    <Metric
                      label={pickUiText(uiLanguage, 'Credits used', '使用クレジット')}
                      value={String(organizationUsageSummary.current_month_total_credits)}
                    />
                    <Metric
                      label={pickUiText(uiLanguage, 'Members used', '利用メンバー')}
                      value={String(organizationUsageSummary.by_member.length)}
                    />
                    <Metric
                      label={pickUiText(uiLanguage, 'Works used', '作品数')}
                      value={String(organizationUsageSummary.by_work.length)}
                    />
                  </div>
                  <div className="organization-compact-list">
                    {organizationUsageSummary.by_generation_type.slice(0, 4).map((item) => (
                      <div className="organization-compact-row" key={item.key}>
                        <span>{translateUiString(uiLanguage, item.key)}</span>
                        <strong>{item.credits}</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </OrganizationDetailPanel>
          ) : null}

          {canViewActiveOrganizationBilling ? (
            <OrganizationDetailPanel
              className="organization-admin-panel"
              collapsed={isOrganizationPanelCollapsed('invoices')}
              meta={organizationInvoicesQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : String(organizationInvoices.length)}
              onToggle={() => toggleOrganizationPanel('invoices')}
              title={pickUiText(uiLanguage, 'Recent invoices', '請求履歴')}
            >
              <div className="billing-block-header">
                <strong>{pickUiText(uiLanguage, 'Recent invoices', '請求履歴')}</strong>
                <span>{organizationInvoicesQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : String(organizationInvoices.length)}</span>
              </div>
              <div className="organization-compact-list">
                {organizationInvoices.slice(0, 5).map((invoice) => (
                  <div className="organization-compact-row" key={invoice.id}>
                    <span>
                      {formatInvoiceKind(uiLanguage, invoice)} / {formatIsoDateTime(uiLanguage, invoice.created_at)}
                    </span>
                    <strong>
                      {formatJpy(invoice.amount_jpy)} / {translateUiString(uiLanguage, invoice.status)}
                    </strong>
                    {invoice.invoice_url === null ? null : (
                      <a href={invoice.invoice_url} rel="noreferrer" target="_blank">
                        {pickUiText(uiLanguage, 'Invoice', '\u8acb\u6c42\u66f8')}
                      </a>
                    )}
                  </div>
                ))}
                {organizationInvoices.length === 0 ? (
                  <div className="muted small">{pickUiText(uiLanguage, 'No invoice records yet.', 'まだ請求履歴はありません。')}</div>
                ) : null}
              </div>
            </OrganizationDetailPanel>
          ) : null}

          {canViewActiveOrganizationAudit ? (
            <OrganizationDetailPanel
              className="organization-admin-panel"
              collapsed={isOrganizationPanelCollapsed('audit')}
              meta={organizationAuditLogsQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : String(organizationAuditLogs.length)}
              onToggle={() => toggleOrganizationPanel('audit')}
              title={pickUiText(uiLanguage, 'Audit log', '監査ログ')}
            >
              <div className="billing-block-header">
                <strong>{pickUiText(uiLanguage, 'Audit log', '監査ログ')}</strong>
                <span>{organizationAuditLogsQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : String(organizationAuditLogs.length)}</span>
              </div>
              <div className="organization-compact-list">
                {organizationAuditLogs.slice(0, 8).map((log) => (
                  <div className="organization-compact-row" key={log.id}>
                    <span>{formatAuditAction(uiLanguage, log)}</span>
                    <strong>{formatIsoDateTime(uiLanguage, log.created_at)}</strong>
                  </div>
                ))}
                {organizationAuditLogs.length === 0 ? (
                  <div className="muted small">{pickUiText(uiLanguage, 'No audit events yet.', 'まだ監査イベントはありません。')}</div>
                ) : null}
              </div>
            </OrganizationDetailPanel>
          ) : null}

          {canManageActiveOrganizationMembers ? (
            <OrganizationDetailPanel
              className="organization-members"
              collapsed={isOrganizationPanelCollapsed('members')}
              meta={organizationMembersQuery.isFetching ? pickUiText(uiLanguage, 'Refreshing', '更新中') : `${organizationMembers.length}`}
              onToggle={() => toggleOrganizationPanel('members')}
              title={pickUiText(uiLanguage, 'Members', '\u30e1\u30f3\u30d0\u30fc')}
            >
              <div className="billing-block-header">
                <strong>{pickUiText(uiLanguage, 'Members', '\u30e1\u30f3\u30d0\u30fc')}</strong>
                <span>
                  {organizationMembersQuery.isFetching
                    ? pickUiText(uiLanguage, 'Refreshing', '更新中')
                    : `${organizationMembers.length}`}
                </span>
              </div>
              <div className="organization-member-list">
                {organizationMembers.map((member) => (
                  <div className="organization-member-row" key={member.id}>
                    <div>
                      <strong>{member.email}</strong>
                      <span>
                        {formatOrganizationRoleLabel(uiLanguage, member.role)} / {formatOrganizationMemberStatusLabel(uiLanguage, member.status)}
                      </span>
                    </div>
                    <div className="organization-member-actions">
                      <select
                        aria-label={pickUiText(uiLanguage, 'Member role', '\u30e1\u30f3\u30d0\u30fc\u6a29\u9650')}
                        disabled={busyAction === 'Update organization member'}
                        value={member.role}
                        onChange={(event) => {
                          const nextRole = event.target.value as OrganizationMemberRecord['role'];
                          void runAction('Update organization member', async () => {
                            await api.updateOrganizationMember(activeOrganizationId ?? '', member.id, { role: nextRole });
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-members', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-audit-logs', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
                          });
                        }}
                      >
                        {organizationRoleOptions.map((role) => (
                          <option key={role.value} value={role.value}>
                            {pickUiText(uiLanguage, role.label.en, role.label.ja)}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={pickUiText(uiLanguage, 'Member status', '\u30e1\u30f3\u30d0\u30fc\u72b6\u614b')}
                        disabled={busyAction === 'Update organization member' || member.status === 'removed' || member.status === 'invited'}
                        value={member.status === 'suspended' ? 'suspended' : 'active'}
                        onChange={(event) => {
                          const nextStatus = event.target.value as Extract<OrganizationMemberRecord['status'], 'active' | 'suspended'>;
                          void runAction('Update organization member', async () => {
                            await api.updateOrganizationMember(activeOrganizationId ?? '', member.id, { status: nextStatus });
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-members', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-audit-logs', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
                          });
                        }}
                      >
                        {organizationMemberStatusOptions.map((status) => (
                          <option key={status.value} value={status.value}>
                            {pickUiText(uiLanguage, status.label.en, status.label.ja)}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button danger"
                        disabled={busyAction === 'Remove organization member'}
                        onClick={() => {
                          if (
                            !window.confirm(
                              pickUiText(
                                uiLanguage,
                                'Remove this member from the workspace?',
                                '\u3053\u306e\u30e1\u30f3\u30d0\u30fc\u3092\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u304b\u3089\u5916\u3057\u307e\u3059\u304b\uff1f',
                              ),
                            )
                          ) {
                            return;
                          }
                          void runAction('Remove organization member', async () => {
                            await api.removeOrganizationMember(activeOrganizationId ?? '', member.id);
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-members', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-audit-logs', activeOrganizationId ?? '']),
                            });
                            await queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
                          });
                        }}
                        title={pickUiText(uiLanguage, 'Remove member', '\u30e1\u30f3\u30d0\u30fc\u3092\u524a\u9664')}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {organizationMembers.length === 0 ? (
                  <div className="muted small">
                    {pickUiText(uiLanguage, 'No members loaded.', '\u30e1\u30f3\u30d0\u30fc\u3092\u8aad\u307f\u8fbc\u3093\u3067\u3044\u307e\u305b\u3093\u3002')}
                  </div>
                ) : null}
              </div>
            </OrganizationDetailPanel>
          ) : null}

          {canManageActiveOrganizationMembers ? (
            <OrganizationDetailPanel
              className="organization-admin-panel"
              collapsed={isOrganizationPanelCollapsed('invitations')}
              meta={
                organizationInvitationsQuery.isFetching
                  ? pickUiText(uiLanguage, 'Refreshing', '更新中')
                  : `${organizationInvitations.length}`
              }
              onToggle={() => toggleOrganizationPanel('invitations')}
              title={pickUiText(uiLanguage, 'Invitations', '招待')}
            >
              <div className="billing-block-header">
                <strong>{pickUiText(uiLanguage, 'Invitations', '招待')}</strong>
                <span>
                  {organizationInvitationsQuery.isFetching
                    ? pickUiText(uiLanguage, 'Refreshing', '更新中')
                    : `${organizationInvitations.length}`}
                </span>
              </div>
              <div className="organization-compact-list">
                {organizationInvitations.map((invitation) => (
                  <div className="organization-invitation-row" key={invitation.id}>
                    <div className="organization-invitation-main">
                      <strong>{invitation.email}</strong>
                      <span>
                        {formatOrganizationRoleLabel(uiLanguage, invitation.role)} / {translateUiString(uiLanguage, invitation.status)} /{' '}
                        {formatInvitationSendStatus(uiLanguage, invitation.send_status)}
                      </span>
                      {invitation.send_error_message === null ? null : (
                        <span className="error-text small">{formatInvitationSendError(uiLanguage, invitation.send_error_message)}</span>
                      )}
                    </div>
                    <div className="organization-invitation-meta">
                      <span>{formatIsoDateTime(uiLanguage, invitation.expires_at)}</span>
                      <span>
                        {pickUiText(uiLanguage, 'Resent', '再送')} {invitation.resend_count}
                      </span>
                    </div>
                    <div className="organization-invitation-actions">
                      <button
                        className="ghost-button compact"
                        disabled={busyAction === 'Resend organization invitation' || invitation.status !== 'pending'}
                        onClick={() => {
                          void runAction('Resend organization invitation', async () => {
                            const response = await api.resendOrganizationInvitation(activeOrganizationId ?? '', invitation.id);
                            setOrganizationInvitationShareUrl(response.invitation_url);
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-invitations', activeOrganizationId ?? '']),
                            });
                            return formatInvitationDeliveryNotice(uiLanguage, response.email_delivery.status);
                          });
                        }}
                        type="button"
                      >
                        <RefreshCw size={14} />
                        {pickUiText(uiLanguage, 'Resend', '再送')}
                      </button>
                      <button
                        className="ghost-button danger compact"
                        disabled={busyAction === 'Revoke organization invitation' || invitation.status !== 'pending'}
                        onClick={() => {
                          if (
                            !window.confirm(
                              pickUiText(
                                uiLanguage,
                                'Revoke this invitation?',
                                'この招待を取り消しますか？',
                              ),
                            )
                          ) {
                            return;
                          }
                          void runAction('Revoke organization invitation', async () => {
                            await api.revokeOrganizationInvitation(activeOrganizationId ?? '', invitation.id);
                            await queryClient.invalidateQueries({
                              queryKey: sessionQueryKey(['organization-invitations', activeOrganizationId ?? '']),
                            });
                          });
                        }}
                        type="button"
                      >
                        <Trash2 size={14} />
                        {pickUiText(uiLanguage, 'Revoke', '取消')}
                      </button>
                    </div>
                  </div>
                ))}
                {organizationInvitations.length === 0 ? (
                  <div className="muted small">{pickUiText(uiLanguage, 'No pending invitations.', '保留中の招待はありません。')}</div>
                ) : null}
              </div>
            </OrganizationDetailPanel>
          ) : null}

          {canManageActiveOrganizationMembers ? (
            <form
              className="organization-invite-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runAction('Invite organization member', async () => {
                  const response = await api.inviteOrganizationMember(activeOrganizationId ?? '', {
                    email: organizationInviteDraft.email.trim(),
                    role: organizationInviteDraft.role,
                  });
                  setOrganizationInvitationShareUrl(response.invitation_url);
                  setOrganizationInviteDraft({ email: '', role: 'editor' });
                  await queryClient.invalidateQueries({
                    queryKey: sessionQueryKey(['organization-members', activeOrganizationId ?? '']),
                  });
                  await queryClient.invalidateQueries({
                    queryKey: sessionQueryKey(['organization-invitations', activeOrganizationId ?? '']),
                  });
                  return formatInvitationDeliveryNotice(uiLanguage, response.email_delivery.status);
                });
              }}
            >
              <div className="form-grid two">
                <InputField
                  label={pickUiText(uiLanguage, 'Invite email', '\u62db\u5f85\u30e1\u30fc\u30eb')}
                  value={organizationInviteDraft.email}
                  onChange={(value) => setOrganizationInviteDraft((current) => ({ ...current, email: value }))}
                />
                <label className="field">
                  <span>{pickUiText(uiLanguage, 'Role', '\u6a29\u9650')}</span>
                  <select
                    value={organizationInviteDraft.role}
                    onChange={(event) =>
                      setOrganizationInviteDraft((current) => ({
                        ...current,
                        role: event.target.value as OrganizationMemberRecord['role'],
                      }))
                    }
                  >
                    {organizationRoleOptions
                      .filter((role) => role.value !== 'owner' || activeOrganizationRole === 'owner')
                      .map((role) => (
                        <option key={role.value} value={role.value}>
                          {pickUiText(uiLanguage, role.label.en, role.label.ja)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <button className="ghost-button" disabled={busyAction === 'Invite organization member'} type="submit">
                <Users size={16} />
                {pickUiText(uiLanguage, 'Invite member', '\u30e1\u30f3\u30d0\u30fc\u3092\u62db\u5f85')}
              </button>
              {organizationInvitationShareUrl.length > 0 ? (
                <div className="organization-invitation-token">
                  <span>{pickUiText(uiLanguage, 'Invitation link', '招待リンク')}</span>
                  <code>{organizationInvitationShareUrl}</code>
                  <div className="organization-invitation-actions">
                    <button
                      className="ghost-button compact"
                      onClick={() => {
                        if (navigator.clipboard === undefined) {
                          setNotice({
                            type: 'error',
                            message: pickUiText(uiLanguage, 'Clipboard is not available in this browser.', 'このブラウザではクリップボードを使えません。'),
                          });
                          return;
                        }
                        void navigator.clipboard.writeText(organizationInvitationShareUrl).then(
                          () =>
                            setNotice({
                              type: 'success',
                              message: pickUiText(uiLanguage, 'Invitation link copied.', '招待リンクをコピーしました。'),
                            }),
                          () =>
                            setNotice({
                              type: 'error',
                              message: pickUiText(uiLanguage, 'Could not copy the link.', 'リンクをコピーできませんでした。'),
                            }),
                        );
                      }}
                      type="button"
                    >
                      {pickUiText(uiLanguage, 'Copy link', 'リンクをコピー')}
                    </button>
                    <button className="ghost-button compact" onClick={() => setOrganizationInvitationShareUrl('')} type="button">
                      {pickUiText(uiLanguage, 'Dismiss', '\u9589\u3058\u308b')}
                    </button>
                  </div>
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
      ) : (
        <form
          className="organization-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction('Create organization', async () => {
              const createdWorkspace = await api.createOrganization({
                name: organizationDraft.name.trim(),
                legal_name: organizationDraft.legal_name.trim().length > 0 ? organizationDraft.legal_name.trim() : null,
                billing_email:
                  organizationDraft.billing_email.trim().length > 0 ? organizationDraft.billing_email.trim() : props.email,
              });
              setSelectedOrganizationId(createdWorkspace.organization.id);
              setOrganizationDraft({
                name: '',
                legal_name: '',
                billing_email: props.email,
              });
              await queryClient.invalidateQueries({ queryKey: sessionQueryKey(['organizations']) });
            });
          }}
        >
          <div className="billing-block-header">
            <strong>{pickUiText(uiLanguage, 'Create organization', '\u6cd5\u4eba\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u4f5c\u6210')}</strong>
            <span>{pickUiText(uiLanguage, 'Owner role is assigned to you.', '\u4f5c\u6210\u8005\u304c\u30aa\u30fc\u30ca\u30fc\u306b\u306a\u308a\u307e\u3059')}</span>
          </div>
          <div className="form-grid two">
            <InputField
              label={pickUiText(uiLanguage, 'Organization name', '\u6cd5\u4eba\u540d')}
              value={organizationDraft.name}
              onChange={(value) => setOrganizationDraft((current) => ({ ...current, name: value }))}
            />
            <InputField
              label={pickUiText(uiLanguage, 'Billing email', '\u8acb\u6c42\u30e1\u30fc\u30eb')}
              value={organizationDraft.billing_email}
              onChange={(value) => setOrganizationDraft((current) => ({ ...current, billing_email: value }))}
            />
            <InputField
              label={pickUiText(uiLanguage, 'Legal name', '\u6b63\u5f0f\u540d\u79f0')}
              value={organizationDraft.legal_name}
              onChange={(value) => setOrganizationDraft((current) => ({ ...current, legal_name: value }))}
            />
          </div>
          <button className="primary-button" disabled={busyAction === 'Create organization'} type="submit">
            {busyAction === 'Create organization' ? <LoaderCircle className="spin" size={16} /> : <Building2 size={16} />}
            {pickUiText(uiLanguage, 'Create organization', '\u6cd5\u4eba\u3092\u4f5c\u6210')}
          </button>
        </form>
      )}
        </>
      ) : (
        <div className="organization-coming-soon">
          <div className="organization-coming-soon-header">
            <BriefcaseBusiness size={18} />
            <strong>
              {pickUiText(
                uiLanguage,
                'Organization features are coming soon',
                '\u6cd5\u4eba\u6a5f\u80fd\u306f\u8fd1\u65e5\u8ffd\u52a0\u4e88\u5b9a\u3067\u3059',
              )}
            </strong>
          </div>
          <p>
            {pickUiText(
              uiLanguage,
              'For this release, please create works in your personal workspace. Organization workspaces, shared credits, invitations, and enterprise billing will be enabled after SES approval is complete.',
              '\u3053\u306e\u30ea\u30ea\u30fc\u30b9\u3067\u306f\u500b\u4eba\u306e\u4f5c\u696d\u5834\u6240\u3067\u4f5c\u54c1\u3092\u4f5c\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002SES\u627f\u8a8d\u5f8c\u306b\u3001\u6cd5\u4eba\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3001\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8\u3001\u62db\u5f85\u3001\u6cd5\u4eba\u8acb\u6c42\u3092\u6709\u52b9\u5316\u3057\u307e\u3059\u3002',
            )}
          </p>
        </div>
      )}
    </PanelSection>
  );

  const createWorkPanel = !canCreateActiveOrganizationWorks ? (
    <PanelSection
      title="New work"
      subtitle="Create a work before writing story content."
      className="story-create-work-panel"
      compact={selectedWork !== null}
      collapsible={selectedWork !== null}
    >
      <div className="inline-warning">
        {pickUiText(
          uiLanguage,
          'This workspace role cannot create works. Ask the workspace owner or an admin to change your role.',
          '\u3053\u306e\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3067\u306f\u4f5c\u54c1\u3092\u4f5c\u6210\u3067\u304d\u307e\u305b\u3093\u3002\u30aa\u30fc\u30ca\u30fc\u307e\u305f\u306f\u7ba1\u7406\u8005\u306b\u6a29\u9650\u5909\u66f4\u3092\u4f9d\u983c\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
        )}
      </div>
    </PanelSection>
  ) : (
    <PanelSection
      title="New work"
      subtitle="Create a work before writing story content."
      className="story-create-work-panel"
      compact={selectedWork !== null}
      collapsible={selectedWork !== null}
    >
      <form
        className="story-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runAction('Create work', async () => {
            const createdWork = await api.createWork(toCreateWorkPayload(newWorkDraft), activeOrganizationId);
            setNewWorkDraft(createEmptyWorkDraft());
            setSelectedWorkId(createdWork.id);
            setActiveTab('story');
            await invalidateScopedQuery(['works']);
          });
        }}
      >
        <div className="form-grid two">
          <InputField
            label="Title"
            value={newWorkDraft.title}
            onChange={(value) => setNewWorkDraft({ ...newWorkDraft, title: value })}
          />
          <InputField
            label="Genre"
            value={newWorkDraft.genre}
            onChange={(value) => setNewWorkDraft({ ...newWorkDraft, genre: value })}
          />
        </div>
        <button className="primary-button" disabled={busyAction === 'Create work'} type="submit">
          {busyAction === 'Create work' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
          {translateUiString(uiLanguage, 'Create')}
        </button>
      </form>
    </PanelSection>
  );

  const personalBillingPanel =
    activeOrganizationId === null ? (
      <BillingPanel
        balance={balanceQuery.data}
        balanceRefreshing={balanceQuery.isFetching}
        billingReturnChecking={billingReturnChecking}
        busyAction={busyAction}
        onOpenPortal={() =>
          void runExternalRedirectAction('Open portal', async () => {
            const result = await api.createCustomerPortal();
            redirectToBillingUrl(result.url, createBillingReturnMarker('portal', balanceQuery.data));
          })
        }
        onPurchaseCredits={(packageCode) =>
          void runExternalRedirectAction('Checkout credits', async () => {
            const result = await api.createCreditCheckout(packageCode);
            redirectToBillingUrl(result.url, createBillingReturnMarker('credits', balanceQuery.data, { packageCode }));
          })
        }
        onStartSubscription={(planCode) =>
          void runExternalRedirectAction('Checkout subscription', async () => {
            const result = await api.createSubscriptionCheckout(planCode);
            redirectToBillingUrl(result.url, createBillingReturnMarker('subscription', balanceQuery.data, { planCode }));
          })
        }
      />
    ) : null;

  const organizationCreditSummaryPanel =
    activeOrganizationWorkspace !== null ? (
      <PanelSection
        title={pickUiText(uiLanguage, 'Credits', '\u30af\u30ec\u30b8\u30c3\u30c8')}
        subtitle={pickUiText(uiLanguage, 'Workspace shared balance', '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u5171\u6709\u6b8b\u9ad8')}
        className="organization-credit-summary-panel"
        compact
        collapsible
      >
        <div className="metric-grid organization-metrics">
          <Metric
            label={pickUiText(uiLanguage, 'Shared credits', '\u5171\u6709\u30af\u30ec\u30b8\u30c3\u30c8')}
            value={String(activeOrganizationBalance?.total_credits ?? 0)}
          />
          <Metric
            label={pickUiText(uiLanguage, 'Monthly', '\u6708\u984d\u5206')}
            value={String(activeOrganizationBalance?.monthly_credits ?? 0)}
          />
          <Metric
            label={pickUiText(uiLanguage, 'Purchased', '\u8ffd\u52a0\u5206')}
            value={String(activeOrganizationBalance?.purchased_credits ?? 0)}
          />
        </div>
        <div className="muted small">
          {pickUiText(
            uiLanguage,
            'Plan, billing, members, invitations, and audit logs are managed from Workspace.',
            '\u30d7\u30e9\u30f3\u3001\u8acb\u6c42\u3001\u30e1\u30f3\u30d0\u30fc\u3001\u62db\u5f85\u3001\u76e3\u67fb\u30ed\u30b0\u306f\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u304b\u3089\u7ba1\u7406\u3057\u307e\u3059\u3002',
          )}
        </div>
      </PanelSection>
    ) : null;

  const jobsPanel = (
    <PanelSection title="Jobs" compact collapsible>
      <div className="stack gap-xs">
        {jobs.map((job) => {
          const progressText = getJobProgressText(job, uiLanguage);
          const progressBarState = getJobProgressBarState(job);
          const jobErrorText = getJobFailureText(job, uiLanguage);
          return (
            <div key={job.id} className="job-row">
              <div>
                <strong>{translateUiString(uiLanguage, job.job_type)}</strong>
                <div className="muted small">#{formatShortId(job.id)}</div>
                {progressText !== null ? (
                  <div className="muted small">{progressText}</div>
                ) : null}
                {progressBarState !== null ? (
                  <ProgressBar compact percent={progressBarState.percent} tone={progressBarState.tone} />
                ) : null}
                {jobErrorText !== null ? (
                  <div className="error-text small">{jobErrorText}</div>
                ) : null}
              </div>
              <StatusBadge value={job.status} />
            </div>
          );
        })}
        {jobs.length === 0 ? (
          <div className="muted small">{translateUiString(uiLanguage, 'No recent jobs.')}</div>
        ) : null}
      </div>
    </PanelSection>
  );

  const accountPanel = (
    <>
      {workspacePanel}

      {personalBillingPanel}

      <PanelSection title="Account" className="mobile-account-controls" compact>
        <div className="mobile-account-meta">
          <span>{translateUiString(uiLanguage, 'Signed in')}</span>
          <strong>{props.email}</strong>
        </div>
        <label className="field">
          <span>{translateUiString(uiLanguage, 'Language')}</span>
          <select value={uiLanguage} onChange={(event) => setUiLanguageStored(event.target.value)}>
            <option value="ja">日本語</option>
            <option value="en">{translateUiString(uiLanguage, 'English')}</option>
          </select>
        </label>
        <button className="ghost-button mobile-account-logout" onClick={() => void props.onLogout()} type="button">
          <LogOut size={16} />
          {translateUiString(uiLanguage, 'Log out')}
        </button>
      </PanelSection>

      {jobsPanel}

    </>
  );

  const tutorialPanel = (
    <PanelSection title="Tutorial" subtitle="First run guide" className="tutorial-section" compact>
      <TutorialGuide />
    </PanelSection>
  );

  const railPanel = (
    <>
      {personalBillingPanel}
      {organizationCreditSummaryPanel}
      {jobsPanel}
      {tutorialPanel}
    </>
  );

  return (
    <UiLanguageContext.Provider value={uiLanguage}>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/logo.png" alt="Lyra" />
          <div>
            <div className="brand-title">Lyra</div>
            <div className="brand-subtitle">{translateUiString(uiLanguage, 'production console')}</div>
          </div>
        </div>
        <section className="sidebar-section sidebar-workspace-switcher">
          <div className="section-header">
              {pickUiText(uiLanguage, 'Workspace', 'ワークスペース')}
            {ORGANIZATION_FEATURES_AVAILABLE && organizationWorkspacesQuery.isFetching ? (
              <LoaderCircle className="spin muted-icon" size={13} />
            ) : null}
          </div>
          {ORGANIZATION_FEATURES_AVAILABLE ? (
            <>
          <label className="field compact-field">
            <span>{pickUiText(uiLanguage, 'Scope', '\u7bc4\u56f2')}</span>
            <select value={activeOrganizationId ?? ''} onChange={(event) => setSelectedOrganizationId(event.target.value)}>
              <option value="">{pickUiText(uiLanguage, 'Personal', '\u500b\u4eba')}</option>
              {organizationWorkspaces.map((workspace) => (
                <option key={workspace.organization.id} value={workspace.organization.id}>
                  {workspace.organization.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sidebar-workspace-summary">
            {activeOrganizationWorkspace === null ? (
              <span>{pickUiText(uiLanguage, 'Personal credits are used.', '\u500b\u4eba\u30af\u30ec\u30b8\u30c3\u30c8\u3092\u4f7f\u3044\u307e\u3059\u3002')}</span>
            ) : (
              <>
                <BriefcaseBusiness size={14} />
                <span>
                  {formatOrganizationRoleLabel(uiLanguage, activeOrganizationWorkspace.membership.role)} /{' '}
                  {activeOrganizationBalance?.total_credits ?? 0}
                  {pickUiText(uiLanguage, ' credits', '\u30af\u30ec\u30b8\u30c3\u30c8')}
                </span>
              </>
            )}
          </div>
            </>
          ) : (
            <div className="sidebar-workspace-summary organization-coming-soon-sidebar">
              <BriefcaseBusiness size={14} />
              <span>
                {pickUiText(
                  uiLanguage,
                  'Organization features are coming soon',
                  '\u6cd5\u4eba\u6a5f\u80fd\u306f\u8fd1\u65e5\u8ffd\u52a0\u4e88\u5b9a\u3067\u3059',
                )}
              </span>
            </div>
          )}
        </section>
        {canViewActiveOrganizationWorks ? (
          <section className="sidebar-section">
            <div className="section-header">
              <h2>{translateUiString(uiLanguage, 'Works')}</h2>
              <span className={`badge ${worksQuery.isFetching ? 'loading' : ''}`}>
                {worksQuery.isFetching && works.length === 0 ? <LoaderCircle className="spin" size={12} /> : works.length}
              </span>
            </div>
            <div className="stack gap-xs sidebar-work-list">
              {works.map((work) => (
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
              {showWorksLoading ? (
                <div className="sidebar-status">
                  <LoaderCircle className="spin" size={14} />
                  <span>{translateUiString(uiLanguage, 'Loading works...')}</span>
                </div>
              ) : null}
              {showWorksError ? (
                <div className="sidebar-status error">
                  <span>{worksErrorMessage ?? translateUiString(uiLanguage, 'Could not load works.')}</span>
                  {worksErrorNeedsLogin ? (
                    <button className="ghost-button" onClick={() => void props.onLogout()} type="button">
                      <LogOut size={14} />
                      {translateUiString(uiLanguage, 'Sign in again')}
                    </button>
                  ) : (
                    <button className="ghost-button" onClick={() => void worksQuery.refetch()} type="button">
                      <RefreshCw size={14} />
                      {translateUiString(uiLanguage, 'Retry')}
                    </button>
                  )}
                </div>
              ) : null}
              {showWorksEmpty ? (
                <div className="sidebar-status">
                  <span>{translateUiString(uiLanguage, 'No works yet.')}</span>
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="sidebar-section">
            <div className="section-header">
              <h2>{pickUiText(uiLanguage, 'Billing workspace', '請求ワークスペース')}</h2>
            </div>
            <div className="sidebar-status">
              <span>
                {pickUiText(
                  uiLanguage,
                  'This role can manage billing and usage only.',
                  'この権限では請求と利用状況のみ管理できます。',
                )}
              </span>
            </div>
          </section>
        )}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">{translateUiString(uiLanguage, 'Signed in')}</div>
            <strong>{props.email}</strong>
          </div>
          <div className="toolbar desktop-workspace-toolbar">
            {canViewActiveOrganizationWorks ? (
              <>
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
              </>
            ) : null}
            <button className={`tab-button ${activeTab === 'account' ? 'active' : ''}`} onClick={() => setActiveTab('account')} type="button">
              <BriefcaseBusiness size={16} />
              {pickUiText(uiLanguage, 'Workspace', 'ワークスペース')}
            </button>
            <select className="toolbar-select" value={uiLanguage} onChange={(event) => setUiLanguageStored(event.target.value)}>
            <option value="ja">日本語</option>
              <option value="en">{translateUiString(uiLanguage, 'English')}</option>
            </select>
            <button className="ghost-button" onClick={() => void props.onLogout()} type="button">
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {notice !== null ? <NoticeBanner notice={notice} /> : null}

        {!canViewActiveOrganizationWorks ? (
          <div className="workspace-grid mobile-account-workspace">
            <section className="main-column mobile-account-column">{accountPanel}</section>
          </div>
        ) : activeTab === 'account' ? (
          <div className="workspace-grid mobile-account-workspace">
            <section className="main-column mobile-account-column">{accountPanel}</section>
          </div>
        ) : activeTab === 'tutorial' ? (
          <div className="workspace-grid mobile-account-workspace">
            <section className="main-column mobile-account-column">{tutorialPanel}</section>
          </div>
        ) : selectedWork === null && activeTab === 'story' ? (
          <div className="workspace-grid">
            <section className="main-column">
              {createWorkPanel}
            </section>
          </div>
        ) : selectedWork === null ? (
          <section className="empty-state">
            <LayoutGrid size={28} />
            <h2>{translateUiString(uiLanguage, 'No work selected')}</h2>
            <p>{translateUiString(uiLanguage, 'Create or select a work from the left panel to start editing.')}</p>
          </section>
        ) : (
          <div className="workspace-grid">
            <section className="main-column">
              {activeTab === 'story' ? (
                <>
                  {createWorkPanel}

                  <PanelSection
                    title="Work overview"
                    subtitle={uiLanguage === 'ja' ? `状態 ${translateUiString(uiLanguage, selectedWork.status)}` : `status ${selectedWork.status}`}
                    className="work-overview-section"
                    compact
                    collapsible
                    defaultCollapsed
                    actions={
                      <button
                        className="secondary-button"
                        disabled={busyAction === 'Save work'}
                        onClick={() =>
                          void runAction('Save work', async () => {
                            await api.updateWork(
                              selectedWork.id,
                              toWorkPayload(workDraft, loadedSelectedWorkEntityIds),
                              activeOrganizationId,
                            );
                            await invalidateScopedQuery(['works']);
                          })
                        }
                        type="button"
                      >
                        {busyAction === 'Save work' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                        {translateUiString(uiLanguage, 'Save')}
                      </button>
                    }
                  >
                    <div className="form-grid two">
                      <InputField label="Title" value={workDraft.title} onChange={(value) => setWorkDraft({ ...workDraft, title: value })} />
                      <InputField label="Genre" value={workDraft.genre} onChange={(value) => setWorkDraft({ ...workDraft, genre: value })} />
                    </div>
                    <details className="advanced-disclosure work-context-disclosure">
                      <summary>{translateUiString(uiLanguage, 'Advanced work context')}</summary>
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
                      <InputField label="Theme" value={workDraft.theme} onChange={(value) => setWorkDraft({ ...workDraft, theme: value })} />
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
                    </details>
                  </PanelSection>

                  <PanelSection
                    title="Chapter / Episode"
                    collapsible
                    actions={
                      <div className="toolbar">
                        <button
                          className="primary-button skeleton-plan-button"
                          disabled={skeletonActionDisabled || selectedEpisodePageSkeletonJob !== null}
                          onClick={() => {
                            if (selectedEpisode === null) {
                              return;
                            }
                            const overwriteExisting = episodeHasExistingPagePlan;
                            if (
                              overwriteExisting &&
                              !window.confirm(
                                translateUiString(
                                  uiLanguage,
                                  'Regenerating the page plan will replace the current pages for this episode.',
                                ),
                              )
                            ) {
                              return;
                            }
                            void runAction('Generate page skeleton', async () => {
                              await saveCurrentEpisodeContext();
                              setSelectedPageId('');
                              setSelectedPanelId('');
                              const result = await api.generatePageSkeleton(
                                selectedEpisode.id,
                                {
                                  overwrite_existing: overwriteExisting,
                                  apply_story_plan: false,
                                  language: uiLanguage,
                                },
                                activeOrganizationId,
                              );
                              if ('job_id' in result) {
                                trackJob(result.job_id);
                              } else {
                                await invalidateScopedQuery(['episodes', selectedChapter?.id ?? '']);
                                await invalidateScopedQuery(['scenes', selectedEpisode.id]);
                                await invalidateScopedQuery(['pages', selectedEpisode.id]);
                              }
                              setActiveTab('pages');
                            });
                          }}
                          type="button"
                        >
                          {busyAction === 'Generate page skeleton' || selectedEpisodePageSkeletonJob !== null ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          {translateUiString(uiLanguage, skeletonActionLabel)}
                        </button>
                        <button
                          className="secondary-button story-plan-button"
                          disabled={
                            selectedEpisode === null ||
                            busyAction === 'Apply story plan' ||
                            selectedEpisodeStoryAutofillJob !== null ||
                            selectedEpisodePageSkeletonJob !== null
                          }
                          onClick={() => {
                            if (selectedEpisode === null) {
                              return;
                            }
                            void runAction('Apply story plan', async () => {
                              await saveCurrentEpisodeContext();
                              const result = await api.autofillEpisodePagesFromStory(
                                selectedEpisode.id,
                                uiLanguage,
                                activeOrganizationId,
                              );
                              trackJob(result.job_id);
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
                    {skeletonActionMessage !== null ? (
                      <div className="muted small">{translateUiString(uiLanguage, skeletonActionMessage)}</div>
                    ) : null}
                    {skeletonGenerationMessage !== null ? (
                      <ProcessingHint
                        message={translateUiString(uiLanguage, skeletonGenerationMessage)}
                        progressPercent={
                          selectedEpisodePageSkeletonJob === null ? null : getJobProgressPercent(selectedEpisodePageSkeletonJob)
                        }
                        showProgress
                      />
                    ) : null}
                    {storyPlanProcessingMessage !== null ? (
                      <ProcessingHint
                        message={translateUiString(uiLanguage, storyPlanProcessingMessage)}
                        progressPercent={
                          selectedEpisodeStoryAutofillJob === null ? null : getJobProgressPercent(selectedEpisodeStoryAutofillJob)
                        }
                        showProgress
                      />
                    ) : null}
                    {selectedEpisode !== null ? (
                      <div className="state-pill-row">
                        <span className="state-pill state-pill-neutral">
                          {translateUiString(uiLanguage, 'Text AI actions use no credits.')}
                        </span>
                      </div>
                    ) : null}
                    <div className="story-tree">
                      <div className="tree-column">
                        <h3>{translateUiString(uiLanguage, 'Chapters')}</h3>
                        <div className="stack gap-xs">
                          {chapters.map((chapter, chapterIndex) => (
                            <div className="tree-item-row" key={chapter.id}>
                              <button
                                className={`tree-item ${selectedChapter?.id === chapter.id ? 'active' : ''}`}
                                onClick={() => {
                                  setSelectedChapterId(chapter.id);
                                  setSelectedEpisodeId('');
                                  setSelectedWorkId(selectedWork.id);
                                }}
                                type="button"
                              >
                                <span>{chapter.order}</span>
                                <strong>{chapter.title ?? translateUiString(uiLanguage, 'Untitled chapter')}</strong>
                              </button>
                              <div className="tree-order-actions">
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move up')}
                                  className="icon-button"
                                  disabled={busyAction !== null || chapterIndex === 0}
                                  onClick={() =>
                                    void runAction(`Move chapter ${chapter.id} up`, async () => {
                                      await api.moveChapter(chapter.id, 'up', activeOrganizationId);
                                      await invalidateScopedQuery(['chapters', selectedWork.id]);
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move up')}
                                  type="button"
                                >
                                  <ChevronUp size={15} />
                                </button>
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move down')}
                                  className="icon-button"
                                  disabled={busyAction !== null || chapterIndex === chapters.length - 1}
                                  onClick={() =>
                                    void runAction(`Move chapter ${chapter.id} down`, async () => {
                                      await api.moveChapter(chapter.id, 'down', activeOrganizationId);
                                      await invalidateScopedQuery(['chapters', selectedWork.id]);
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move down')}
                                  type="button"
                                >
                                  <ChevronDown size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <form
                          className="story-create-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void runAction('Create chapter', async () => {
                              await api.createChapter(
                                selectedWork.id,
                                toCreateChapterPayload(newChapterDraft, loadedSelectedWorkEntityIds),
                                activeOrganizationId,
                              );
                              setNewChapterDraft(createEmptyChapterDraft());
                              await invalidateScopedQuery(['chapters', selectedWork.id]);
                            });
                          }}
                        >
                          <div className="story-inline-grid story-inline-grid-create">
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
                          </div>
                          <button className="ghost-button" type="submit">
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Add chapter')}
                          </button>
                        </form>
                      </div>

                      <div className="tree-column">
                        {selectedChapter !== null ? (
                          <div className="story-editor-compact">
                            <div className="story-inline-grid story-inline-grid-chapter">
                              <InputField label="Chapter title" value={chapterDraft.title} onChange={(value) => setChapterDraft({ ...chapterDraft, title: value })} />
                              <InputField label="Order" value={chapterDraft.order} onChange={(value) => setChapterDraft({ ...chapterDraft, order: value })} />
                            </div>
                            <div className="story-inline-actions">
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  void runAction('Save chapter', async () => {
                                    await api.updateChapter(
                                      selectedChapter.id,
                                      toChapterPayload(chapterDraft, loadedSelectedWorkEntityIds),
                                      activeOrganizationId,
                                    );
                                    await invalidateScopedQuery(['chapters', selectedWork.id]);
                                  })
                                }
                                type="button"
                              >
                                <Save size={16} />
                                {translateUiString(uiLanguage, 'Save chapter')}
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() =>
                                  void runAction('Delete chapter', async () => {
                                    await api.deleteChapter(selectedChapter.id, activeOrganizationId);
                                    await invalidateScopedQuery(['chapters', selectedWork.id]);
                                  })
                                }
                                type="button"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <h3>{translateUiString(uiLanguage, 'Episodes')}</h3>
                        <div className="stack gap-xs">
                          {episodes.map((episode, episodeIndex) => (
                            <div className="tree-item-row" key={episode.id}>
                              <button
                                className={`tree-item ${selectedEpisodeId === episode.id ? 'active' : ''}`}
                                onClick={() => setSelectedEpisodeId(episode.id)}
                                type="button"
                              >
                                <span>{episode.order}</span>
                                <strong>{episode.title ?? translateUiString(uiLanguage, 'Untitled episode')}</strong>
                              </button>
                              <div className="tree-order-actions">
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move up')}
                                  className="icon-button"
                                  disabled={busyAction !== null || episodeIndex === 0}
                                  onClick={() =>
                                    void runAction(`Move episode ${episode.id} up`, async () => {
                                      await api.moveEpisode(episode.id, 'up', activeOrganizationId);
                                      await invalidateScopedQuery(['episodes', selectedChapter?.id ?? '']);
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move up')}
                                  type="button"
                                >
                                  <ChevronUp size={15} />
                                </button>
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move down')}
                                  className="icon-button"
                                  disabled={busyAction !== null || episodeIndex === episodes.length - 1}
                                  onClick={() =>
                                    void runAction(`Move episode ${episode.id} down`, async () => {
                                      await api.moveEpisode(episode.id, 'down', activeOrganizationId);
                                      await invalidateScopedQuery(['episodes', selectedChapter?.id ?? '']);
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move down')}
                                  type="button"
                                >
                                  <ChevronDown size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {selectedChapter !== null ? (
                          <form
                            className="story-create-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void runAction('Create episode', async () => {
                                await api.createEpisode(
                                  selectedChapter.id,
                                  toCreateEpisodePayload(newEpisodeDraft, loadedSelectedWorkEntityIds),
                                  activeOrganizationId,
                                );
                                setNewEpisodeDraft(createEmptyEpisodeDraft());
                                await invalidateScopedQuery(['episodes', selectedChapter.id]);
                              });
                            }}
                          >
                            <div className="story-inline-grid story-inline-grid-create">
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
                            </div>
                            <button className="ghost-button" type="submit">
                              <Save size={16} />
                              {translateUiString(uiLanguage, 'Add episode')}
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
                              await api.updateEpisode(
                                selectedEpisode.id,
                                toEpisodePayload(episodeDraft, loadedSelectedWorkEntityIds),
                                activeOrganizationId,
                              );
                              await invalidateScopedQuery(['episodes', selectedChapter?.id ?? '']);
                            })
                          }
                          type="button"
                        >
                          {busyAction === 'Save episode' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                          {translateUiString(uiLanguage, 'Save')}
                        </button>
                        <button
                          className="ghost-button danger"
                          onClick={() =>
                            void runAction('Delete episode', async () => {
                              await api.deleteEpisode(selectedEpisode.id, activeOrganizationId);
                              await invalidateScopedQuery(['episodes', selectedChapter?.id ?? '']);
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
                        type="number"
                        min={1}
                        max={MAX_EPISODE_PAGES}
                      />
                    </div>
                    <TextAreaField
                      label="Whole story draft"
                      rows={10}
                      value={episodeDraft.story_full_draft}
                      onChange={(value) => setEpisodeDraft({ ...episodeDraft, story_input_mode: 'full', story_full_draft: value })}
                    />
                  </PanelSection>

                  <PanelSection
                    title="Story AI"
                    subtitle={pickUiText(
                      uiLanguage,
                      'Improve the current episode draft while keeping continuity with the rest of the work.',
                      '\u4f5c\u54c1\u5168\u4f53\u3068\u306e\u6574\u5408\u3092\u4fdd\u3061\u306a\u304c\u3089\u3001\u73fe\u5728\u306e\u8a71\u306e\u4e0b\u66f8\u304d\u3092\u6539\u5584\u3057\u307e\u3059\u3002',
                    )}
                    collapsible
                    mobileDefaultCollapsed
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
                                    ...toEpisodeBaseDraftPayload(episodeDraft),
                                  },
                                }, activeOrganizationId);
                                setStoryImprovementDraft(result.draft);
                                setStoryImprovementMeta({
                                  compiler_provider: result.compiler_provider,
                                  compiler_model: result.compiler_model,
                                  compiler_prompt_version: result.compiler_prompt_version,
                                  compiler_error: result.compiler_error,
                                });
                              } catch (error) {
                                setNotice({ type: 'error', message: toMessage(error, uiLanguage) });
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
                            setEpisodeDraft((current) =>
                              storyImprovementDraft === null
                                ? current
                                : applyStoryImprovementDraftToEpisodeDraft(current, storyImprovementDraft),
                            )
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
                          <div className="muted small">{`${translateUiString(uiLanguage, 'AI improved')} / ${storyImprovementMeta.compiler_model ?? translateUiString(uiLanguage, 'Story AI')}`}</div>
                    ) : null}
                    {episodeDraft.story_input_mode === 'full' ? (
                      <>
                        <div className="stack">
                          <TextAreaField
                            label="Improved full story"
                            rows={12}
                            value={storyImprovementDraft?.story_full_draft ?? ''}
                            onChange={(value) =>
                              setStoryImprovementDraft((current) => ({
                                ...(current ?? createEmptyStoryImprovementDraft('full')),
                                story_input_mode: 'full',
                                story_full_draft: value,
                                introduction: null,
                                middle: null,
                                climax: null,
                                ending_hook: null,
                              }))
                            }
                          />
                          <button
                            className="secondary-button"
                            onClick={() =>
                              setEpisodeDraft((current) => ({
                                ...current,
                                story_input_mode: 'full',
                                story_full_draft: storyImprovementDraft?.story_full_draft ?? current.story_full_draft,
                                introduction: '',
                                middle: '',
                                climax: '',
                                ending_hook: '',
                              }))
                            }
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Apply full story')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="form-grid two">
                          <div className="stack">
                            <TextAreaField
                              label="Improved introduction"
                              rows={6}
                              value={storyImprovementDraft?.introduction ?? ''}
                              onChange={(value) =>
                                setStoryImprovementDraft((current) => ({
                                  ...(current ?? createEmptyStoryImprovementDraft('structured')),
                                  introduction: value,
                                }))
                              }
                            />
                            <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, introduction: storyImprovementDraft?.introduction ?? current.introduction }))} type="button">
                              <Save size={16} />
                              {translateUiString(uiLanguage, 'Apply introduction')}
                            </button>
                          </div>
                          <div className="stack">
                            <TextAreaField
                              label="Improved middle"
                              rows={6}
                              value={storyImprovementDraft?.middle ?? ''}
                              onChange={(value) =>
                                setStoryImprovementDraft((current) => ({
                                  ...(current ?? createEmptyStoryImprovementDraft('structured')),
                                  middle: value,
                                }))
                              }
                            />
                            <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, middle: storyImprovementDraft?.middle ?? current.middle }))} type="button">
                              <Save size={16} />
                              {translateUiString(uiLanguage, 'Apply middle')}
                            </button>
                          </div>
                        </div>
                        <div className="form-grid two">
                          <div className="stack">
                            <TextAreaField
                              label="Improved climax"
                              rows={6}
                              value={storyImprovementDraft?.climax ?? ''}
                              onChange={(value) =>
                                setStoryImprovementDraft((current) => ({
                                  ...(current ?? createEmptyStoryImprovementDraft('structured')),
                                  climax: value,
                                }))
                              }
                            />
                            <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, climax: storyImprovementDraft?.climax ?? current.climax }))} type="button">
                              <Save size={16} />
                              {translateUiString(uiLanguage, 'Apply climax')}
                            </button>
                          </div>
                          <div className="stack">
                            <TextAreaField
                              label="Improved ending hook"
                              rows={6}
                              value={storyImprovementDraft?.ending_hook ?? ''}
                              onChange={(value) =>
                                setStoryImprovementDraft((current) => ({
                                  ...(current ?? createEmptyStoryImprovementDraft('structured')),
                                  ending_hook: value,
                                }))
                              }
                            />
                            <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, ending_hook: storyImprovementDraft?.ending_hook ?? current.ending_hook }))} type="button">
                              <Save size={16} />
                              {translateUiString(uiLanguage, 'Apply ending hook')}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </PanelSection>

                  <PanelSection title="Scenes" collapsible mobileDefaultCollapsed>
                    <div className="list-grid">
                      {scenes.map((scene) => (
                        <button
                          key={scene.id}
                          className={`mini-card ${selectedScene?.id === scene.id ? 'active' : ''}`}
                          onClick={() => setSelectedSceneId(scene.id)}
                          type="button"
                        >
                          <strong>{scene.order}</strong>
                          <span>{scene.location ?? translateUiString(uiLanguage, 'No location')}</span>
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
                    <div className="toolbar">
                      <button
                        className="secondary-button"
                        onClick={() =>
                          void runAction('Create scene', async () => {
                            await api.createScene(
                              selectedEpisode.id,
                              toCreateScenePayload(sceneDraft, loadedSelectedWorkEntityIds),
                              activeOrganizationId,
                            );
                            setSceneDraft(createEmptySceneDraft());
                            await invalidateScopedQuery(['scenes', selectedEpisode.id]);
                          })
                        }
                        type="button"
                      >
                        <Save size={16} />
                            {translateUiString(uiLanguage, 'Add')}
                      </button>
                      {selectedScene !== null ? (
                        <button
                          className="ghost-button"
                          onClick={() =>
                            void runAction('Save scene', async () => {
                              await api.updateScene(
                                selectedScene.id,
                                toScenePayload(sceneDraft, loadedSelectedWorkEntityIds),
                                activeOrganizationId,
                              );
                              await invalidateScopedQuery(['scenes', selectedEpisode.id]);
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Save scene')}
                        </button>
                      ) : null}
                    </div>
                  </PanelSection>
                </>
              ) : null}

              {activeTab === 'entities' && selectedWork !== null ? (
                <>
                  <PanelSection
                    title="Current episode selection"
                    subtitle="Choose the work, chapter, and episode being edited."
                    compact
                    collapsible
                  >
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
                  </PanelSection>

                  <PanelSection
                    title="Character list"
                    subtitle={`${entities.length} records`}
                    collapsible
                    actions={
                      <button
                        className="secondary-button"
                        onClick={beginNewEntityDraft}
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
                          onClick={() => selectEntityForEditing(entity.id)}
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
                          onClick={beginNewEntityDraft}
                          type="button"
                        >
                          <RefreshCw size={16} />
                          {translateUiString(uiLanguage, 'Reset draft')}
                        </button>
                        {selectedEntity !== null ? (
                          <button
                            className="ghost-button danger"
                            onClick={() => {
                              if (!confirmUiAction('Delete this character? This cannot be undone.')) {
                                return;
                              }

                              void runAction('Delete entity', async () => {
                                await api.deleteEntity(selectedEntity.id, activeOrganizationId);
                                removeEntityFromCache(selectedWork.id, selectedEntity.id);
                                await invalidateScopedQuery(['entities', selectedWork.id]);
                              });
                            }}
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : null}
                      </div>
                    }
                  >
                    <div className="muted small">{translateUiString(uiLanguage, 'You do not need to fill every blank field.')}</div>
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
                        key={selectedEntity?.id ?? 'new-character'}
                        value={characterStructuredFields}
                        onChange={(nextValue) =>
                          setEntityDraft((current) => ({
                            ...current,
                            structured_fields: serializeCharacterStructuredFieldsDraft(nextValue),
                          }))
                        }
                      />
                    ) : (
                      <GenericStructuredFieldsEditor
                        value={entityDraft.structured_fields}
                        onChange={(value) => setEntityDraft({ ...entityDraft, structured_fields: value })}
                      />
                    )}
                    <div className="state-pill-row">
                      <span className={`state-pill ${entityEditorMode === 'create' ? 'state-pill-info' : 'state-pill-neutral'}`}>
                        {translateUiString(
                          uiLanguage,
                          entityEditorMode === 'create'
                            ? 'Creating a new character. Saving here will add a new record and will not overwrite existing characters.'
                            : 'Editing the selected character.',
                        )}
                      </span>
                    </div>
                    <div className="toolbar">
                      {entityEditorMode === 'create' || selectedEntity === null ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Create entity', async () => {
                              const createdEntity = await api.createEntity(
                                selectedWork.id,
                                toEntityPayload(entityDraft),
                                activeOrganizationId,
                              );
                              cacheEntityRecord(createdEntity);
                              setEntityEditorMode('edit');
                              setSelectedEntityId(createdEntity.id);
                              setEntityDraft(toEntityDraft(createdEntity));
                              await invalidateScopedQuery(['entities', selectedWork.id]);
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Create character')}
                        </button>
                      ) : null}
                      {entityEditorMode === 'edit' && selectedEntity !== null ? (
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Save entity', async () => {
                              const savedEntity = await api.updateEntity(
                                selectedEntity.id,
                                toEntityPayload(entityDraft),
                                activeOrganizationId,
                              );
                              cacheEntityRecord(savedEntity);
                              setEntityDraft(toEntityDraft(savedEntity));
                              await invalidateScopedQuery(['entities', selectedWork.id]);
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Save character')}
                        </button>
                      ) : null}
                    </div>
                  </PanelSection>

                  <PanelSection title="Import reference" collapsible>
                    <div className="state-pill-row">
                      <span className="state-pill state-pill-neutral">
                        {translateUiString(uiLanguage, 'Image import costs 1 credit.')}
                      </span>
                    </div>
                    <label className="file-drop">
                      <input
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          void handleEntityImport(
                            event,
                            entityDraft.entity_type,
                            selectedEntity?.id ?? null,
                            api,
                            activeOrganizationId,
                            setImportingImage,
                            setNotice,
                            setEntityDraft,
                            setUploadedReferenceCandidatesByEntityId,
                            setUploadedReferenceSourceByEntityId,
                            uiLanguage,
                          )
                        }
                        type="file"
                      />
                      <span>{importingImage ? translateUiString(uiLanguage, 'Importing image...') : translateUiString(uiLanguage, 'Drop or choose image')}</span>
                    </label>
                  </PanelSection>

                  <PanelSection title="Preview / Confirm" collapsible>
                    <div className="state-pill-row">
                      <span className="state-pill state-pill-neutral">
                        {translateUiString(uiLanguage, 'Preview generation costs 1 credit.')}
                      </span>
                    </div>
                    {selectedEntity !== null ? (
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Generate reference', async () => {
                              await saveCurrentEntityGenerationContext();
                              setGeneratedReferenceCandidatesByEntityId((current) => ({
                                ...current,
                                [selectedEntity.id]: [],
                              }));
                              setReferenceSelection([]);
                              setReferencePrimaryKey('');
                              const sourceCandidateToken = uploadedReferenceSourceByEntityId[selectedEntity.id];
                              const result = await api.generateEntityReference(
                                selectedEntity.id,
                                sourceCandidateToken === undefined ? undefined : { source_candidate_token: sourceCandidateToken },
                                activeOrganizationId,
                              );
                              trackJob(result.job_id);
                            })
                          }
                          type="button"
                        >
                          <Sparkles size={16} />
                          {translateUiString(uiLanguage, 'Generate full-body preview')}
                        </button>
                        <button
                          className="primary-button"
                          disabled={referenceSelection.length === 0 && referencePrimaryKey.length === 0}
                          onClick={() =>
                            void runAction('Confirm references', async () => {
                              const selectedReferenceKeys = Array.from(
                                new Set(
                                  referencePrimaryKey.length > 0
                                    ? [...referenceSelection, referencePrimaryKey]
                                    : referenceSelection,
                                ),
                              );
                              await api.confirmEntityReference(
                                selectedEntity.id,
                                {
                                  selected_candidate_tokens: selectedReferenceKeys,
                                  primary_candidate_token: referencePrimaryKey,
                                  prompt_supplement: entityDraft.prompt_supplement || null,
                                },
                                activeOrganizationId,
                              );
                              setUploadedReferenceCandidatesByEntityId((current) => {
                                const nextValue = { ...current };
                                delete nextValue[selectedEntity.id];
                                return nextValue;
                              });
                              await invalidateScopedQuery(['entity-reference-set', selectedEntity.id]);
                            })
                          }
                          type="button"
                        >
                          <Check size={16} />
                          {translateUiString(uiLanguage, 'Confirm')}
                        </button>
                      </div>
                    ) : null}
                    {entityPreviewGenerationMessage !== null ? (
                      <ProcessingHint
                        message={translateUiString(uiLanguage, entityPreviewGenerationMessage)}
                        queued={selectedEntityGenerationJob?.status === 'queued'}
                        progressPercent={
                          selectedEntityGenerationJob === null ? null : getJobProgressPercent(selectedEntityGenerationJob)
                        }
                        showProgress
                      />
                    ) : null}
                    <div className="reference-management-grid preview-confirm-grid">
                      <div className="stack">
                        <div className="section-header">
                          <div>
                            <h3>{translateUiString(uiLanguage, 'Generated preview')}</h3>
                            <div className="muted small">{translateUiString(uiLanguage, 'Select a preview and confirm it as the primary image.')}</div>
                          </div>
                        </div>
                        {referenceCandidates.length > 0 ? (
                          <div className="reference-grid reference-grid-portrait">
                            {referenceCandidates.map((candidate) => (
                              <div key={candidate.candidate_token} className={`reference-card reference-card-portrait ${referenceSelection.includes(candidate.candidate_token) ? 'active' : ''}`}>
                                <div className="reference-card-media">
                                  <AuthenticatedImage
                                    enabled={selectedEntity !== null}
                                    loadImage={() =>
                                      api.exportEntityReferenceCandidateImage(
                                        selectedEntity?.id ?? '',
                                        candidate.candidate_token,
                                        activeOrganizationId,
                                      )
                                    }
                                    onClick={(url) => openImageLightbox(url, translateUiString(uiLanguage, 'Generated preview'))}
                                    queryKey={scopedQueryKey(['entity-reference-candidate-image', selectedEntity?.id, candidate.candidate_token])}
                                  />
                                </div>
                                <div className="reference-card-body">
                                  <span>{translateUiString(uiLanguage, candidate.source)}</span>
                                  <div className="reference-card-choice-row">
                                    <label>
                                      <input
                                        checked={referenceSelection.includes(candidate.candidate_token)}
                                        onChange={(event) =>
                                          setReferenceSelection((current) =>
                                            event.target.checked
                                              ? current.includes(candidate.candidate_token)
                                                ? current
                                                : [...current, candidate.candidate_token]
                                              : current.filter((item) => item !== candidate.candidate_token),
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      {translateUiString(uiLanguage, 'Use reference')}
                                    </label>
                                    <label>
                                      <input
                                        checked={referencePrimaryKey === candidate.candidate_token}
                                        name="reference-primary"
                                        onChange={() => {
                                          setReferencePrimaryKey(candidate.candidate_token);
                                          setReferenceSelection((current) =>
                                            current.includes(candidate.candidate_token)
                                              ? current
                                              : [...current, candidate.candidate_token],
                                          );
                                        }}
                                        type="radio"
                                      />
                                      {translateUiString(uiLanguage, 'Primary reference')}
                                    </label>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="selection-empty">{translateUiString(uiLanguage, 'No preview yet.')}</div>
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
                                  <AuthenticatedImage
                                    enabled={selectedEntity !== null}
                                    loadImage={() =>
                                      api.exportEntityReferenceImage(
                                        selectedEntity?.id ?? '',
                                        image.ref_id,
                                        activeOrganizationId,
                                      )
                                    }
                                    onClick={(url) => openImageLightbox(url, translateUiString(uiLanguage, 'Confirmed references'))}
                                    queryKey={scopedQueryKey(['entity-reference-image', selectedEntity?.id, image.ref_id, image.created_at])}
                                  />
                                </div>
                                <div className="reference-card-body">
                                  <strong>{image.ref_id === entityReferenceSetQuery.data.primary_ref_id ? translateUiString(uiLanguage, 'Primary') : translateUiString(uiLanguage, image.source)}</strong>
                                </div>
                                <div className="reference-card-actions">
                                  <button
                                    className="ghost-button danger"
                                    onClick={() => {
                                      if (selectedEntity === null) {
                                        return;
                                      }
                                      if (!confirmUiAction('Delete this reference image? This cannot be undone.')) {
                                        return;
                                      }
                                      void runAction('Delete reference', async () => {
                                        await api.deleteEntityReference(
                                          selectedEntity.id,
                                          image.ref_id,
                                          activeOrganizationId,
                                        );
                                        await invalidateScopedQuery(['entity-reference-set', selectedEntity.id]);
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
                  <PanelSection
                    title="Current episode selection"
                    subtitle="Choose the work, chapter, and episode being edited."
                    compact
                    collapsible
                  >
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
                  </PanelSection>

                  <div className="page-sections-stack">
                  <PanelSection title="Pages" collapsible>
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
                          {page.generated_image !== null ? (
                            <AuthenticatedImage
                              loadImage={() => api.exportPageImage(page.id, activeOrganizationId)}
                              loading="lazy"
                              onDoubleClick={(url) => openImageLightbox(url, `${translateUiString(uiLanguage, 'Page')} ${page.page_number}`)}
                              placeholderClassName="page-placeholder"
                              queryKey={scopedQueryKey(['page-image', page.id, page.generated_image.generated_at])}
                            />
                          ) : (
                            <div className="page-placeholder">
                              <LayoutGrid size={18} />
                            </div>
                          )}
                          <div className="page-meta-list">
                            <span>
                              {uiLanguage === 'ja'
                                ? `枠 ${page.frame_count} / コマ ${page.panel_count}`
                                : `frames ${page.frame_count} / panels ${page.panel_count}`}
                            </span>
                            <span>{translateUiString(uiLanguage, 'Double-click image to enlarge')}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PanelSection>

                  {selectedPage !== null ? (
                    <>
                      <PanelSection title="Style constraints" className="page-section-style-constraints" compact collapsible actions={
                        <button
                          className="secondary-button"
                          onClick={() =>
                            void runAction('Save page settings', async () => {
                              await api.updatePage(
                                selectedPage.id,
                                toPageSettingsPayload(pageSettingsDraft),
                                activeOrganizationId,
                              );
                              await invalidateScopedQuery(['pages', selectedEpisode.id]);
                            })
                          }
                          type="button"
                        >
                          <Save size={16} />
                          {translateUiString(uiLanguage, 'Save')}
                        </button>
                      }>
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
                        compact
                        collapsible
                        defaultCollapsed
                        actions={
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Save story sources', async () => {
                                await api.updatePage(
                                  selectedPage.id,
                                  toPageSettingsPayload(pageSettingsDraft),
                                  activeOrganizationId,
                                );
                                await invalidateScopedQuery(['pages', selectedEpisode.id]);
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
                                {uiLanguage === 'ja' ? '\u307e\u3060\u95a2\u9023\u30b7\u30fc\u30f3\u306f\u3042\u308a\u307e\u305b\u3093\u3002' : 'No linked scenes yet'}
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
                        subtitle={
                          uiLanguage === 'ja'
                            ? `セリフ ${translateUiString(uiLanguage, selectedPage.dialogue_mode === 'image_baked' ? 'Image baked' : selectedPage.dialogue_mode === 'balloon_only' ? 'Balloon only' : 'Mixed')}`
                            : `dialogue ${selectedPage.dialogue_mode}`
                        }
                        className="page-section-generate"
                        collapsible
                        actions={
                          <div className="toolbar">
                            <button
                              className="primary-button"
                              disabled={generatePageDisabled}
                              onClick={() =>
                                void runAction('Generate page', async () => {
                                  if (selectedPageHasFramePanelMismatch) {
                                    throw new Error(translateUiString(uiLanguage, 'Frame count and panel count do not match. Adjust frames or panels before generating.'));
                                  }
                                  await saveCurrentPageGenerationContext();
                                  const result = await api.generatePage(selectedPage.id, activeOrganizationId);
                                  trackJob(result.job_id);
                                })
                              }
                              type="button"
                            >
                              <Play size={16} />
                              {translateUiString(uiLanguage, 'Generate page')}
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Confirm page', async () => {
                                  await api.confirmPage(selectedPage.id, activeOrganizationId);
                                  await invalidateScopedQuery(['pages', selectedEpisode.id]);
                                })
                              }
                              type="button"
                            >
                              <Check size={16} />
                              {translateUiString(uiLanguage, 'Confirm page')}
                            </button>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Reopen page', async () => {
                                  await api.reopenPage(selectedPage.id, activeOrganizationId);
                                  await invalidateScopedQuery(['pages', selectedEpisode.id]);
                                })
                              }
                              type="button"
                            >
                              <RefreshCw size={16} />
                              {translateUiString(uiLanguage, 'Reopen page')}
                            </button>
                          </div>
                        }
                      >
                        {pageImageGenerationMessage !== null ? (
                          <ProcessingHint
                            message={translateUiString(uiLanguage, pageImageGenerationMessage)}
                            queued={selectedPageGenerationJob?.status === 'queued'}
                            progressPercent={
                              selectedPageGenerationJob === null ? null : getJobProgressPercent(selectedPageGenerationJob)
                            }
                            showProgress
                          />
                        ) : null}
                        <div className="state-pill-row">
                          <span className="state-pill state-pill-neutral">
                            {translateUiString(uiLanguage, 'Page generation starts at 3 credits.')}
                          </span>
                        </div>
                        {selectedPageHasFramePanelMismatch ? (
                          <div className="generation-blocking-hint" role="alert">
                            <div className="generation-blocking-copy">
                              <strong>
                                {translateUiString(uiLanguage, 'Page generation is blocked until panel layout and panel content match.')}
                              </strong>
                              <span>
                                {formatFramePanelMismatchDetail(
                                  uiLanguage,
                                  selectedPageFrameCount,
                                  selectedPagePanelCount,
                                )}
                              </span>
                            </div>
                            <button
                              className="ghost-button generation-blocking-action"
                              onClick={() => {
                                document
                                  .querySelector('.page-section-frames-panels')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }}
                              type="button"
                            >
                              <LayoutGrid size={14} />
                              {translateUiString(uiLanguage, 'Go to panel layout')}
                            </button>
                          </div>
                        ) : null}
                        {selectedPage.generated_image !== null ? (
                          <div className="generated-image-wrap">
                            <AuthenticatedImage
                              className="generated-image"
                              loadImage={() => api.exportPageImage(selectedPage.id, activeOrganizationId)}
                              loading="eager"
                              onDoubleClick={(url) => openImageLightbox(url, `${translateUiString(uiLanguage, 'Page')} ${selectedPage.page_number}`)}
                              placeholderClassName="page-placeholder generated-image"
                              queryKey={scopedQueryKey(['page-image', selectedPage.id, selectedPage.generated_image.generated_at])}
                            />
                          </div>
                        ) : null}
                      </PanelSection>

                      <div className="page-editing-cluster page-section-frames-panels">
                      <PanelSection
                        title="Panel layout"
                        className="layout-control-section"
                        collapsible
                        actions={
                          <div className="toolbar">
                            <label className="field" style={{ minWidth: '14rem' }}>
                              <span>{translateUiString(uiLanguage, 'Template')}</span>
                              <select value={frameTemplateId} onChange={(event) => setFrameTemplateId(event.target.value)}>
                                {frameTemplateId === CUSTOM_FRAME_TEMPLATE_ID ? (
                                  <option value={CUSTOM_FRAME_TEMPLATE_ID}>
                                    {translateUiString(uiLanguage, 'Custom / unsynced')}
                                  </option>
                                ) : null}
                                {FRAME_TEMPLATE_OPTIONS.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {translateUiString(uiLanguage, label)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="ghost-button layout-preview-button"
                              disabled={!canPreviewFrameTemplate}
                              onClick={() => setLayoutPreviewTemplateId(frameTemplateId)}
                              type="button"
                            >
                              <LayoutGrid size={16} />
                              {translateUiString(uiLanguage, 'Preview')}
                            </button>
                            <button
                              className="ghost-button"
                              disabled={FRAME_TEMPLATE_PANEL_COUNTS[frameTemplateId] === undefined}
                              onClick={() =>
                                void runAction('Apply panel layout', async () => {
                                  const nextPanelCount = FRAME_TEMPLATE_PANEL_COUNTS[frameTemplateId] ?? selectedPagePanelCount;
                                  const deletedPanelCount = Math.max(selectedPagePanelCount - nextPanelCount, 0);
                                  if (deletedPanelCount > 0) {
                                    throw new Error(
                                      'This layout would remove existing panels. Delete unnecessary panels first, or choose a layout with the same panel count.',
                                    );
                                  }

                                  await api.applyPageLayoutTemplate(
                                    selectedPage.id,
                                    frameTemplateId,
                                    false,
                                    activeOrganizationId,
                                  );
                                  await invalidateScopedQuery(['frames', selectedPage.id]);
                                  await invalidateScopedQuery(['panels', selectedPage.id]);
                                  if (selectedEpisode !== null) {
                                    await invalidateScopedQuery(['pages', selectedEpisode.id]);
                                  }
                                })
                              }
                              type="button"
                            >
                              <Wand2 size={16} />
                              {translateUiString(uiLanguage, 'Apply panel layout')}
                            </button>
                          </div>
                        }
                      >
                        <div className="muted small">
                          {uiLanguage === 'ja'
                            ? '\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u3092\u9078\u3076\u3068\u30b3\u30de\u6570\u3082\u63c3\u3044\u307e\u3059\u3002'
                            : 'Templates also sync the panel count.'}
                        </div>
                        <details className="advanced-disclosure">
                          <summary>{translateUiString(uiLanguage, 'Advanced frame geometry')}</summary>
                          <div className="frame-editor-list">
                            {frameDrafts.map((frameDraft, frameIndex) => (
                              <div className="frame-editor-card" key={frameDraft.id || `frame-${frameIndex}`}>
                                <div className="frame-editor-header">
                                  <strong>
                                    {translateUiString(uiLanguage, 'Frame geometry')} {frameIndex + 1}
                                  </strong>
                                  <InputField
                                    label="Order"
                                    value={frameDraft.reading_order}
                                    onChange={(value) => updateFrameDraft(frameIndex, { reading_order: value })}
                                    type="number"
                                    min={1}
                                    max={1000}
                                  />
                                </div>
                                <div className="form-grid three">
                                  <label className="field">
                                    <span>{translateUiString(uiLanguage, 'Linked panel')}</span>
                                    <select
                                      value={frameDraft.panel_id}
                                      onChange={(event) => updateFrameDraft(frameIndex, { panel_id: event.target.value })}
                                    >
                                      <option value="">{translateUiString(uiLanguage, 'No linked panel')}</option>
                                      {panels.map((panel) => (
                                        <option key={panel.id} value={panel.id}>
                                          {translateUiString(uiLanguage, 'Panel')} {panel.order}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <SelectField
                                    label="Border style"
                                    value={frameDraft.border_style}
                                    onChange={(value) =>
                                      updateFrameDraft(frameIndex, {
                                        border_style: value as PanelFrameRecord['border_style'],
                                      })
                                    }
                                    options={FRAME_BORDER_STYLE_OPTIONS}
                                  />
                                  <InputField
                                    label="Z-index"
                                    value={frameDraft.z_index}
                                    onChange={(value) => updateFrameDraft(frameIndex, { z_index: value })}
                                    type="number"
                                    min={0}
                                    max={1000}
                                  />
                                </div>
                                <div className="form-grid two">
                                  <InputField
                                    label="Border width"
                                    value={frameDraft.border_width}
                                    onChange={(value) => updateFrameDraft(frameIndex, { border_width: value })}
                                    type="number"
                                    min={0}
                                    max={20}
                                  />
                                  <label className="field">
                                    <span>{translateUiString(uiLanguage, 'Border color')}</span>
                                    <input
                                      value={frameDraft.border_color}
                                      onChange={(event) => updateFrameDraft(frameIndex, { border_color: event.target.value })}
                                      type="color"
                                    />
                                  </label>
                                </div>
                                <div className="frame-vertex-grid">
                                  {frameDraft.vertices.map((vertex, vertexIndex) => (
                                    <div className="frame-vertex-row" key={`${frameDraft.id || frameIndex}-vertex-${vertexIndex}`}>
                                      <span>
                                        {translateUiString(uiLanguage, 'Vertex')} {vertexIndex + 1}
                                      </span>
                                      <InputField
                                        label="X"
                                        value={vertex.x}
                                        onChange={(value) => updateFrameVertexDraft(frameIndex, vertexIndex, 'x', value)}
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                      />
                                      <InputField
                                        label="Y"
                                        value={vertex.y}
                                        onChange={(value) => updateFrameVertexDraft(frameIndex, vertexIndex, 'y', value)}
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          <button
                            className="secondary-button"
                            onClick={() =>
                              void runAction('Save frame geometry', async () => {
                                await api.replaceFrames(
                                  selectedPage.id,
                                  toPanelFramesPayload(frameDrafts),
                                  activeOrganizationId,
                                );
                                await invalidateScopedQuery(['frames', selectedPage.id]);
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Save frame geometry')}
                          </button>
                        </details>
                      </PanelSection>

                      <PanelSection title="Panels" collapsible>
                        <div className="muted small">{translateUiString(uiLanguage, 'You do not need to fill every blank field.')}</div>
                        <div className="panel-order-list">
                          {panels.map((panel, panelIndex) => (
                            <div
                              key={panel.id}
                              className={`panel-order-row ${selectedPanel?.id === panel.id ? 'active' : ''}`}
                            >
                              <button
                                className="panel-order-main"
                                onClick={() => setSelectedPanelId(panel.id)}
                                type="button"
                              >
                                <strong>{formatPanelOrderLabel(uiLanguage, panel.order)}</strong>
                                <span>{formatPanelRoleLabel(uiLanguage, panel.panel_role)}</span>
                              </button>
                              <div className="panel-order-actions" aria-label={`${translateUiString(uiLanguage, 'Panel')} ${panel.order}`}>
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move panel up')}
                                  className="compact-action-button"
                                  disabled={panelIndex === 0}
                                  onClick={() =>
                                    void runAction('Move panel up', async () => {
                                      await reorderPanelWithinSelectedPage(panel.id, 'up');
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move panel up')}
                                  type="button"
                                >
                                  <ChevronUp size={15} />
                                  <span>{translateUiString(uiLanguage, 'Move earlier')}</span>
                                </button>
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Move panel down')}
                                  className="compact-action-button"
                                  disabled={panelIndex === panels.length - 1}
                                  onClick={() =>
                                    void runAction('Move panel down', async () => {
                                      await reorderPanelWithinSelectedPage(panel.id, 'down');
                                    })
                                  }
                                  title={translateUiString(uiLanguage, 'Move panel down')}
                                  type="button"
                                >
                                  <ChevronDown size={15} />
                                  <span>{translateUiString(uiLanguage, 'Move later')}</span>
                                </button>
                                <button
                                  aria-label={translateUiString(uiLanguage, 'Delete panel')}
                                  className="compact-action-button danger"
                                  onClick={() => {
                                    if (!window.confirm(formatDeletePanelConfirmMessage(uiLanguage, panel.order))) {
                                      return;
                                    }

                                    void runAction('Delete panel', async () => {
                                      await deletePanelFromSelectedPage(panel);
                                    });
                                  }}
                                  title={translateUiString(uiLanguage, 'Delete panel')}
                                  type="button"
                                >
                                  <Trash2 size={15} />
                                  <span>{translateUiString(uiLanguage, 'Delete')}</span>
                                </button>
                              </div>
                            </div>
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
                        <div className="form-grid two">
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
                        <details className="advanced-disclosure">
                          <summary>{translateUiString(uiLanguage, 'Advanced panel options')}</summary>
                          <div className="form-grid two">
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
                            <InputField label="Notes" value={panelDraft.panel_notes} onChange={(value) => setPanelDraft({ ...panelDraft, panel_notes: value })} />
                          </div>
                        </details>
                        <label className="checkbox-row">
                          <input
                            checked={panelDraft.dialogue_in_panel}
                            onChange={(event) => setPanelDraft({ ...panelDraft, dialogue_in_panel: event.target.checked })}
                            type="checkbox"
                          />
                          {translateUiString(uiLanguage, 'Dialogue in panel')}
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
                                const createdPanel = await api.createPanel(
                                  selectedPage.id,
                                  toPanelPayload(panelDraft),
                                  activeOrganizationId,
                                );
                                try {
                                  await api.replacePanelAssignments(
                                    createdPanel.id,
                                    assignmentsPayload,
                                    activeOrganizationId,
                                  );
                                } catch (error) {
                                  await api.deletePanel(createdPanel.id, activeOrganizationId).catch(() => undefined);
                                  throw error;
                                }
                                setSelectedPanelId(createdPanel.id);
                                await invalidateScopedQuery(['panels', selectedPage.id]);
                              })
                            }
                            type="button"
                          >
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Create panel')}
                          </button>
                          {selectedPanel !== null ? (
                            <>
                              <button
                                className="ghost-button"
                                onClick={() =>
                                  void runAction('Save panel', async () => {
                                    const assignmentsPayload = toPanelAssignmentsPayload(panelDraft);
                                    await api.updatePanel(
                                      selectedPanel.id,
                                      toPanelPayload(panelDraft),
                                      activeOrganizationId,
                                    );
                                    await api.replacePanelAssignments(
                                      selectedPanel.id,
                                      assignmentsPayload,
                                      activeOrganizationId,
                                    );
                                    await invalidateScopedQuery(['panels', selectedPage.id]);
                                  })
                                }
                                type="button"
                              >
                                <Save size={16} />
                                {translateUiString(uiLanguage, 'Save panel')}
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() => {
                                  if (!window.confirm(formatDeletePanelConfirmMessage(uiLanguage, selectedPanel.order))) {
                                    return;
                                  }

                                  void runAction('Delete panel', async () => {
                                    await deletePanelFromSelectedPage(selectedPanel);
                                  });
                                }}
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

                      <PanelSection title="Export" className="page-section-export" collapsible mobileDefaultCollapsed>
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

                    </>
                  ) : null}
                  </div>
                </>
              ) : null}
            </section>

            <aside className="rail">
              {railPanel}
            </aside>
          </div>
        )}
      </main>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {canViewActiveOrganizationWorks ? (
          <>
            <button
              aria-current={activeTab === 'story' ? 'page' : undefined}
              className={activeTab === 'story' ? 'active' : ''}
              onClick={() => setActiveTab('story')}
              type="button"
            >
              <Bot size={20} />
              <span>{translateUiString(uiLanguage, 'Story')}</span>
            </button>
            <button
              aria-current={activeTab === 'entities' ? 'page' : undefined}
              className={activeTab === 'entities' ? 'active' : ''}
              onClick={() => setActiveTab('entities')}
              type="button"
            >
              <Image size={20} />
              <span>{translateUiString(uiLanguage, 'Entities')}</span>
            </button>
            <button
              aria-current={activeTab === 'pages' ? 'page' : undefined}
              className={activeTab === 'pages' ? 'active' : ''}
              onClick={() => setActiveTab('pages')}
              type="button"
            >
              <PanelsTopLeft size={20} />
              <span>{translateUiString(uiLanguage, 'Pages')}</span>
            </button>
          </>
        ) : null}
        <button
          aria-current={activeTab === 'account' ? 'page' : undefined}
          className={activeTab === 'account' ? 'active' : ''}
          onClick={() => setActiveTab('account')}
          type="button"
        >
          <CreditCard size={20} />
          <span>{translateUiString(uiLanguage, 'Account')}</span>
        </button>
        <button
          aria-current={activeTab === 'tutorial' ? 'page' : undefined}
          className={activeTab === 'tutorial' ? 'active' : ''}
          onClick={() => setActiveTab('tutorial')}
          type="button"
        >
          <BookOpen size={20} />
          <span>{translateUiString(uiLanguage, 'Guide')}</span>
        </button>
      </nav>
      {lightboxImageUrl !== null ? (
        <div className="image-lightbox" onClick={closeImageLightbox} role="presentation">
          <div className="image-lightbox-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="image-lightbox-header">
              <strong>{lightboxTitle}</strong>
              <button className="ghost-button image-lightbox-close" onClick={closeImageLightbox} type="button">
                {'\u00d7'}
              </button>
            </div>
            <div className="image-lightbox-body">
              <img alt="" src={lightboxImageUrl} />
            </div>
          </div>
        </div>
      ) : null}
      {layoutPreviewTemplateId !== null && layoutPreviewFrames.length > 0 ? (
        <div className="image-lightbox" onClick={() => setLayoutPreviewTemplateId(null)} role="presentation">
          <div className="layout-preview-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="image-lightbox-header">
              <strong>{getFrameTemplateDisplayLabel(uiLanguage, layoutPreviewTemplateId)}</strong>
              <button className="ghost-button image-lightbox-close" onClick={() => setLayoutPreviewTemplateId(null)} type="button">
                {'\u00d7'}
              </button>
            </div>
            <LayoutTemplatePreview frames={layoutPreviewFrames} />
          </div>
        </div>
      ) : null}
      </div>
    </UiLanguageContext.Provider>
  );
}

function AuthenticatedImage(props: {
  alt?: string;
  className?: string;
  enabled?: boolean;
  loadImage: () => Promise<BlobResponse>;
  loading?: 'eager' | 'lazy';
  onClick?: (url: string) => void;
  onDoubleClick?: (url: string) => void;
  placeholderClassName?: string;
  queryKey: readonly unknown[];
}) {
  const imageQuery = useQuery({
    queryKey: props.queryKey,
    queryFn: async () => {
      const response = await props.loadImage();
      return response.blob;
    },
    enabled: props.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (imageQuery.data === undefined) {
      setObjectUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(imageQuery.data);
    setObjectUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [imageQuery.data]);

  if (objectUrl === null) {
    const placeholderClassName = `${props.placeholderClassName ?? 'thumb-placeholder'} image-loading-placeholder`.trim();
    return (
      <div className={placeholderClassName}>
        {imageQuery.isFetching ? <span className="image-loading-dot" aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <img
      alt={props.alt ?? ''}
      className={props.className}
      decoding="async"
      loading={props.loading ?? 'lazy'}
      onClick={
        props.onClick === undefined
          ? undefined
          : () => props.onClick?.(objectUrl)
      }
      onDoubleClick={
        props.onDoubleClick === undefined
          ? undefined
          : () => props.onDoubleClick?.(objectUrl)
      }
      src={objectUrl}
    />
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
  mobileDefaultCollapsed?: boolean;
}) {
  const language = useContext(UiLanguageContext);
  const isMobileViewport = useIsMobileViewport();
  const defaultCollapsed = props.defaultCollapsed ?? (props.mobileDefaultCollapsed === true && isMobileViewport);
  const resetKey = `${props.title}:${String(props.defaultCollapsed ?? '')}:${String(props.mobileDefaultCollapsed ?? '')}:${String(isMobileViewport)}`;
  const lastResetKeyRef = useRef(resetKey);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) {
      return;
    }

    lastResetKeyRef.current = resetKey;
    setCollapsed(defaultCollapsed);
  }, [defaultCollapsed, resetKey]);

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

function OrganizationDetailPanel(props: {
  children: ReactNode;
  className?: string;
  collapsed: boolean;
  meta?: ReactNode;
  onToggle: () => void;
  title: string;
}) {
  return (
    <section
      className={`organization-collapsible-panel ${props.className ?? ''} ${props.collapsed ? 'collapsed' : ''}`.trim()}
    >
      <button
        aria-expanded={!props.collapsed}
        className="organization-collapsible-header"
        onClick={props.onToggle}
        type="button"
      >
        <strong>{props.title}</strong>
        {props.meta === undefined ? null : <span>{props.meta}</span>}
        <ChevronDown className={`section-toggle-icon ${props.collapsed ? '' : 'open'}`.trim()} size={16} />
      </button>
      {props.collapsed ? null : <div className="organization-collapsible-body">{props.children}</div>}
    </section>
  );
}

function BillingPanel(props: {
  balance: BillingBalanceRecord | undefined;
  balanceRefreshing: boolean;
  billingReturnChecking: boolean;
  busyAction: string | null;
  onOpenPortal: () => void;
  onPurchaseCredits: (packageCode: CreditCheckoutPackageCode) => void;
  onStartSubscription: (planCode: ConsumerSubscriptionCheckoutPlanCode) => void;
}) {
  const language = useContext(UiLanguageContext);
  const actionBusy = props.busyAction === 'Checkout subscription' || props.busyAction === 'Checkout credits' || props.busyAction === 'Open portal';
  const currentPlanCode = props.balance?.plan_code ?? null;
  const subscriptionPlans: SubscriptionPlanOption[] =
    props.balance?.subscription_plans ??
    subscriptionPurchaseOptions.map((plan) => ({
      plan_code: plan.code,
      display_name_ja: plan.code === 'standard' ? '\u30b9\u30bf\u30f3\u30c0\u30fc\u30c9' : '\u30d7\u30ec\u30df\u30a2\u30e0',
      display_name_en: plan.label.en,
      monthly_credits: plan.credits,
      amount_jpy: plan.priceJpy,
      minimum_contract_months: 1,
      trial_days: 0,
      is_enterprise: false,
      configured: true,
    }));
  const consumerSubscriptionPlans = subscriptionPlans.filter(
    (plan): plan is SubscriptionPlanOption & { plan_code: ConsumerSubscriptionCheckoutPlanCode } =>
      !plan.is_enterprise && isConsumerSubscriptionCheckoutPlanCode(plan.plan_code),
  );
  const isPaidPlan = currentPlanCode !== null && currentPlanCode !== 'free';
  const canSelectSubscriptionPlan = (planCode: ConsumerSubscriptionCheckoutPlanCode): boolean => {
    const plan = subscriptionPlans.find((current) => current.plan_code === planCode);
    if (actionBusy || currentPlanCode === null || currentPlanCode === planCode || plan?.configured !== true) {
      return false;
    }

    if (currentPlanCode === 'free') {
      return true;
    }

    return getSubscriptionPlanRank(planCode) > getSubscriptionPlanRank(currentPlanCode);
  };
  const planLabel = (plan: SubscriptionPlanOption): string =>
    pickUiText(language, plan.display_name_en, plan.display_name_ja);
  const paidPlanNote = isPaidPlan
    ? pickUiText(
        language,
        'Manage paid plan changes and cancellation from "Manage subscription and invoices".',
        '\u6709\u6599\u30d7\u30e9\u30f3\u306e\u5909\u66f4\u30fb\u89e3\u7d04\u306f\u300c\u30b5\u30d6\u30b9\u30af\u30fb\u8acb\u6c42\u3092\u7ba1\u7406\u300d\u3067\u884c\u3063\u3066\u304f\u3060\u3055\u3044\u3002',
      )
    : null;
  const billingStatusMessage = actionBusy
    ? pickUiText(language, 'Opening Stripe...', 'Stripe\u3092\u958b\u3044\u3066\u3044\u307e\u3059...')
    : props.billingReturnChecking
      ? pickUiText(language, 'Confirming payment result...', '\u6c7a\u6e08\u7d50\u679c\u3092\u78ba\u8a8d\u3057\u3066\u3044\u307e\u3059...')
      : props.balanceRefreshing
        ? pickUiText(language, 'Updating balance...', '\u6b8b\u9ad8\u3092\u66f4\u65b0\u3057\u3066\u3044\u307e\u3059...')
        : null;
  const renderSubscriptionPlanButton = (
    plan: SubscriptionPlanOption & { plan_code: ConsumerSubscriptionCheckoutPlanCode },
    isPrimary: boolean,
  ) => {
    const isCurrent = currentPlanCode === plan.plan_code;
    const disabled = !canSelectSubscriptionPlan(plan.plan_code);
    const statusLabel = !plan.configured
      ? pickUiText(language, 'Setup required', '\u7ba1\u7406\u8005\u8a2d\u5b9a\u5f85\u3061')
      : isCurrent
        ? pickUiText(language, 'Current', '\u73fe\u5728')
        : formatJpy(plan.amount_jpy);
    const detailParts = [
      pickUiText(language, `${plan.monthly_credits} credits / month`, `\u6708${plan.monthly_credits}\u30af\u30ec\u30b8\u30c3\u30c8`),
    ];
    if (plan.minimum_contract_months > 1) {
      detailParts.push(
        pickUiText(language, `${plan.minimum_contract_months} month minimum`, `\u6700\u4f4e${plan.minimum_contract_months}\u304b\u6708`),
      );
    }

    return (
      <button
        className={`billing-option ${isPrimary ? 'primary-billing-option' : ''} ${isCurrent ? 'current' : ''}`}
        disabled={disabled}
        key={plan.plan_code}
        onClick={() => props.onStartSubscription(plan.plan_code)}
        type="button"
      >
        <span>
          <strong>{planLabel(plan)}</strong>
          <small>{detailParts.join(' / ')}</small>
        </span>
        <span className="billing-price">{statusLabel}</span>
      </button>
    );
  };

  return (
    <PanelSection
      title="Credits"
      subtitle={pickUiText(language, 'Buy and manage credits', '\u6b8b\u9ad8\u3068\u8cfc\u5165')}
      compact
      collapsible
      className="billing-panel"
    >
      {billingStatusMessage !== null ? (
        <div className="billing-status">
          <LoaderCircle className="spin" size={13} />
          <span>{billingStatusMessage}</span>
        </div>
      ) : null}

      {props.balance !== undefined ? (
        <>
          <div className="billing-current-plan">
            <span>{pickUiText(language, 'Current plan', '\u73fe\u5728\u306e\u30d7\u30e9\u30f3')}</span>
            <strong>{formatPlanLabel(language, props.balance.plan_code)}</strong>
          </div>
          <div className="metric-grid billing-balance-grid">
            <Metric label={pickUiText(language, 'Total', '\u5408\u8a08')} value={String(props.balance.total_credits)} />
            <Metric label={pickUiText(language, 'Monthly', '\u6708\u984d\u5206')} value={String(props.balance.monthly_credits)} />
            <Metric label={pickUiText(language, 'Purchased', '\u8ffd\u52a0\u8cfc\u5165\u5206')} value={String(props.balance.purchased_credits)} />
          </div>
        </>
      ) : (
        <div className="billing-loading">
          <LoaderCircle className="spin" size={16} />
          <span>{pickUiText(language, 'Loading balance', '\u6b8b\u9ad8\u3092\u8aad\u307f\u8fbc\u307f\u4e2d')}</span>
        </div>
      )}

      <div className="billing-block">
        <div className="billing-block-header">
          <strong>{pickUiText(language, 'Monthly plans', '\u6708\u984d\u30d7\u30e9\u30f3')}</strong>
          <span>{pickUiText(language, 'Personal use', '\u500b\u4eba\u5411\u3051')}</span>
        </div>
        {consumerSubscriptionPlans.map((plan) => renderSubscriptionPlanButton(plan, true))}
        {isPaidPlan && paidPlanNote !== null ? <div className="billing-note">{paidPlanNote}</div> : null}
      </div>

      <div className="billing-block">
        <div className="billing-block-header">
          <strong>{pickUiText(language, 'One-time credits', '\u8ffd\u52a0\u30af\u30ec\u30b8\u30c3\u30c8')}</strong>
          <span>{pickUiText(language, 'No renewal', '\u66f4\u65b0\u306a\u3057')}</span>
        </div>
        <div className="billing-pack-grid">
          {creditPurchaseOptions.map((pack) => (
            <button
              className="billing-option"
              disabled={actionBusy}
              key={pack.code}
              onClick={() => props.onPurchaseCredits(pack.code)}
              type="button"
            >
              <span>
                <strong>{pickUiText(language, `${pack.credits} credits`, `${pack.credits}\u30af\u30ec\u30b8\u30c3\u30c8`)}</strong>
                <small>{pickUiText(language, 'one-time', '\u8cb7\u3044\u5207\u308a')}</small>
              </span>
              <span className="billing-price">{formatJpy(pack.priceJpy)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="billing-usage">
        {creditUsageItems.map((item) => (
          <span key={item.en}>{pickUiText(language, item.en, item.ja)}</span>
        ))}
      </div>

      <button className="ghost-button billing-portal-button" disabled={actionBusy} onClick={props.onOpenPortal} type="button">
        <CreditCard size={16} />
        <span>{pickUiText(language, 'Manage subscription and invoices', '\u30b5\u30d6\u30b9\u30af\u30fb\u8acb\u6c42\u3092\u7ba1\u7406')}</span>
      </button>
    </PanelSection>
  );
}
function TutorialGuide() {
  const language = useContext(UiLanguageContext);

  return (
    <div className="tutorial-guide">
      {tutorialSteps.map((group) => (
        <section key={group.title.en} className="tutorial-group">
          <h3>{pickUiText(language, group.title.en, group.title.ja)}</h3>
          <ol>
            {group.steps.map((step) => (
              <li key={step.en}>{pickUiText(language, step.en, step.ja)}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function NoticeBanner(props: { notice: NoticeState }) {
  return <div className={`notice ${props.notice.type}`}>{props.notice.message}</div>;
}

function ProcessingHint(props: { message: string; progressPercent?: number | null; queued?: boolean; showProgress?: boolean }) {
  return (
    <div className={`processing-hint ${props.queued ? 'queued' : 'processing'}`}>
      <div className="processing-hint-line">
        <LoaderCircle className="spin" size={14} />
        <span>{props.message}</span>
      </div>
      {props.showProgress === true ? (
        <ProgressBar percent={props.progressPercent ?? null} tone={props.queued ? 'queued' : 'active'} />
      ) : null}
    </div>
  );
}

function ProgressBar(props: {
  compact?: boolean;
  percent: number | null;
  tone: 'active' | 'queued' | 'completed' | 'failed';
}) {
  const normalizedPercent = props.percent === null ? null : Math.min(100, Math.max(0, props.percent));
  const className = [
    'progress-bar',
    normalizedPercent === null ? 'indeterminate' : 'determinate',
    `progress-${props.tone}`,
    props.compact === true ? 'compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedPercent ?? undefined}
    >
      <div className="progress-bar-fill" style={normalizedPercent === null ? undefined : { width: `${normalizedPercent}%` }} />
    </div>
  );
}

function LayoutTemplatePreview(props: { frames: FramePreviewDefinition[] }) {
  return (
    <div className="layout-preview-body">
      <svg aria-hidden="true" className="layout-preview-svg" viewBox="0 0 100 140">
        <rect className="layout-preview-page" height="140" rx="2" width="100" x="0" y="0" />
        {props.frames.map((frame, index) => {
          const readingOrder = frame.readingOrder ?? index + 1;
          const borderStyle = frame.borderStyle ?? 'solid';
          return (
            <polygon
              className={`layout-preview-frame layout-preview-frame-${borderStyle}`}
              key={`layout-preview-frame-${readingOrder}`}
              points={frame.vertices.map((vertex) => `${vertex.x * 100},${vertex.y * 140}`).join(' ')}
            />
          );
        })}
        {props.frames.map((frame, index) => {
          const readingOrder = frame.readingOrder ?? index + 1;
          const center = getFramePreviewCenter(frame.vertices);
          return (
            <text
              className="layout-preview-number"
              key={`layout-preview-label-${readingOrder}`}
              x={center.x * 100}
              y={center.y * 140}
            >
              {readingOrder}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function StatusBadge(props: { value: string }) {
  const language = useContext(UiLanguageContext);
  return <span className={`status-badge status-${props.value}`}>{translateUiString(language, props.value)}</span>;
}

function InputField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: React.HTMLInputTypeAttribute;
  min?: number;
  max?: number;
  step?: number | string;
}) {
  const language = useContext(UiLanguageContext);
  return (
    <label className="field">
      <span>{translateUiString(language, props.label)}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        type={props.type}
        min={props.min}
        max={props.max}
        step={props.step}
      />
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

function SelectOrCustomField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  const language = useContext(UiLanguageContext);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const renderOptions = useMemo(
    () =>
      props.options.some(([value]) => value === 'custom')
        ? props.options
        : [...props.options, ['custom', 'Custom'] as [string, string]],
    [props.options],
  );
  const concreteOptionValues = useMemo(
    () => new Set(renderOptions.map(([value]) => value).filter((value) => value !== '' && value !== 'custom')),
    [renderOptions],
  );
  const inferredSelectValue =
    props.value === ''
      ? ''
      : concreteOptionValues.has(props.value)
        ? props.value
        : 'custom';
  const [customMode, setCustomMode] = useState(inferredSelectValue === 'custom');
  const selectValue = customMode ? 'custom' : inferredSelectValue;

  useEffect(() => {
    if (props.value !== '') {
      setCustomMode(!concreteOptionValues.has(props.value));
    }
  }, [concreteOptionValues, props.value]);

  return (
    <label className="field">
      <span>{translateUiString(language, props.label)}</span>
      <select
        value={selectValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === 'custom') {
            setCustomMode(true);
            props.onChange(concreteOptionValues.has(props.value) ? '' : props.value);
            window.requestAnimationFrame(() => customInputRef.current?.focus());
            return;
          }
          setCustomMode(false);
          props.onChange(nextValue);
        }}
      >
        {renderOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {translateUiString(language, label)}
          </option>
        ))}
      </select>
      {customMode ? (
        <input
          ref={customInputRef}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={translateUiString(language, 'Custom value')}
        />
      ) : null}
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

function StringChipListField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholderLabel: string;
  addLabel: string;
  emptyLabel: string;
}) {
  const language = useContext(UiLanguageContext);
  const [draftValue, setDraftValue] = useState('');
  const entries = useMemo(() => splitCsv(props.value), [props.value]);

  const commit = (): void => {
    const nextValue = draftValue.trim();
    if (nextValue.length === 0) {
      return;
    }

    const nextEntries = Array.from(new Set([...entries, nextValue]));
    props.onChange(nextEntries.join(', '));
    setDraftValue('');
  };

  const remove = (target: string): void => {
    props.onChange(entries.filter((entry) => entry !== target).join(', '));
  };

  return (
    <div className="field">
      <span>{translateUiString(language, props.label)}</span>
      <div className="chip-list-toolbar">
        <input
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          placeholder={translateUiString(language, props.placeholderLabel)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button className="ghost-button" type="button" onClick={commit}>
          <Save size={16} />
          {translateUiString(language, props.addLabel)}
        </button>
      </div>
      {entries.length === 0 ? (
        <div className="muted">{translateUiString(language, props.emptyLabel)}</div>
      ) : (
        <div className="chip-list">
          {entries.map((entry) => (
            <button key={entry} className="chip" type="button" onClick={() => remove(entry)}>
              <span>{entry}</span>
              <Trash2 size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GenericStructuredFieldsEditor(props: {
  value: string;
  onChange: (nextValue: string) => void;
}) {
  const language = useContext(UiLanguageContext);
  const rows = useMemo(() => parseGenericStructuredFieldRows(props.value), [props.value]);

  const commitRows = (nextRows: GenericStructuredFieldRow[]): void => {
    props.onChange(serializeGenericStructuredFieldRows(nextRows));
  };

  const updateRow = (index: number, patch: Partial<GenericStructuredFieldRow>): void => {
    commitRows(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number): void => {
    commitRows(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="field-group">
      <span className="field-label">{translateUiString(language, 'Structured fields')}</span>
      {rows.length === 0 ? (
        <div className="muted small">{translateUiString(language, 'No structured fields yet.')}</div>
      ) : null}
      <div className="structured-field-list">
        {rows.map((row, index) => (
          <div className="structured-field-row" key={`${row.key}-${index}`}>
            <InputField
              label="Field"
              value={row.key}
              onChange={(value) => updateRow(index, { key: value })}
            />
            <TextAreaField
              label="Value"
              rows={2}
              value={row.value}
              onChange={(value) => updateRow(index, { value })}
            />
            <button className="ghost-button danger icon-only" onClick={() => removeRow(index)} type="button">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <button
        className="ghost-button"
        onClick={() => commitRows([...rows, { key: `field_${rows.length + 1}`, value: '' }])}
        type="button"
      >
        <Check size={16} />
        {translateUiString(language, 'Add field')}
      </button>
    </div>
  );
}

function CharacterFieldsGroup(props: {
  children: ReactNode;
  defaultOpen?: boolean;
  mobileDefaultOpen?: boolean;
  title: string;
}) {
  const language = useContext(UiLanguageContext);
  const isMobileViewport = useIsMobileViewport();
  const defaultOpen = props.defaultOpen ?? (!isMobileViewport || props.mobileDefaultOpen === true);
  const resetKey = `${props.title}:${String(isMobileViewport)}:${String(props.mobileDefaultOpen ?? false)}:${String(props.defaultOpen ?? '')}`;
  const lastResetKeyRef = useRef(resetKey);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (lastResetKeyRef.current === resetKey) {
      return;
    }

    lastResetKeyRef.current = resetKey;
    setOpen(defaultOpen);
  }, [defaultOpen, resetKey]);

  return (
    <section className={`character-fields-group ${open ? '' : 'collapsed'}`}>
      <button
        aria-expanded={open}
        className="character-fields-group-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="character-fields-group-title">{translateUiString(language, props.title)}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? <div className="character-fields-group-body">{props.children}</div> : null}
    </section>
  );
}

function CharacterStructuredFieldsEditor(props: {
  value: CharacterStructuredFieldsDraft;
  onChange: (nextValue: CharacterStructuredFieldsDraft) => void;
}) {
  const language = useContext(UiLanguageContext);
  const update = (patch: Partial<CharacterStructuredFieldsDraft>): void => {
    props.onChange({
      ...props.value,
      ...patch,
    });
  };

  return (
    <div className="character-fields-stack">
      <CharacterFieldsGroup title="Identity">
        <div className="form-grid three compact-grid">
          <SelectOrCustomField label="Gender" value={props.value.gender_expression} onChange={(value) => update({ gender_expression: value })} options={CHARACTER_GENDER_OPTIONS} />
          <SelectOrCustomField label="Age range" value={props.value.age_range} onChange={(value) => update({ age_range: value })} options={CHARACTER_AGE_RANGE_OPTIONS} />
          <SelectOrCustomField label="Skin tone" value={props.value.skin_tone} onChange={(value) => update({ skin_tone: value })} options={CHARACTER_SKIN_TONE_OPTIONS} />
          <SelectOrCustomField label="First impression" value={props.value.first_impression} onChange={(value) => update({ first_impression: value })} options={CHARACTER_FIRST_IMPRESSION_OPTIONS} />
          <SelectOrCustomField label="Standing style" value={props.value.standing_style} onChange={(value) => update({ standing_style: value })} options={CHARACTER_STANDING_STYLE_OPTIONS} />
          <SelectOrCustomField label="Default expression" value={props.value.default_expression} onChange={(value) => update({ default_expression: value })} options={CHARACTER_DEFAULT_EXPRESSION_OPTIONS} />
          <SelectOrCustomField label="Height" value={props.value.height} onChange={(value) => update({ height: value })} options={CHARACTER_HEIGHT_OPTIONS} />
          <SelectOrCustomField label="Body type" value={props.value.build} onChange={(value) => update({ build: value })} options={CHARACTER_BUILD_OPTIONS} />
          <SelectOrCustomField label="Art style" value={props.value.art_style} onChange={(value) => update({ art_style: value })} options={CHARACTER_ART_STYLE_OPTIONS} />
        </div>
        <StringChipListField
          label="Aliases"
          value={props.value.aliases}
          onChange={(value) => update({ aliases: value })}
          placeholderLabel="Alias placeholder"
          addLabel="Add alias"
          emptyLabel="No aliases yet."
        />
      </CharacterFieldsGroup>

      <CharacterFieldsGroup title="Anchors" defaultOpen={false}>
        <div className="form-grid two compact-grid">
          <SelectOrCustomField label="Visual anchor" value={props.value.visual_anchor} onChange={(value) => update({ visual_anchor: value })} options={CHARACTER_VISUAL_ANCHOR_OPTIONS} />
          <SelectOrCustomField label="Signature feature" value={props.value.signature_feature} onChange={(value) => update({ signature_feature: value })} options={CHARACTER_SIGNATURE_FEATURE_OPTIONS} />
        </div>
        <div className="form-grid two compact-grid">
          <SelectOrCustomField label="Silhouette keywords" value={props.value.silhouette_keywords} onChange={(value) => update({ silhouette_keywords: value })} options={CHARACTER_SILHOUETTE_KEYWORD_OPTIONS} />
          <SelectOrCustomField label="Distinguishing features" value={props.value.distinguishing_features} onChange={(value) => update({ distinguishing_features: value })} options={CHARACTER_DISTINGUISHING_FEATURE_OPTIONS} />
        </div>
        <details className="advanced-disclosure character-anchor-detail">
          <summary>{translateUiString(language, 'Body proportion details')}</summary>
          <div className="form-grid four compact-grid">
            <SelectOrCustomField label="Head/body ratio" value={props.value.head_to_body_ratio} onChange={(value) => update({ head_to_body_ratio: value })} options={CHARACTER_HEAD_RATIO_OPTIONS} />
            <SelectOrCustomField label="Shoulder width" value={props.value.shoulder_width} onChange={(value) => update({ shoulder_width: value })} options={CHARACTER_SHOULDER_WIDTH_OPTIONS} />
            <SelectOrCustomField label="Leg length" value={props.value.leg_length} onChange={(value) => update({ leg_length: value })} options={CHARACTER_LEG_LENGTH_OPTIONS} />
            <SelectOrCustomField label="Posture axis" value={props.value.posture_axis} onChange={(value) => update({ posture_axis: value })} options={CHARACTER_POSTURE_AXIS_OPTIONS} />
          </div>
        </details>
      </CharacterFieldsGroup>

      <CharacterFieldsGroup title="Face">
        <div className="form-grid four compact-grid">
          <SelectOrCustomField label="Face shape" value={props.value.face_shape} onChange={(value) => update({ face_shape: value })} options={CHARACTER_FACE_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Eyebrow shape" value={props.value.eyebrow_shape} onChange={(value) => update({ eyebrow_shape: value })} options={CHARACTER_EYEBROW_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Nose shape" value={props.value.nose_shape} onChange={(value) => update({ nose_shape: value })} options={CHARACTER_NOSE_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Mouth shape" value={props.value.mouth_shape} onChange={(value) => update({ mouth_shape: value })} options={CHARACTER_MOUTH_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Eye color" value={props.value.eye_color} onChange={(value) => update({ eye_color: value })} options={CHARACTER_EYE_COLOR_OPTIONS} />
          <SelectOrCustomField label="Eye shape" value={props.value.eye_shape} onChange={(value) => update({ eye_shape: value })} options={CHARACTER_EYE_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Eyelid type" value={props.value.eyelid_type} onChange={(value) => update({ eyelid_type: value })} options={CHARACTER_EYELID_TYPE_OPTIONS} />
          <SelectOrCustomField label="Eye size" value={props.value.eye_size} onChange={(value) => update({ eye_size: value })} options={CHARACTER_EYE_SIZE_OPTIONS} />
          <SelectOrCustomField label="Eye angle" value={props.value.eye_angle} onChange={(value) => update({ eye_angle: value })} options={CHARACTER_EYE_ANGLE_OPTIONS} />
          <SelectOrCustomField label="Pupil style" value={props.value.pupil_style} onChange={(value) => update({ pupil_style: value })} options={CHARACTER_PUPIL_STYLE_OPTIONS} />
          <SelectOrCustomField label="Under-eye detail" value={props.value.under_eye_detail} onChange={(value) => update({ under_eye_detail: value })} options={CHARACTER_UNDER_EYE_DETAIL_OPTIONS} />
          <SelectOrCustomField label="Mouth default" value={props.value.mouth_default} onChange={(value) => update({ mouth_default: value })} options={CHARACTER_MOUTH_DEFAULT_OPTIONS} />
        </div>
      </CharacterFieldsGroup>

      <CharacterFieldsGroup title="Hair">
        <div className="form-grid five compact-grid">
          <SelectOrCustomField label="Hair color" value={props.value.hair_color} onChange={(value) => update({ hair_color: value })} options={CHARACTER_HAIR_COLOR_OPTIONS} />
          <SelectOrCustomField label="Hair length" value={props.value.hair_length} onChange={(value) => update({ hair_length: value })} options={CHARACTER_HAIR_LENGTH_OPTIONS} />
          <SelectOrCustomField label="Hair style" value={props.value.hair_style} onChange={(value) => update({ hair_style: value })} options={CHARACTER_HAIR_STYLE_OPTIONS} />
          <SelectOrCustomField label="Hair arrangement" value={props.value.hair_arrangement} onChange={(value) => update({ hair_arrangement: value })} options={CHARACTER_HAIR_ARRANGEMENT_OPTIONS} />
          <SelectOrCustomField label="Bangs" value={props.value.hair_bangs} onChange={(value) => update({ hair_bangs: value })} options={CHARACTER_HAIR_BANGS_OPTIONS} />
        </div>
        <div className="form-grid three compact-grid">
          <SelectOrCustomField label="Front shape" value={props.value.hair_front_shape} onChange={(value) => update({ hair_front_shape: value })} options={CHARACTER_HAIR_FRONT_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Side hair" value={props.value.hair_side_hair} onChange={(value) => update({ hair_side_hair: value })} options={CHARACTER_HAIR_SIDE_OPTIONS} />
          <SelectOrCustomField label="Back shape" value={props.value.hair_back_shape} onChange={(value) => update({ hair_back_shape: value })} options={CHARACTER_HAIR_BACK_SHAPE_OPTIONS} />
        </div>
      </CharacterFieldsGroup>

      <CharacterFieldsGroup title="Outfit">
        <div className="form-grid three compact-grid">
          <SelectOrCustomField label="Category" value={props.value.clothing_category} onChange={(value) => update({ clothing_category: value })} options={CHARACTER_CLOTHING_CATEGORY_OPTIONS} />
          <SelectOrCustomField label="Main color" value={props.value.clothing_main_color} onChange={(value) => update({ clothing_main_color: value })} options={CHARACTER_CLOTHING_COLOR_OPTIONS} />
          <SelectOrCustomField label="Impression" value={props.value.clothing_impression} onChange={(value) => update({ clothing_impression: value })} options={CHARACTER_CLOTHING_IMPRESSION_OPTIONS} />
          <SelectOrCustomField label="Collar shape" value={props.value.collar_shape} onChange={(value) => update({ collar_shape: value })} options={CHARACTER_COLLAR_SHAPE_OPTIONS} />
          <SelectOrCustomField label="Sleeve length" value={props.value.sleeve_length} onChange={(value) => update({ sleeve_length: value })} options={CHARACTER_SLEEVE_LENGTH_OPTIONS} />
          <SelectOrCustomField label="Skirt or pants" value={props.value.skirt_or_pants_shape} onChange={(value) => update({ skirt_or_pants_shape: value })} options={CHARACTER_LOWER_GARMENT_OPTIONS} />
          <SelectOrCustomField label="Shoes" value={props.value.shoes} onChange={(value) => update({ shoes: value })} options={CHARACTER_SHOES_OPTIONS} />
          <SelectOrCustomField label="Legwear" value={props.value.socks_or_legwear} onChange={(value) => update({ socks_or_legwear: value })} options={CHARACTER_LEGWEAR_OPTIONS} />
        </div>
        <SelectOrCustomField label="Clothing details" value={props.value.clothing_description} onChange={(value) => update({ clothing_description: value })} options={CHARACTER_CLOTHING_DETAIL_OPTIONS} />
      </CharacterFieldsGroup>
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
  const language = useContext(UiLanguageContext);
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
          <h3>{translateUiString(language, 'Characters in panel')}</h3>
          <div className="muted">{translateUiString(language, 'Pick who appears first, then refine pose, facing, and effects per character.')}</div>
        </div>
      </div>
      <div className="toolbar">
        <label className="field" style={{ minWidth: '16rem' }}>
          <span>{translateUiString(language, 'Add character')}</span>
          <select
            value={props.pendingEntityId}
            onChange={(event) => props.onPendingEntityIdChange(event.target.value)}
          >
            {props.availableEntities.length === 0 ? (
              <option value="">{translateUiString(language, 'No more entities')}</option>
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
          {translateUiString(language, 'Add to panel')}
        </button>
      </div>
      {props.assignments.length === 0 ? (
        <div className="muted">{translateUiString(language, 'No characters assigned yet.')}</div>
      ) : (
        props.assignments.map((assignment) => {
          const entity = props.allEntities.find((entry) => entry.id === assignment.entity_id);

          return (
            <div key={assignment.entity_id} className="panel-section compact">
              <div className="section-header">
                <div>
                  <h3>{entity?.name ?? assignment.entity_id}</h3>
                  <div className="muted">{translateUiString(language, 'Placement first, then expression, pose, and effect.')}</div>
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
  const language = useContext(UiLanguageContext);
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
    const firstSpeakerId = props.entities[0]?.id ?? '';
    props.onChange([
      ...props.dialogues,
      {
        entity_id: firstSpeakerId,
        text: '',
        type: firstSpeakerId.length > 0 ? 'speech' : 'narration',
        position: 'top',
      },
    ]);
  };

  return (
    <div className="stack">
      <div className="section-header">
        <div>
          <h3>{translateUiString(language, 'Dialogue')}</h3>
          <div className="muted">
            {props.dialogueInPanel
              ? translateUiString(language, 'These lines will be considered inside the generated panel art.')
              : translateUiString(language, 'These lines stay outside the generated panel art.')}
          </div>
        </div>
        <button className="ghost-button" onClick={addDialogue} type="button">
          <Save size={16} />
          {translateUiString(language, 'Add line')}
        </button>
      </div>
      {props.dialogues.length === 0 ? (
        <div className="muted">{translateUiString(language, 'No dialogue lines yet.')}</div>
      ) : (
        props.dialogues.map((dialogue, index) => {
          const speakerRequired = requiresPanelDialogueSpeaker(dialogue.type);
          const speakerMissing = speakerRequired && dialogue.entity_id.trim().length === 0;

          return (
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
                  <span>{translateUiString(language, 'Speaker')}</span>
                <select
                  value={dialogue.entity_id}
                  onChange={(event) => updateDialogue(index, { entity_id: event.target.value })}
                >
                  <option value="" disabled={speakerRequired}>
                    {translateUiString(language, 'Narration / none')}
                  </option>
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
                onChange={(value) => {
                  const nextType = value as PanelDialogueDraft['type'];
                  const firstSpeakerId = props.entities[0]?.id ?? '';
                  updateDialogue(index, {
                    type: nextType,
                    entity_id:
                      requiresPanelDialogueSpeaker(nextType) && dialogue.entity_id.trim().length === 0
                        ? firstSpeakerId
                        : dialogue.entity_id,
                  });
                }}
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
            {speakerMissing ? (
              <div className="error-text">
                {translateUiString(language, 'Speaker is required for speech, thought, shout, and whisper lines.')}
              </div>
            ) : null}
          </div>
        );
        })
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  const language = useContext(UiLanguageContext);
  return (
    <div className="metric">
      <span className="muted small">{translateUiString(language, props.label)}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

async function handleEntityImport(
  event: ChangeEvent<HTMLInputElement>,
  entityType: EntityDraft['entity_type'],
  selectedEntityId: string | null,
  api: LyraApiClient,
  organizationId: string | null,
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
  uiLanguage: UiLanguage,
): Promise<void> {
  const file = event.target.files?.[0];
  if (file === undefined) {
    return;
  }

  const allowedMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const maxFileSizeBytes = 5 * 1024 * 1024;
  if (!allowedMimeTypes.has(file.type)) {
    setNotice({ type: 'error', message: translateUiString(uiLanguage, 'Only PNG, JPEG, and WebP are allowed.') });
    event.target.value = '';
    return;
  }
  if (file.size > maxFileSizeBytes) {
    setNotice({ type: 'error', message: translateUiString(uiLanguage, 'Image file is too large.') });
    event.target.value = '';
    return;
  }

  try {
    setImportingImage(true);
    const imageBase64 = await toDataUrl(file);
    const result = await api.importEntityImage({
      entity_type: entityType,
      ...(selectedEntityId === null ? {} : { entity_id: selectedEntityId }),
      image_base64: imageBase64,
    }, organizationId);
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
            candidate_token: result.tmp_image_token,
            source: 'upload',
          },
          ...(current[selectedEntityId] ?? []),
        ]).slice(0, 3),
      }));
      setUploadedReferenceSourceByEntityId((current) => ({
        ...current,
        [selectedEntityId]: result.tmp_image_token,
      }));
    }
    setNotice({ type: 'success', message: translateUiString(uiLanguage, 'Image analyzed. Generate preview next.') });
  } catch (error) {
    setNotice({ type: 'error', message: toMessage(error, uiLanguage) });
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
  const storyFullDraft = buildFullEpisodeStoryText({
    story_full_draft: episode.story_full_draft,
    introduction: episode.introduction,
    middle: episode.middle,
    climax: episode.climax,
    ending_hook: episode.ending_hook,
  });
  return {
    order: String(episode.order),
    title: episode.title ?? '',
    purpose: episode.purpose ?? '',
    story_input_mode: 'full',
    story_full_draft: storyFullDraft,
    introduction: '',
    middle: '',
    climax: '',
    ending_hook: '',
    estimated_pages: String(episode.estimated_pages),
    entities_involved: episode.entities_involved.join(', '),
    status: episode.status,
  };
}

function buildFullEpisodeStoryText(parts: {
  story_full_draft?: string | null;
  introduction?: string | null;
  middle?: string | null;
  climax?: string | null;
  ending_hook?: string | null;
}): string {
  const fullDraft = parts.story_full_draft?.trim();
  if (fullDraft !== undefined && fullDraft.length > 0) {
    return fullDraft;
  }

  return [parts.introduction, parts.middle, parts.climax, parts.ending_hook]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join('\n\n');
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

function toPanelFrameDraft(frame: PanelFrameRecord): PanelFrameDraft {
  const vertices = frame.vertices.slice(0, 4).map((vertex) => ({
    x: String(vertex.x),
    y: String(vertex.y),
  }));

  while (vertices.length < 4) {
    vertices.push({ x: '0', y: '0' });
  }

  return {
    id: frame.id,
    panel_id: frame.panel_id ?? '',
    reading_order: String(frame.reading_order),
    border_style: frame.border_style,
    border_width: String(frame.border_width),
    border_color: frame.border_color,
    z_index: String(frame.z_index),
    vertices,
  };
}

function toFramePreviewDefinition(draft: PanelFrameDraft): FramePreviewDefinition | undefined {
  const readingOrder = Number.parseInt(draft.reading_order, 10);
  const vertices = draft.vertices.flatMap((vertex) => {
    const x = Number.parseFloat(vertex.x);
    const y = Number.parseFloat(vertex.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return [];
    }

    return [{ x: clampFramePreviewCoordinate(x), y: clampFramePreviewCoordinate(y) }];
  });

  if (vertices.length < 3) {
    return undefined;
  }

  return {
    vertices,
    readingOrder: Number.isFinite(readingOrder) ? readingOrder : undefined,
    borderStyle: draft.border_style,
  };
}

function clampFramePreviewCoordinate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toWorkPayload(
  draft: WorkDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    title: draft.title,
    genre: nullableString(draft.genre),
    world_setting: nullableString(draft.world_setting),
    theme: nullableString(draft.theme),
    main_entity_ids: splitEntityIdCsv(draft.main_entity_ids, allowedEntityIds),
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

function toChapterPayload(
  draft: ChapterDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'chapter order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    starting_state: nullableString(draft.starting_state),
    ending_state: nullableString(draft.ending_state),
    emotion_curve: nullableString(draft.emotion_curve),
    entities_involved: splitEntityIdCsv(draft.entities_involved, allowedEntityIds),
    key_beats: splitLines(draft.key_beats),
    status: draft.status,
  };
}

function toCreateChapterPayload(
  draft: ChapterDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'chapter order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    starting_state: nullableString(draft.starting_state),
    ending_state: nullableString(draft.ending_state),
    emotion_curve: nullableString(draft.emotion_curve),
    entities_involved: splitEntityIdCsv(draft.entities_involved, allowedEntityIds),
    key_beats: splitLines(draft.key_beats),
  };
}

function toEpisodePayload(
  draft: EpisodeDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const storyFullDraft = buildFullEpisodeStoryText(draft);
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: 'full',
    story_full_draft: nullableString(storyFullDraft),
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    entities_involved: splitEntityIdCsv(draft.entities_involved, allowedEntityIds),
    status: draft.status,
  };
}

function toEpisodeAutosavePayload(draft: EpisodeDraft): Record<string, unknown> {
  const storyFullDraft = buildFullEpisodeStoryText(draft);
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: 'full',
    story_full_draft: nullableString(storyFullDraft),
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    status: draft.status,
  };
}

function toCreateEpisodePayload(
  draft: EpisodeDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  const storyFullDraft = buildFullEpisodeStoryText(draft);
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: 'full',
    story_full_draft: nullableString(storyFullDraft),
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    entities_involved: splitEntityIdCsv(draft.entities_involved, allowedEntityIds),
  };
}

function toEpisodeBaseDraftPayload(draft: EpisodeDraft): {
  title: string | null;
  purpose: string | null;
  story_input_mode: EpisodeDraft['story_input_mode'];
  story_full_draft: string | null;
  introduction: string | null;
  middle: string | null;
  climax: string | null;
  ending_hook: string | null;
} {
  const storyFullDraft = buildFullEpisodeStoryText(draft);
  return {
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: 'full',
    story_full_draft: nullableString(storyFullDraft),
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
  };
}

function applyStoryImprovementDraftToEpisodeDraft(
  draft: EpisodeDraft,
  improvement: StoryEpisodeImprovementRecord['draft'],
): EpisodeDraft {
  const storyFullDraft = buildFullEpisodeStoryText({
    story_full_draft: improvement.story_full_draft ?? draft.story_full_draft,
    introduction: improvement.introduction ?? draft.introduction,
    middle: improvement.middle ?? draft.middle,
    climax: improvement.climax ?? draft.climax,
    ending_hook: improvement.ending_hook ?? draft.ending_hook,
  });
  return {
    ...draft,
    story_input_mode: 'full',
    story_full_draft: storyFullDraft,
    introduction: '',
    middle: '',
    climax: '',
    ending_hook: '',
  };
}

function createEmptyStoryImprovementDraft(
  storyInputMode: EpisodeDraft['story_input_mode'],
): StoryEpisodeImprovementRecord['draft'] {
  return {
    title: null,
    purpose: null,
    story_input_mode: storyInputMode,
    story_full_draft: null,
    introduction: null,
    middle: null,
    climax: null,
    ending_hook: null,
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

function toScenePayload(
  draft: SceneDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'scene order'),
    location: nullableString(draft.location),
    time: nullableString(draft.time),
    atmosphere: nullableString(draft.atmosphere),
    involved_entity_ids: splitEntityIdCsv(draft.involved_entity_ids, allowedEntityIds),
    status: draft.status,
  };
}

function toSceneAutosavePayload(draft: SceneDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'scene order'),
    location: nullableString(draft.location),
    time: nullableString(draft.time),
    atmosphere: nullableString(draft.atmosphere),
    status: draft.status,
  };
}

function toCreateScenePayload(
  draft: SceneDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'scene order'),
    location: nullableString(draft.location),
    time: nullableString(draft.time),
    atmosphere: nullableString(draft.atmosphere),
    involved_entity_ids: splitEntityIdCsv(draft.involved_entity_ids, allowedEntityIds),
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
    dialogue: draft.dialogues.map((dialogue, index) => {
      const entityId = dialogue.entity_id.trim();
      if (requiresPanelDialogueSpeaker(dialogue.type) && entityId.length === 0) {
        throw new Error(`Line ${index + 1}: speaker is required for ${dialogue.type}`);
      }

      return {
        entity_id: entityId.length === 0 ? null : entityId,
        text: requiredString(dialogue.text, 'dialogue text'),
        type: dialogue.type,
        position: dialogue.position,
      };
    }),
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

function toPanelFramePayload(draft: PanelFrameDraft): Record<string, unknown> {
  const borderColor = draft.border_color.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(borderColor)) {
    throw new Error('border color must be a hex color');
  }

  const payload: Record<string, unknown> = {
    panel_id: nullableUuidString(draft.panel_id, 'linked panel'),
    vertices: draft.vertices.slice(0, 4).map((vertex, index) => ({
      x: parseBoundedNumberInput(vertex.x, `vertex ${index + 1} x`, 0, 1),
      y: parseBoundedNumberInput(vertex.y, `vertex ${index + 1} y`, 0, 1),
    })),
    border_style: draft.border_style,
    border_width: parseIntegerInRangeInput(draft.border_width, 'border width', 0, 20),
    border_color: borderColor,
    z_index: parseIntegerInRangeInput(draft.z_index, 'z-index', 0, 1000),
    reading_order: parseIntegerInRangeInput(draft.reading_order, 'reading order', 1, 1000),
  };

  const frameId = draft.id.trim();
  if (frameId.length > 0) {
    payload.id = frameId;
  }

  return payload;
}

function toPanelFramesPayload(drafts: PanelFrameDraft[]): Record<string, unknown> {
  return {
    frames: drafts.map(toPanelFramePayload),
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
    story_input_mode: 'full',
    story_full_draft: '',
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

function requiresPanelDialogueSpeaker(type: PanelDialogueDraft['type']): boolean {
  return type === 'speech' || type === 'thought' || type === 'shout' || type === 'whisper';
}

function toPageSettingsDraft(page: PageRecord): PageSettingsDraft {
  const layoutConfig = toRecord(page.layout_config);
  const styleReference = toRecord(layoutConfig.style_reference);
  const dialogueMode = page.page_dialogue_toggle === false || page.dialogue_mode === 'balloon_only'
    ? 'balloon_only'
    : page.dialogue_mode;
  return {
    dialogue_mode: dialogueMode,
    page_dialogue_toggle: dialogueMode !== 'balloon_only',
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
  const location = scene.location ?? (uiLanguage === 'ja' ? '\u5834\u6240\u672a\u8a2d\u5b9a' : 'Unknown location');
  const parts = [(uiLanguage === 'ja' ? '\u30b7\u30fc\u30f3' : 'Scene') + ' ' + String(scene.order), location];
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

function parseGenericStructuredFieldRows(value: string): GenericStructuredFieldRow[] {
  const parsed = parseJson<Record<string, unknown>>(value);
  return Object.entries(parsed).map(([key, entry]) => ({
    key,
    value: stringifyGenericStructuredFieldValue(entry),
  }));
}

function serializeGenericStructuredFieldRows(rows: GenericStructuredFieldRow[]): string {
  const fields: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key.length === 0) {
      continue;
    }
    fields[key] = row.value.trim();
  }

  return JSON.stringify(fields, null, 2);
}

function stringifyGenericStructuredFieldValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry !== 'object' || entry === null)) {
    return value.map((entry) => String(entry)).join(', ');
  }

  return JSON.stringify(value);
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
  const aliases = Array.isArray(characterIdentity.aliases)
    ? characterIdentity.aliases.filter((entry): entry is string => typeof entry === 'string').join(', ')
    : '';

  return {
    aliases,
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
  const aliases = splitCsv(value.aliases);
  if (aliases.length > 0) {
    characterIdentity.aliases = aliases;
  }
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
  ['stoic_reserved', 'Stoic reserved'],
  ['rugged_calm', 'Rugged calm'],
  ['sharp_elite', 'Sharp elite'],
  ['playful_confident', 'Playful confident'],
  ['mature_composed', 'Mature composed'],
];
const CHARACTER_STANDING_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['upright_neat', 'Upright neat'],
  ['natural_relaxed', 'Natural relaxed'],
  ['shy_reserved', 'Shy reserved'],
  ['confident_open', 'Confident open'],
  ['still_quiet', 'Still quiet'],
  ['arms_crossed', 'Arms crossed'],
  ['hands_in_pockets', 'Hands in pockets'],
  ['guarded_stance', 'Guarded stance'],
  ['wide_grounded_stance', 'Wide grounded stance'],
  ['elegant_upright', 'Elegant upright'],
];
const CHARACTER_DEFAULT_EXPRESSION_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['soft_smile', 'Soft smile'],
  ['calm_neutral', 'Calm neutral'],
  ['serious_focus', 'Serious focus'],
  ['cheerful_smile', 'Cheerful smile'],
  ['shy_reserved', 'Shy reserved'],
  ['cool_unfazed', 'Cool unfazed'],
  ['stern_look', 'Stern look'],
  ['tired_neutral', 'Tired neutral'],
  ['confident_smirk', 'Confident smirk'],
  ['bored_gaze', 'Bored gaze'],
  ['teasing_smile', 'Teasing smile'],
];
const CHARACTER_BUILD_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['petite', 'Petite'],
  ['slender', 'Slender'],
  ['average', 'Average'],
  ['athletic', 'Athletic'],
  ['muscular', 'Muscular'],
  ['curvy', 'Curvy'],
  ['lean', 'Lean'],
  ['stocky', 'Stocky'],
  ['broad', 'Broad build'],
  ['large', 'Large build'],
];
const CHARACTER_HEIGHT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['very_short_height', 'Very short height'],
  ['short', 'Short'],
  ['average', 'Average'],
  ['tall', 'Tall'],
  ['very_tall_height', 'Very tall height'],
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
  ['dark_brown', 'Dark brown'],
  ['blonde', 'Blonde'],
  ['ash_blonde', 'Ash blonde'],
  ['auburn', 'Auburn'],
  ['silver', 'Silver'],
  ['gray', 'Gray'],
  ['white', 'White'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['red', 'Red'],
  ['pink', 'Pink'],
  ['purple', 'Purple'],
  ['two_tone', 'Two tone'],
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
  ['tousled', 'Tousled'],
  ['spiky', 'Spiky'],
  ['fluffy', 'Fluffy'],
  ['slick', 'Slick'],
  ['coarse', 'Coarse'],
  ['shaved', 'Shaved'],
];
const CHARACTER_HAIR_ARRANGEMENT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['down', 'Down'],
  ['short_cut', 'Short cut'],
  ['buzz_cut', 'Buzz cut'],
  ['crew_cut', 'Crew cut'],
  ['two_block', 'Two block'],
  ['undercut', 'Undercut'],
  ['fade_cut', 'Fade cut'],
  ['side_part', 'Side part'],
  ['center_part', 'Center part'],
  ['comma_hair', 'Comma hair'],
  ['slick_back', 'Slick back'],
  ['messy_short', 'Messy short'],
  ['pompadour', 'Pompadour'],
  ['short_bob', 'Short bob'],
  ['medium_layered', 'Medium layered'],
  ['wolf_cut', 'Wolf cut'],
  ['long_straight', 'Long straight'],
  ['ponytail', 'Ponytail'],
  ['side_ponytail', 'Side ponytail'],
  ['twin_tails', 'Twin tails'],
  ['bun', 'Bun'],
  ['man_bun', 'Man bun'],
  ['topknot', 'Topknot'],
  ['braid', 'Braid'],
  ['half_up', 'Half up'],
  ['tied_back', 'Tied back'],
  ['shaved_sides', 'Shaved sides'],
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
const CHARACTER_EYE_SIZE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['small eyes', 'small eyes'],
  ['balanced eyes', 'balanced eyes'],
  ['large eyes', 'large eyes'],
  ['very large eyes', 'very large eyes'],
];
const CHARACTER_EYE_ANGLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['level eye line', 'level eye line'],
  ['slightly upturned eyes', 'slightly upturned eyes'],
  ['strongly upturned eyes', 'strongly upturned eyes'],
  ['slightly downturned eyes', 'slightly downturned eyes'],
  ['drooping eyes', 'drooping eyes'],
];
const CHARACTER_PUPIL_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['small pupils', 'small pupils'],
  ['large pupils', 'large pupils'],
  ['sharp pupils', 'sharp pupils'],
  ['soft round pupils', 'soft round pupils'],
  ['bright reflective pupils', 'bright reflective pupils'],
];
const CHARACTER_UNDER_EYE_DETAIL_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['none visible', 'none visible'],
  ['soft shadows', 'soft shadows'],
  ['defined lower lash line', 'defined lower lash line'],
  ['slight eye bags', 'slight eye bags'],
  ['heavy eye bags', 'heavy eye bags'],
];
const CHARACTER_MOUTH_DEFAULT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['closed neutral mouth', 'closed neutral mouth'],
  ['slight smile', 'slight smile'],
  ['firm straight mouth', 'firm straight mouth'],
  ['soft parted lips', 'soft parted lips'],
];
const CHARACTER_HAIR_BANGS_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['none', 'None'],
  ['light', 'Light'],
  ['standard', 'Standard'],
  ['heavy', 'Heavy'],
  ['side_swept', 'Side swept'],
  ['blunt', 'Blunt'],
  ['parted', 'Parted'],
  ['center_parted', 'Center parted'],
  ['curtain', 'Curtain'],
  ['messy_bangs', 'Messy bangs'],
  ['short_bangs', 'Short bangs'],
  ['long_bangs', 'Long bangs'],
];
const CHARACTER_HAIR_FRONT_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['straight front line', 'straight front line'],
  ['center-parted front', 'center-parted front'],
  ['rounded front curve', 'rounded front curve'],
  ['side-swept front', 'side-swept front'],
  ['blunt front', 'blunt front'],
  ['short textured front', 'short textured front'],
  ['comma front', 'comma front'],
  ['curtain front', 'curtain front'],
  ['messy front', 'messy front'],
  ['swept-up front', 'swept-up front'],
];
const CHARACTER_HAIR_SIDE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['short side locks', 'short side locks'],
  ['soft cheek framing', 'soft cheek framing'],
  ['long side locks', 'long side locks'],
  ['tucked behind ears', 'tucked behind ears'],
  ['trimmed sides', 'trimmed sides'],
  ['faded sides', 'faded sides'],
  ['shaved sides', 'shaved sides'],
  ['sideburns', 'sideburns'],
  ['ear-length sides', 'ear-length sides'],
];
const CHARACTER_HAIR_BACK_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['clean bob back', 'clean bob back'],
  ['layered back', 'layered back'],
  ['straight long back', 'straight long back'],
  ['ponytail fall', 'ponytail fall'],
  ['braided back', 'braided back'],
  ['tapered nape', 'tapered nape'],
  ['short clipped back', 'short clipped back'],
  ['undercut back', 'undercut back'],
  ['tied-back hair', 'tied-back hair'],
  ['long loose back', 'long loose back'],
  ['wolf nape', 'wolf nape'],
];
const CHARACTER_CLOTHING_CATEGORY_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['military', 'Military'],
  ['school', 'School'],
  ['casual', 'Casual'],
  ['suit', 'Suit'],
  ['business_casual', 'Business casual'],
  ['lab_coat', 'Lab coat'],
  ['trench_coat', 'Trench coat'],
  ['tactical', 'Tactical'],
  ['traditional_formal', 'Traditional formal'],
  ['street_jacket', 'Street jacket'],
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
const CHARACTER_COLLAR_SHAPE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['round collar', 'round collar'],
  ['sharp collar', 'sharp collar'],
  ['standing collar', 'standing collar'],
  ['sailor collar', 'sailor collar'],
  ['hooded neckline', 'hooded neckline'],
];
const CHARACTER_SLEEVE_LENGTH_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['sleeveless', 'Sleeveless'],
  ['short sleeves', 'Short sleeves'],
  ['three-quarter sleeves', 'Three-quarter sleeves'],
  ['long sleeves', 'Long sleeves'],
  ['wide sleeves', 'Wide sleeves'],
];
const CHARACTER_LOWER_GARMENT_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['short skirt', 'Short skirt'],
  ['long skirt', 'Long skirt'],
  ['straight pants', 'Straight pants'],
  ['wide pants', 'Wide pants'],
  ['slacks', 'Slacks'],
  ['jeans', 'Jeans'],
  ['cargo pants', 'Cargo pants'],
  ['shorts', 'Shorts'],
];
const CHARACTER_SHOES_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['loafers', 'Loafers'],
  ['sneakers', 'Sneakers'],
  ['boots', 'Boots'],
  ['dress shoes', 'Dress shoes'],
  ['combat boots', 'Combat boots'],
  ['heels', 'Heels'],
  ['school shoes', 'School shoes'],
];
const CHARACTER_LEGWEAR_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['bare legs', 'Bare legs'],
  ['ankle socks', 'Ankle socks'],
  ['knee socks', 'Knee socks'],
  ['thigh-high socks', 'Thigh-high socks'],
  ['tights', 'Tights'],
];
const CHARACTER_CLOTHING_DETAIL_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['simple uniform detailing', 'Simple uniform detailing'],
  ['layered practical details', 'Layered practical details'],
  ['ornamental trim', 'Ornamental trim'],
  ['combat utility details', 'Combat utility details'],
  ['minimal clean design', 'Minimal clean design'],
];
const CHARACTER_ART_STYLE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['anime', 'Anime'],
  ['semi_realistic', 'Semi-realistic'],
  ['manga', 'Manga'],
  ['painterly', 'Painterly'],
];
const CHARACTER_VISUAL_ANCHOR_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['Face + hair balance', 'Face + hair balance'],
  ['Eye line', 'Eye line'],
  ['Silhouette outline', 'Silhouette outline'],
  ['Posture read', 'Posture read'],
  ['Outfit shape', 'Outfit shape'],
  ['Color blocking', 'Color blocking'],
  ['Accessory / prop', 'Accessory / prop'],
  ['custom', 'Custom'],
];
const CHARACTER_SIGNATURE_FEATURE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['Hair shape', 'Hair shape'],
  ['Eye color contrast', 'Eye color contrast'],
  ['Expression gap', 'Expression gap'],
  ['Silhouette edge', 'Silhouette edge'],
  ['Accessory', 'Accessory'],
  ['Scar / mark', 'Scar / mark'],
  ['Stance', 'Stance'],
  ['custom', 'Custom'],
];
const CHARACTER_SILHOUETTE_KEYWORD_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['Compact silhouette', 'Compact silhouette'],
  ['Tall and slender', 'Tall and slender'],
  ['Broad-shouldered', 'Broad-shouldered'],
  ['Long coat outline', 'Long coat outline'],
  ['Skirt line', 'Skirt line'],
  ['Military block', 'Military block'],
  ['Soft rounded outline', 'Soft rounded outline'],
  ['custom', 'Custom'],
];
const CHARACTER_DISTINGUISHING_FEATURE_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['Beauty mark', 'Beauty mark'],
  ['Scar', 'Scar'],
  ['Eye bags', 'Eye bags'],
  ['Fang', 'Fang'],
  ['Ahoge', 'Ahoge'],
  ['Hair streak', 'Hair streak'],
  ['Glasses', 'Glasses'],
  ['Stubble', 'Stubble'],
  ['Beard', 'Beard'],
  ['Goatee', 'Goatee'],
  ['Earrings', 'Earrings'],
  ['Thick eyebrows', 'Thick eyebrows'],
  ['Sharp jawline', 'Sharp jawline'],
  ['custom', 'Custom'],
];
const CHARACTER_HEAD_RATIO_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['about six heads tall', 'about six heads tall'],
  ['about six and a half heads tall', 'about six and a half heads tall'],
  ['about seven heads tall', 'about seven heads tall'],
  ['about seven and a half heads tall', 'about seven and a half heads tall'],
  ['about eight heads tall', 'about eight heads tall'],
  ['custom', 'Custom'],
];
const CHARACTER_SHOULDER_WIDTH_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['narrow shoulders', 'narrow shoulders'],
  ['balanced shoulders', 'balanced shoulders'],
  ['broad shoulders', 'broad shoulders'],
  ['custom', 'Custom'],
];
const CHARACTER_LEG_LENGTH_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['short legs', 'short legs'],
  ['balanced leg length', 'balanced leg length'],
  ['long legs', 'long legs'],
  ['custom', 'Custom'],
];
const CHARACTER_POSTURE_AXIS_OPTIONS: Array<[string, string]> = [
  EMPTY_OPTION,
  ['centered and straight', 'centered and straight'],
  ['slightly forward-leaning', 'slightly forward-leaning'],
  ['slightly backward-leaning', 'slightly backward-leaning'],
  ['soft inward posture', 'soft inward posture'],
  ['open outward posture', 'open outward posture'],
  ['custom', 'Custom'],
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
  ['stacked_wide_4', 'Stacked wide 4'],
  ['top_wide_3', 'Top wide 3'],
  ['standard_6', 'Standard 6'],
  ['dense_8', 'Dense 8'],
  ['climax_2', 'Climax 2'],
  ['splash_1', 'Splash 1'],
  ['action_5', 'Action 5'],
  ['battle_7', 'Battle 7'],
  ['vertical_2', 'Vertical 2'],
  ['bottom_wide_3', 'Bottom wide 3'],
  ['wide_top_4', 'Wide top 4'],
  ['wide_bottom_4', 'Wide bottom 4'],
  ['tall_left_4', 'Tall left 4'],
  ['right_tall_4', 'Right tall 4'],
  ['balanced_5', 'Balanced 5'],
  ['middle_wide_5', 'Middle wide 5'],
  ['top_wide_5', 'Top wide 5'],
  ['split_6', 'Split 6'],
];
const FRAME_TEMPLATE_PANEL_COUNTS: Record<string, number> = {
  standard_4: 4,
  stacked_wide_4: 4,
  top_wide_3: 3,
  standard_6: 6,
  dense_8: 8,
  climax_2: 2,
  splash_1: 1,
  action_5: 5,
  battle_7: 7,
  vertical_2: 2,
  bottom_wide_3: 3,
  wide_top_4: 4,
  wide_bottom_4: 4,
  tall_left_4: 4,
  right_tall_4: 4,
  balanced_5: 5,
  middle_wide_5: 5,
  top_wide_5: 5,
  split_6: 6,
};
const CUSTOM_FRAME_TEMPLATE_ID = '__custom__';
const FRAME_PREVIEW_COORDINATE_TOLERANCE = 0.001;
const FRAME_TEMPLATE_LABELS = Object.fromEntries(FRAME_TEMPLATE_OPTIONS) as Record<string, string>;
const FRAME_TEMPLATE_PREVIEWS: Record<string, FramePreviewDefinition[]> = {
  standard_4: [
    framePreviewRect(0.5, 0, 1, 0.5),
    framePreviewRect(0, 0, 0.5, 0.5),
    framePreviewRect(0.5, 0.5, 1, 1),
    framePreviewRect(0, 0.5, 0.5, 1),
  ],
  stacked_wide_4: [
    framePreviewRect(0, 0, 1, 0.25),
    framePreviewRect(0, 0.25, 1, 0.5),
    framePreviewRect(0, 0.5, 1, 0.75),
    framePreviewRect(0, 0.75, 1, 1),
  ],
  top_wide_3: [
    framePreviewRect(0, 0, 1, 0.5),
    framePreviewRect(0.5, 0.5, 1, 1),
    framePreviewRect(0, 0.5, 0.5, 1),
  ],
  standard_6: [
    framePreviewRect(2 / 3, 0, 1, 0.5),
    framePreviewRect(1 / 3, 0, 2 / 3, 0.5),
    framePreviewRect(0, 0, 1 / 3, 0.5),
    framePreviewRect(2 / 3, 0.5, 1, 1),
    framePreviewRect(1 / 3, 0.5, 2 / 3, 1),
    framePreviewRect(0, 0.5, 1 / 3, 1),
  ],
  dense_8: [
    framePreviewRect(0.75, 0, 1, 0.5),
    framePreviewRect(0.5, 0, 0.75, 0.5),
    framePreviewRect(0.25, 0, 0.5, 0.5),
    framePreviewRect(0, 0, 0.25, 0.5),
    framePreviewRect(0.75, 0.5, 1, 1),
    framePreviewRect(0.5, 0.5, 0.75, 1),
    framePreviewRect(0.25, 0.5, 0.5, 1),
    framePreviewRect(0, 0.5, 0.25, 1),
  ],
  climax_2: [
    framePreviewRect(0.5, 0, 1, 1),
    framePreviewRect(0, 0, 0.5, 1),
  ],
  splash_1: [framePreviewRect(0, 0, 1, 1)],
  action_5: [
    framePreviewRect(0.35, 0, 1, 0.32),
    framePreviewRect(0.675, 0.32, 1, 0.66),
    framePreviewRect(0.35, 0.32, 0.675, 0.66),
    framePreviewRect(0.35, 0.66, 1, 1),
    framePreviewRect(0, 0, 0.35, 1),
  ],
  battle_7: [
    framePreviewQuad({ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.28 }, { x: 0.63, y: 0.32 }),
    framePreviewQuad({ x: 0.35, y: 0 }, { x: 0.7, y: 0 }, { x: 0.63, y: 0.32 }, { x: 0.28, y: 0.32 }),
    framePreviewQuad({ x: 0, y: 0 }, { x: 0.35, y: 0 }, { x: 0.28, y: 0.32 }, { x: 0, y: 0.28 }),
    framePreviewQuad({ x: 0.63, y: 0.32 }, { x: 1, y: 0.28 }, { x: 1, y: 0.66 }, { x: 0.56, y: 0.68 }),
    framePreviewQuad({ x: 0, y: 0.28 }, { x: 0.63, y: 0.32 }, { x: 0.56, y: 0.68 }, { x: 0, y: 0.66 }),
    framePreviewQuad({ x: 0.5, y: 0.68 }, { x: 1, y: 0.66 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }),
    framePreviewQuad({ x: 0, y: 0.66 }, { x: 0.5, y: 0.68 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }),
  ],
  vertical_2: [
    framePreviewRect(0, 0, 1, 0.48),
    framePreviewRect(0, 0.48, 1, 1),
  ],
  bottom_wide_3: [
    framePreviewRect(0.5, 0, 1, 0.5),
    framePreviewRect(0, 0, 0.5, 0.5),
    framePreviewRect(0, 0.5, 1, 1),
  ],
  wide_top_4: [
    framePreviewRect(0, 0, 1, 0.42),
    framePreviewRect(2 / 3, 0.42, 1, 1),
    framePreviewRect(1 / 3, 0.42, 2 / 3, 1),
    framePreviewRect(0, 0.42, 1 / 3, 1),
  ],
  wide_bottom_4: [
    framePreviewRect(2 / 3, 0, 1, 0.58),
    framePreviewRect(1 / 3, 0, 2 / 3, 0.58),
    framePreviewRect(0, 0, 1 / 3, 0.58),
    framePreviewRect(0, 0.58, 1, 1),
  ],
  tall_left_4: [
    framePreviewRect(0.42, 0, 1, 1 / 3),
    framePreviewRect(0.42, 1 / 3, 1, 2 / 3),
    framePreviewRect(0.42, 2 / 3, 1, 1),
    framePreviewRect(0, 0, 0.42, 1),
  ],
  right_tall_4: [
    framePreviewRect(0.58, 0, 1, 1),
    framePreviewRect(0, 0, 0.58, 1 / 3),
    framePreviewRect(0, 1 / 3, 0.58, 2 / 3),
    framePreviewRect(0, 2 / 3, 0.58, 1),
  ],
  balanced_5: [
    framePreviewRect(0.5, 0, 1, 0.44),
    framePreviewRect(0, 0, 0.5, 0.44),
    framePreviewRect(2 / 3, 0.44, 1, 1),
    framePreviewRect(1 / 3, 0.44, 2 / 3, 1),
    framePreviewRect(0, 0.44, 1 / 3, 1),
  ],
  middle_wide_5: [
    framePreviewRect(0.5, 0, 1, 0.3),
    framePreviewRect(0, 0, 0.5, 0.3),
    framePreviewRect(0, 0.3, 1, 0.68),
    framePreviewRect(0.5, 0.68, 1, 1),
    framePreviewRect(0, 0.68, 0.5, 1),
  ],
  top_wide_5: [
    framePreviewRect(0, 0, 1, 0.34),
    framePreviewRect(0.5, 0.34, 1, 0.67),
    framePreviewRect(0, 0.34, 0.5, 0.67),
    framePreviewRect(0.5, 0.67, 1, 1),
    framePreviewRect(0, 0.67, 0.5, 1),
  ],
  split_6: [
    framePreviewRect(0.48, 0, 1, 1 / 3),
    framePreviewRect(0.48, 1 / 3, 1, 2 / 3),
    framePreviewRect(0.48, 2 / 3, 1, 1),
    framePreviewRect(0, 0, 0.48, 1 / 3),
    framePreviewRect(0, 1 / 3, 0.48, 2 / 3),
    framePreviewRect(0, 2 / 3, 0.48, 1),
  ],
};
function resolveFrameTemplateSelection(
  layoutConfig: Record<string, unknown>,
  panelCount: number,
  frameCount: number,
  frameDrafts: PanelFrameDraft[],
): string {
  if (panelCount > 0 && panelCount === frameCount) {
    const templateId = typeof layoutConfig.template_id === 'string' ? layoutConfig.template_id : null;
    if (templateId !== null) {
      const templatePanelCount = FRAME_TEMPLATE_PANEL_COUNTS[templateId];
      if (templatePanelCount === panelCount) {
        if (
          frameDrafts.length === panelCount &&
          !doFrameDraftsMatchTemplate(frameDrafts, templateId)
        ) {
          return CUSTOM_FRAME_TEMPLATE_ID;
        }
        return templateId;
      }
      if (templatePanelCount !== undefined) {
        return CUSTOM_FRAME_TEMPLATE_ID;
      }
    }

    return CUSTOM_FRAME_TEMPLATE_ID;
  }

  const fallbackTemplateId = typeof layoutConfig.template_id === 'string' ? layoutConfig.template_id : null;
  return fallbackTemplateId !== null && FRAME_TEMPLATE_PANEL_COUNTS[fallbackTemplateId] !== undefined
    ? fallbackTemplateId
    : CUSTOM_FRAME_TEMPLATE_ID;
}

function doFrameDraftsMatchTemplate(frameDrafts: PanelFrameDraft[], templateId: string): boolean {
  const expectedFrames = FRAME_TEMPLATE_PREVIEWS[templateId];
  if (expectedFrames === undefined || expectedFrames.length !== frameDrafts.length) {
    return false;
  }

  const actualFrames = frameDrafts
    .map(toFramePreviewDefinition)
    .filter(isDefined)
    .sort((left, right) => (left.readingOrder ?? 0) - (right.readingOrder ?? 0));

  if (actualFrames.length !== expectedFrames.length) {
    return false;
  }

  return expectedFrames.every((expectedFrame, index) =>
    areFramePreviewVerticesEqual(actualFrames[index]?.vertices ?? [], expectedFrame.vertices),
  );
}

function areFramePreviewVerticesEqual(
  actualVertices: Array<{ x: number; y: number }>,
  expectedVertices: Array<{ x: number; y: number }>,
): boolean {
  if (actualVertices.length !== expectedVertices.length) {
    return false;
  }

  return expectedVertices.every((expectedVertex, index) => {
    const actualVertex = actualVertices[index];
    return (
      actualVertex !== undefined &&
      Math.abs(actualVertex.x - expectedVertex.x) <= FRAME_PREVIEW_COORDINATE_TOLERANCE &&
      Math.abs(actualVertex.y - expectedVertex.y) <= FRAME_PREVIEW_COORDINATE_TOLERANCE
    );
  });
}

function getFrameTemplateDisplayLabel(language: UiLanguage, templateId: string): string {
  if (templateId === CUSTOM_FRAME_TEMPLATE_ID) {
    return translateUiString(language, 'Custom / unsynced');
  }

  return translateUiString(language, FRAME_TEMPLATE_LABELS[templateId] ?? templateId);
}

function framePreviewRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): FramePreviewDefinition {
  return {
    vertices: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
  };
}

function framePreviewQuad(
  topLeft: { x: number; y: number },
  topRight: { x: number; y: number },
  bottomRight: { x: number; y: number },
  bottomLeft: { x: number; y: number },
): FramePreviewDefinition {
  return { vertices: [topLeft, topRight, bottomRight, bottomLeft] };
}

function getFramePreviewCenter(vertices: Array<{ x: number; y: number }>): { x: number; y: number } {
  const totals = vertices.reduce(
    (current, vertex) => ({
      x: current.x + vertex.x,
      y: current.y + vertex.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: totals.x / vertices.length,
    y: totals.y / vertices.length,
  };
}
const FRAME_BORDER_STYLE_OPTIONS: Array<[PanelFrameRecord['border_style'], string]> = [
  ['solid', 'Solid'],
  ['dashed', 'Dashed'],
  ['none', 'None'],
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

function parseBoundedNumberInput(value: string, label: string, min: number, max: number): number {
  const parsed = parseNumberInput(value, label);
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }

  return parsed;
}

function parseIntegerInRangeInput(value: string, label: string, min: number, max: number): number {
  const parsed = parseBoundedNumberInput(value, label, min, max);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }

  return parsed;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function splitEntityIdCsv(
  value: string,
  allowedEntityIds?: ReadonlySet<string>,
): string[] {
  const ids = splitCsv(value);
  const filteredIds =
    allowedEntityIds === undefined
      ? ids
      : ids.filter((id) => allowedEntityIds.has(id));

  return [...new Set(filteredIds)];
}

function dedupeReferenceCandidates(candidates: ReferenceCandidate[]): ReferenceCandidate[] {
  const seenKeys = new Set<string>();

  return candidates.filter((candidate) => {
    if (seenKeys.has(candidate.candidate_token)) {
      return false;
    }

    seenKeys.add(candidate.candidate_token);
    return true;
  });
}

function sameReferenceCandidates(left: ReferenceCandidate[], right: ReferenceCandidate[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (candidate, index) =>
        candidate.candidate_token === right[index]?.candidate_token &&
        candidate.source === right[index]?.source,
    )
  );
}

function extractGeneratedReferenceCandidates(job: GenerationJobRecord): ReferenceCandidate[] {
  if (
    job.job_type !== 'entity_generate' ||
    job.status !== 'completed' ||
    !Array.isArray(job.result?.candidates)
  ) {
    return [];
  }

  if (job.result.provider_result === false) {
    return [];
  }

  return (job.result.candidates as unknown[]).flatMap((candidate) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof (candidate as { candidate_token?: unknown }).candidate_token !== 'string'
    ) {
      return [];
    }

    return [
      {
        candidate_token: (candidate as { candidate_token: string }).candidate_token,
        source: 'generated' as const,
      },
    ];
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

function toMessage(error: unknown, language: UiLanguage = 'en'): string {
  return formatUserFacingError(error, language);
}

function isApiStatus(error: unknown, status: number): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return false;
  }

  return (error as { status?: unknown }).status === status;
}

function useStoredString(
  storage: Storage,
  storageKey: string,
  fallbackValue: string,
): [string, (nextValue: string) => void] {
  const [value, setValue] = useState(() => storage.getItem(storageKey) ?? fallbackValue);

  useEffect(() => {
    const nextValue = storage.getItem(storageKey) ?? fallbackValue;
    setValue((current) => (current === nextValue ? current : nextValue));
  }, [fallbackValue, storage, storageKey]);

  const updateValue = useCallback((nextValue: string): void => {
    setValue((current) => (current === nextValue ? current : nextValue));
    if (storage.getItem(storageKey) !== nextValue) {
      storage.setItem(storageKey, nextValue);
    }
  }, [storage, storageKey]);

  return [value, updateValue];
}

function scopedStorageKey(baseKey: string, scope: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9:_-]/gu, '_').slice(0, 160);
  return `${baseKey}:${safeScope.length === 0 ? 'session' : safeScope}`;
}

function redirectToExternalUrl(value: string): void {
  const url = new URL(value, window.location.origin);
  if (url.protocol !== 'https:') {
    throw new Error('Redirect URL is invalid');
  }

  window.location.assign(url.toString());
}

function createBillingReturnMarker(
  kind: BillingReturnMarker['kind'],
  balance: BillingBalanceRecord | undefined,
  details: Pick<
    BillingReturnMarker,
    | 'planCode'
    | 'packageCode'
    | 'organizationId'
    | 'initialOrganizationPlanCode'
    | 'initialOrganizationTotalCredits'
    | 'initialOrganizationPurchasedCredits'
  > = {},
): BillingReturnMarker {
  return {
    kind,
    createdAt: Date.now(),
    planCode: details.planCode,
    packageCode: details.packageCode,
    organizationId: details.organizationId,
    initialPlanCode: balance?.plan_code,
    initialTotalCredits: balance?.total_credits,
    initialPurchasedCredits: balance?.purchased_credits,
    initialOrganizationPlanCode: details.initialOrganizationPlanCode,
    initialOrganizationTotalCredits: details.initialOrganizationTotalCredits,
    initialOrganizationPurchasedCredits: details.initialOrganizationPurchasedCredits,
  };
}

function isConsumerSubscriptionCheckoutPlanCode(value: unknown): value is ConsumerSubscriptionCheckoutPlanCode {
  return value === 'standard' || value === 'premium';
}

function isEnterpriseSubscriptionCheckoutPlanCode(value: unknown): value is EnterprisePlanCode {
  return value === 'enterprise_a' || value === 'enterprise_b' || value === 'enterprise_c';
}

function isSubscriptionCheckoutPlanCode(value: unknown): value is SubscriptionCheckoutPlanCode {
  return isConsumerSubscriptionCheckoutPlanCode(value) || isEnterpriseSubscriptionCheckoutPlanCode(value);
}

function isSubscriptionPlanCode(value: unknown): value is SubscriptionPlanCode {
  return value === 'free' || isSubscriptionCheckoutPlanCode(value);
}

function getConsumerPlanMonthlyCredits(planCode: SubscriptionCheckoutPlanCode | undefined): number | null {
  if (!isConsumerSubscriptionCheckoutPlanCode(planCode)) {
    return null;
  }
  return subscriptionPurchaseOptions.find((plan) => plan.code === planCode)?.credits ?? null;
}

function readBillingReturnMarker(value: string | null): BillingReturnMarker | null {
  if (value === null) {
    return null;
  }

  if (value === '1') {
    return { kind: 'portal', createdAt: Date.now() };
  }

  try {
    const parsed = JSON.parse(value) as Partial<BillingReturnMarker>;
    if (parsed.kind !== 'subscription' && parsed.kind !== 'credits' && parsed.kind !== 'portal') {
      return null;
    }

    return {
      kind: parsed.kind,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      planCode: isSubscriptionCheckoutPlanCode(parsed.planCode) ? parsed.planCode : undefined,
      packageCode:
        parsed.packageCode === 'credits_200' || parsed.packageCode === 'credits_1000' || parsed.packageCode === 'credits_3000'
          ? parsed.packageCode
          : undefined,
      organizationId: typeof parsed.organizationId === 'string' && parsed.organizationId.trim().length > 0
        ? parsed.organizationId
        : undefined,
      initialPlanCode: isSubscriptionPlanCode(parsed.initialPlanCode) ? parsed.initialPlanCode : undefined,
      initialTotalCredits: typeof parsed.initialTotalCredits === 'number' ? parsed.initialTotalCredits : undefined,
      initialPurchasedCredits: typeof parsed.initialPurchasedCredits === 'number' ? parsed.initialPurchasedCredits : undefined,
      initialOrganizationPlanCode: isEnterpriseSubscriptionCheckoutPlanCode(parsed.initialOrganizationPlanCode)
        ? parsed.initialOrganizationPlanCode
        : undefined,
      initialOrganizationTotalCredits:
        typeof parsed.initialOrganizationTotalCredits === 'number' ? parsed.initialOrganizationTotalCredits : undefined,
      initialOrganizationPurchasedCredits:
        typeof parsed.initialOrganizationPurchasedCredits === 'number' ? parsed.initialOrganizationPurchasedCredits : undefined,
    };
  } catch {
    return null;
  }
}
function isBillingReturnSatisfied(
  balance: BillingBalanceRecord | undefined,
  marker: BillingReturnMarker,
  organizationState: {
    planCode: EnterprisePlanCode | null;
    totalCredits: number | null;
    purchasedCredits: number | null;
  },
): boolean {
  if (marker.organizationId !== undefined) {
    if (marker.kind === 'subscription' && isEnterpriseSubscriptionCheckoutPlanCode(marker.planCode)) {
      return organizationState.planCode === marker.planCode;
    }

    if (marker.kind === 'credits') {
      if (
        marker.initialOrganizationPurchasedCredits !== undefined &&
        organizationState.purchasedCredits !== null &&
        organizationState.purchasedCredits > marker.initialOrganizationPurchasedCredits
      ) {
        return true;
      }
      if (
        marker.initialOrganizationTotalCredits !== undefined &&
        organizationState.totalCredits !== null &&
        organizationState.totalCredits > marker.initialOrganizationTotalCredits
      ) {
        return true;
      }
      return false;
    }

    return Date.now() - marker.createdAt >= billingReturnVerificationIntervalMs;
  }

  if (balance === undefined) {
    return false;
  }

  if (marker.kind === 'subscription' && marker.planCode !== undefined) {
    if (balance.plan_code !== marker.planCode) {
      return false;
    }

    const expectedMonthlyCredits = getConsumerPlanMonthlyCredits(marker.planCode);
    if (expectedMonthlyCredits === null) {
      return true;
    }

    return balance.monthly_credits >= expectedMonthlyCredits;
  }

  if (marker.kind === 'credits') {
    if (marker.initialPurchasedCredits !== undefined && balance.purchased_credits > marker.initialPurchasedCredits) {
      return true;
    }
    if (marker.initialTotalCredits !== undefined && balance.total_credits > marker.initialTotalCredits) {
      return true;
    }
    return false;
  }

  return Date.now() - marker.createdAt >= billingReturnVerificationIntervalMs;
}

function formatExternalRedirectPendingMessage(language: UiLanguage, label: string): string {
  if (label === 'Open portal') {
    return pickUiText(language, 'Opening Stripe billing...', 'Stripe\u306e\u8acb\u6c42\u7ba1\u7406\u3092\u958b\u3044\u3066\u3044\u307e\u3059\u3002');
  }
  return pickUiText(language, 'Preparing Stripe checkout...', 'Stripe\u306e\u6c7a\u6e08\u753b\u9762\u3092\u6e96\u5099\u3057\u3066\u3044\u307e\u3059\u3002');
}

function formatBillingReturnPendingMessage(language: UiLanguage, kind: BillingReturnMarker['kind']): string {
  if (kind === 'subscription') {
    return pickUiText(language, 'Confirming your plan...', '\u30d7\u30e9\u30f3\u3092\u78ba\u8a8d\u4e2d\u3067\u3059\u3002');
  }
  if (kind === 'credits') {
    return pickUiText(language, 'Confirming your credits...', '\u30af\u30ec\u30b8\u30c3\u30c8\u3092\u78ba\u8a8d\u4e2d\u3067\u3059\u3002');
  }
  return pickUiText(language, 'Refreshing billing...', '\u8acb\u6c42\u60c5\u5831\u3092\u66f4\u65b0\u4e2d\u3067\u3059\u3002');
}

function formatBillingReturnSuccessMessage(language: UiLanguage, kind: BillingReturnMarker['kind']): string {
  if (kind === 'subscription') {
    return pickUiText(language, 'Plan updated.', '\u30d7\u30e9\u30f3\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f\u3002');
  }
  if (kind === 'credits') {
    return pickUiText(language, 'Credits updated.', '\u30af\u30ec\u30b8\u30c3\u30c8\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f\u3002');
  }
  return pickUiText(language, 'Billing updated.', '\u8acb\u6c42\u60c5\u5831\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f\u3002');
}

function formatBillingReturnTimeoutMessage(language: UiLanguage): string {
  return pickUiText(
    language,
    'Payment is still being confirmed. The balance will update automatically after Stripe finishes processing.',
    '\u6c7a\u6e08\u306f\u307e\u3060\u78ba\u8a8d\u4e2d\u3067\u3059\u3002Stripe\u306e\u51e6\u7406\u5b8c\u4e86\u5f8c\u306b\u6b8b\u9ad8\u306f\u81ea\u52d5\u3067\u66f4\u65b0\u3055\u308c\u307e\u3059\u3002',
  );
}

function redirectToBillingUrl(value: string, marker: BillingReturnMarker): void {
  window.sessionStorage.setItem(billingReturnPendingStorageKey, JSON.stringify(marker));
  redirectToExternalUrl(value);
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

