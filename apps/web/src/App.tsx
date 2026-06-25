import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
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
import { decodeJwtPayload, LyraApiClient, type BlobResponse } from './lib/api';
import { shouldAllowManualTokenAuth } from './lib/authMode';
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
  WorkRecord,
} from './types/api';

type WorkspaceTab = 'story' | 'entities' | 'pages';
type UiLanguage = 'ja' | 'en';
type SubscriptionPlanCode = 'free' | 'standard' | 'premium';
type SubscriptionCheckoutPlanCode = Exclude<SubscriptionPlanCode, 'free'>;
type CreditCheckoutPackageCode = 'credits_200' | 'credits_1000' | 'credits_3000';

const MAX_EPISODE_PAGES = 32;

const subscriptionPurchaseOptions: Array<{
  code: SubscriptionCheckoutPlanCode;
  credits: number;
  priceJpy: number;
  label: { en: string; ja: string };
}> = [
  {
    code: 'standard',
    credits: 50,
    priceJpy: 1000,
    label: { en: 'Standard', ja: 'スタンダード' },
  },
  {
    code: 'premium',
    credits: 175,
    priceJpy: 3500,
    label: { en: 'Premium', ja: 'プレミアム' },
  },
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
  { en: 'Character preview / import: 1 credit', ja: 'キャラ生成・取り込み: 1cr' },
  { en: 'Page generation: 3 credits+', ja: 'ページ生成: 3cr〜' },
  { en: 'Text AI: free', ja: 'テキストAI: 無料' },
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
  initialPlanCode?: SubscriptionPlanCode;
  initialTotalCredits?: number;
  initialPurchasedCredits?: number;
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

interface GenericStructuredFieldRow {
  key: string;
  value: string;
}

interface ReferenceCandidate {
  s3_key: string;
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
  'Main characters': '主な登場人物',
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
  'Page settings': 'ページ設定',
  'Dialogue mode': 'セリフの扱い',
  'Dialogue toggle': 'ページ全体でセリフを画像に含める',
  'Style reference title': '画風制約の作品名',
  'Style reference notes': '画風制約メモ',
  'Story sources': '話の材料',
  'Source scenes': '元シーン',
  'Page purpose': 'ページの目的',
  'Continuity note': '連続性メモ',
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
  'Confirmed references': '確定済みリファレンス',
  'Character list': 'キャラ一覧',
  'Character editor': 'キャラ編集',
  'Story context': 'ストーリー文脈',
  'Target episode': '対象の話',
  'Chapter / Episode': '章と話',
  'Import / References': '取り込み / リファレンス',
  Credits: 'クレジット',
  Jobs: 'ジョブ',
  Tutorial: 'チュートリアル',
  'First run guide': '初回の進め方',
  'Current plan': '現在のプラン',
  Current: '現在',
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
  'Solid': '実線',
  'Dashed': '破線',
  'Border width': '枠線幅',
  'Border color': '枠線色',
  Vertex: '頂点',
  X: 'X',
  Y: 'Y',
  'Save frame geometry': 'コマ形状を保存',
  Role: '役割',
  Size: 'サイズ',
  Situation: '状況',
  'Composition source': '構図の入力元',
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
  'Speaker is required for speech, thought, shout, and whisper lines.':
    'セリフ・思考・叫び・ささやきには話者が必要です。',
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
  'Confirm references': 'リファレンス確定',
  'Delete reference': 'リファレンス削除',
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
  'Create or select a work from the left panel to start editing.': '左側で作品を作成または選択すると編集を始められます。',
  'Choose the current work, chapter, and episode while editing characters.': 'キャラ編集中の作品・章・話を選択します。',
  'New character': '新規キャラ',
  'Importing image...': '画像を取り込み中...',
  'Drop or choose image': '画像をドロップまたは選択',
  'Select a preview and confirm it as the primary image.': 'プレビューを1つ選んで確定します。',
  'No preview yet.': 'まだプレビューはありません。',
  'Delete with the button only. Clicking the image will not delete it.': '削除はボタンのみです。画像クリックでは削除しません。',
  'No confirmed references yet.': 'まだ確定済みリファレンスがありません。',
  'Creating a new character. Saving here will add a new record and will not overwrite existing characters.':
    '新規キャラを作成中です。ここで保存すると既存キャラを上書きせず、新しいキャラとして追加します。',
  'Editing the selected character.': '選択中のキャラを編集しています。',
  'Delete this character? This cannot be undone.': 'このキャラを削除しますか？この操作は元に戻せません。',
  'Delete this reference image? This cannot be undone.': 'このリファレンス画像を削除しますか？この操作は元に戻せません。',
  'Delete this panel? This can break the frame/panel count until frames are adjusted.':
    'このコマを削除しますか？コマ割りを調整するまでフレーム数とコマ数が一致しなくなる場合があります。',
  'Use reference': '候補に含める',
  'Primary reference': 'メインにする',
  upload: 'アップロード',
  generated: '生成',
  'Frame count and panel count do not match. Adjust frames or panels before generating.':
    'フレーム数とコマ数が一致していません。生成前にコマ割りまたはコマを調整してください。',
  'Page generation is blocked until panel layout and panel content match.':
    'コマ割りとコマ内容の数が一致するまでページ生成はできません。',
  'Current count: frames {frames} / panels {panels}. Apply a panel layout template to sync them before generating.':
    '現在: コマ割り {frames} / コマ内容 {panels}。生成前にコマ割りテンプレートを適用して数を揃えてください。',
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
  'Double-click image to enlarge': '画像はダブルクリックで拡大',
  'Loading current page plan.':
    '現在のページ骨格を読み込んでいます。',
  'Regenerating will replace the current pages for this episode.':
    '再生成すると、この話の現在のページが置き換わります。',
  'Regenerating the page plan will replace the current pages for this episode.':
    'ページ骨格を上書き再生成すると、この話の現在のページを置き換えます。',
  Primary: 'メイン',
  Delete: '削除',
  'Generate full-body preview': '全身プレビュー生成',
  'Preview generation costs 1 credit.': 'プレビュー生成 1cr',
  'Image import costs 1 credit.': '画像取り込み 1cr',
  'Page generation starts at 3 credits.': 'ページ生成 3cr〜',
  'Text AI actions use no credits.': 'テキストAI 0cr',
  'No recent jobs.': '最近のジョブはありません。',
  'Only PNG, JPEG, and WebP are allowed.': 'PNG/JPEG/WebPのみ対応。',
  'Image file is too large.': '画像が大きすぎます。',
  'Image analyzed. Generate preview next.': '画像解析完了。次にプレビュー生成。',
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
  'Face shape': '輪郭',
  'Eyebrow shape': '眉の形',
  'Nose shape': '鼻の形',
  'Mouth shape': '口の形',
  'Eye color': '目の色',
  'Eye shape': '目の形',
  'Eyelid type': 'まぶた',
  'Eye size': '目の大きさ',
  'Eye angle': '目の角度',
  'Pupil style': '瞳の描き方',
  'Under-eye detail': '目元の特徴',
  'Mouth default': '口元の既定形',
  'Hair color': '髪色',
  'Hair length': '髪の長さ',
  'Hair style': '髪質',
  'Hair arrangement': '髪のまとめ方',
  Bangs: '前髪',
  'Front shape': '前髪の形',
  'Side hair': '横髪',
  'Back shape': '後ろ髪',
  Category: '服カテゴリ',
  'Main color': '主色',
  Impression: '印象',
  'Collar shape': '襟の形',
  'Sleeve length': '袖丈',
  'Skirt or pants': '下半身の形',
  Shoes: '靴',
  Legwear: 'レッグウェア',
  'Clothing details': '服装の詳細',
  'Custom value': '自由入力値',
  'Face + hair balance': '顔と髪のまとまり',
  'Eye line': '目元の印象',
  'Silhouette outline': '外形シルエット',
  'Posture read': '姿勢の読み取り',
  'Outfit shape': '服の形',
  'Color blocking': '配色ブロック',
  'Accessory / prop': '装飾・小物',
  'Hair shape': '髪型',
  'Eye color contrast': '瞳の色対比',
  'Expression gap': '表情のギャップ',
  'Silhouette edge': '輪郭のクセ',
  Accessory: 'アクセサリー',
  'Scar / mark': '傷・印',
  Stance: '立ち方',
  'Compact silhouette': 'コンパクトなシルエット',
  'Tall and slender': '高身長で細身',
  'Broad-shouldered': '肩幅が広い',
  'Long coat outline': 'ロングコート輪郭',
  'Skirt line': 'スカートの線',
  'Military block': '軍服的な塊感',
  'Soft rounded outline': '柔らかく丸い輪郭',
  'Beauty mark': 'ほくろ',
  Scar: '傷',
  'Eye bags': '隈',
  Fang: '八重歯',
  Ahoge: 'アホ毛',
  'Hair streak': '髪のメッシュ',
  Glasses: '眼鏡',
  Stubble: '無精ひげ',
  Beard: 'ひげ',
  Goatee: 'あごひげ',
  Earrings: 'ピアス',
  'Thick eyebrows': '太い眉',
  'Sharp jawline': '鋭い顎のライン',
  'about six heads tall': '六頭身くらい',
  'about six and a half heads tall': '六・五頭身くらい',
  'about seven heads tall': '七頭身くらい',
  'about seven and a half heads tall': '七・五頭身くらい',
  'about eight heads tall': '八頭身くらい',
  'narrow shoulders': '肩幅が狭い',
  'balanced shoulders': '肩幅は標準',
  'broad shoulders': '肩幅が広い',
  'short legs': '脚が短め',
  'balanced leg length': '脚の長さは標準',
  'long legs': '脚が長い',
  'centered and straight': '軸が中央でまっすぐ',
  'slightly forward-leaning': '少し前傾',
  'slightly backward-leaning': '少し後傾',
  'soft inward posture': '少し内向き',
  'open outward posture': '外向きに開く',
  'small eyes': '小さめの目',
  'balanced eyes': '標準的な目',
  'large eyes': '大きめの目',
  'very large eyes': 'かなり大きい目',
  'level eye line': '水平な目元',
  'slightly upturned eyes': '少しつり目',
  'strongly upturned eyes': '強いつり目',
  'slightly downturned eyes': '少したれ目',
  'drooping eyes': 'たれ目',
  'small pupils': '小さめの瞳',
  'large pupils': '大きめの瞳',
  'sharp pupils': '鋭い瞳',
  'soft round pupils': '丸く柔らかい瞳',
  'bright reflective pupils': '反射の強い瞳',
  'none visible': '目立たない',
  'soft shadows': '薄い影',
  'defined lower lash line': '下まつげの線がある',
  'slight eye bags': '軽い隈',
  'heavy eye bags': '強い隈',
  'closed neutral mouth': '閉じた無表情',
  'slight smile': 'わずかな笑み',
  'firm straight mouth': '固い一直線の口元',
  'soft parted lips': '少し開いた柔らかい口元',
  'straight front line': '前髪の直線ライン',
  'center-parted front': 'センター分け',
  'rounded front curve': '丸い前髪ライン',
  'side-swept front': '流した前髪',
  'blunt front': 'ぱっつん前髪',
  'short textured front': '短く毛束感のある前髪',
  'comma front': 'コンマ型の前髪',
  'curtain front': 'カーテン前髪',
  'messy front': '無造作な前髪',
  'swept-up front': '立ち上げた前髪',
  'short side locks': '短い横髪',
  'soft cheek framing': '頬を囲う横髪',
  'long side locks': '長い横髪',
  'tucked behind ears': '耳にかけた横髪',
  'trimmed sides': '短く整えたサイド',
  'faded sides': 'フェードしたサイド',
  'shaved sides': '刈り上げたサイド',
  sideburns: 'もみあげ',
  'ear-length sides': '耳丈の横髪',
  'clean bob back': 'ボブの後ろ髪',
  'layered back': 'レイヤー後ろ髪',
  'straight long back': 'まっすぐ長い後ろ髪',
  'ponytail fall': 'ポニーテールの落ち感',
  'braided back': '編み込み後ろ髪',
  'tapered nape': '襟足を短く整える',
  'short clipped back': '短く刈った後ろ髪',
  'undercut back': '後ろのアンダーカット',
  'tied-back hair': '後ろで結んだ髪',
  'long loose back': '長く下ろした後ろ髪',
  'wolf nape': 'ウルフ風の襟足',
  'round collar': '丸襟',
  'sharp collar': '尖った襟',
  'standing collar': '立ち襟',
  'sailor collar': 'セーラー襟',
  'hooded neckline': 'フード付き首元',
  Sleeveless: 'ノースリーブ',
  'Short sleeves': '半袖',
  'Three-quarter sleeves': '七分袖',
  'Long sleeves': '長袖',
  'Wide sleeves': '幅広袖',
  'Short skirt': '短いスカート',
  'Long skirt': '長いスカート',
  'Straight pants': '細いパンツ',
  'Wide pants': 'ワイドパンツ',
  Slacks: 'スラックス',
  Jeans: 'ジーンズ',
  'Cargo pants': 'カーゴパンツ',
  Shorts: '短パン',
  Loafers: 'ローファー',
  Sneakers: 'スニーカー',
  Boots: 'ブーツ',
  'Dress shoes': '革靴',
  'Combat boots': 'コンバットブーツ',
  Heels: 'ヒール',
  'School shoes': '上履き・制服靴',
  'Bare legs': '素足',
  'Ankle socks': '短い靴下',
  'Knee socks': '膝下ソックス',
  'Thigh-high socks': 'ニーハイ',
  Tights: 'タイツ',
  'Simple uniform detailing': 'シンプルな制服ディテール',
  'Layered practical details': '実用的な重ね着ディテール',
  'Ornamental trim': '装飾的な縁取り',
  'Combat utility details': '実戦向けの装備ディテール',
  'Minimal clean design': 'ミニマルで整理されたデザイン',
  Female: '女性',
  Male: '男性',
  Androgynous: '中性的',
  Unspecified: '未指定',
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
  Tan: '日焼け',
  Deep: '濃いめ',
  Custom: '自由入力',
  'Bright friendly': '明るく親しみやすい',
  'Quiet neat': '静かで整っている',
  'Cool distant': 'クールで距離がある',
  'Gentle soft': '柔らかく穏やか',
  'Serious reliable': '真面目で頼れる',
  'Mysterious fragile': '不思議で儚い',
  'Energetic bold': '元気で大胆',
  'Stoic reserved': '寡黙で控えめ',
  'Rugged calm': '無骨で落ち着いた',
  'Sharp elite': '鋭く知的',
  'Playful confident': '余裕があり茶目っ気がある',
  'Mature composed': '大人びて落ち着いた',
  'Upright neat': '背筋が伸びて整っている',
  'Natural relaxed': '自然で力が抜けている',
  'Shy reserved': '控えめでおとなしい',
  'Confident open': '自信があり開いている',
  'Still quiet': '静かで動きが少ない',
  'Arms crossed': '腕を組む',
  'Hands in pockets': 'ポケットに手を入れる',
  'Guarded stance': '警戒した立ち姿',
  'Wide grounded stance': '足を広げて安定した立ち姿',
  'Elegant upright': '上品に背筋を伸ばす',
  'Soft smile': 'やわらかな微笑み',
  'Calm neutral': '落ち着いた無表情',
  'Serious focus': '真剣で集中',
  'Cheerful smile': '明るい笑顔',
  'Cool unfazed': '冷静で動じない',
  'Stern look': '厳しい目つき',
  'Tired neutral': '疲れた無表情',
  'Confident smirk': '自信のある片笑い',
  'Bored gaze': '退屈そうな視線',
  'Teasing smile': 'からかうような笑み',
  Petite: '小柄',
  Slender: '細身',
  Average: '標準',
  Athletic: '引き締まっている',
  Muscular: '筋肉質',
  Curvy: '丸みがある',
  Lean: '引き締まった細身',
  Stocky: 'がっしり',
  'Broad build': '幅広い体格',
  'Large build': '大柄',
  'Very short height': 'かなり低め',
  Short: '低め',
  Tall: '高め',
  'Very tall height': 'かなり高め',
  Round: '丸型',
  Oval: '卵型',
  Heart: 'ハート型',
  Square: '四角型',
  Diamond: 'ひし形',
  Long: '長め',
  'Soft triangle': 'やわらかな三角形',
  Straight: '直線的',
  'Soft arch': 'ゆるいアーチ',
  'High arch': '高いアーチ',
  Thick: '太め',
  Thin: '細め',
  Sharp: '鋭い',
  Small: '小さめ',
  Button: 'ボタン鼻',
  Rounded: '丸い',
  Broad: '広め',
  Soft: 'やわらかい',
  Full: 'ふっくら',
  Wide: '広い',
  Smirk: '片笑い',
  Serious: '真面目',
  Black: '黒',
  Brown: '茶',
  'Dark brown': '濃い茶',
  Blonde: '金',
  'Ash blonde': 'アッシュブロンド',
  Auburn: '赤みの茶',
  Silver: '銀',
  White: '白',
  Blue: '青',
  Red: '赤',
  Pink: 'ピンク',
  Purple: '紫',
  'Two tone': 'ツートーン',
  'Very short': 'かなり短い',
  'Very long': 'かなり長い',
  Wavy: 'ゆるいウェーブ',
  Curly: 'カール',
  Wild: 'ラフ',
  Tousled: '無造作',
  Spiky: 'ツンツン',
  Fluffy: 'ふわっとした',
  Slick: '撫で付けた',
  Coarse: '硬め',
  Shaved: '剃り込み',
  Down: '下ろす',
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
  'Side ponytail': 'サイドポニーテール',
  'Twin tails': 'ツインテール',
  Bun: 'お団子',
  'Man bun': 'マンバン',
  Topknot: 'トップノット',
  Braid: '編み込み',
  'Half up': 'ハーフアップ',
  'Tied back': '後ろで結ぶ',
  'Shaved sides': 'サイドを刈り上げ',
  Green: '緑',
  Gold: '金',
  Gentle: '穏やか',
  Narrow: '細い',
  Single: '一重',
  Double: '二重',
  None: 'なし',
  standard: '標準',
  Heavy: '重め',
  'Side swept': '流し前髪',
  Blunt: 'ぱっつん',
  Parted: '分け前髪',
  'Center parted': 'センター分け前髪',
  Curtain: 'カーテンバング',
  'Messy bangs': '無造作前髪',
  'Short bangs': '短い前髪',
  'Long bangs': '長い前髪',
  Military: '軍服',
  School: '制服',
  Casual: '私服',
  Suit: 'スーツ',
  'Business casual': 'ビジネスカジュアル',
  'Lab coat': '白衣',
  'Trench coat': 'トレンチコート',
  Tactical: 'タクティカル',
  'Traditional formal': '礼装・正装',
  'Street jacket': 'ストリートジャケット',
  Fantasy: 'ファンタジー',
  Japanese: '和装',
  Streetwear: 'ストリート',
  Hoodie: 'パーカー',
  Sports: 'スポーツ',
  'Winter coat': '冬コート',
  Workwear: '作業着',
  Armor: '鎧',
  Gothic: 'ゴシック',
  'Formal dress': 'フォーマル',
  'Idol stage': 'ステージ衣装',
  Navy: 'ネイビー',
  Gray: 'グレー',
  Formal: 'フォーマル',
  Practical: '実用的',
  Elegant: '上品',
  Rough: 'ラフ',
  Cute: 'かわいい',
  Anime: 'アニメ',
  'Semi-realistic': 'セミリアル',
  Manga: '漫画',
  Painterly: '絵画調',
  Establish: '導入',
  Action: '動き',
  Reaction: '反応',
  Emphasis: '強調',
  Transition: 'つなぎ',
  Pause: '間',
  Impact: 'インパクト',
  Standard: '標準',
  Large: '大',
  Splash: 'スプラッシュ',
  'AI auto': 'AI自動',
  Gallery: 'ギャラリー',
  'Full body': '全身',
  'Half body': '半身',
  'Close up': '寄り',
  'Extreme close up': '極寄り',
  Front: '正面',
  Side: '横',
  'Three quarter': '斜め',
  'Bird eye': '俯瞰',
  'Worm eye': '煽り',
  'Dutch angle': 'ダッチアングル',
  Secondary: '補助',
  Left: '左',
  Center: '中央',
  Away: '背面',
  '3/4 left': '左斜め',
  '3/4 right': '右斜め',
  Determined: '決意',
  Calm: '落ち着き',
  Angry: '怒り',
  Sad: '悲しみ',
  Surprised: '驚き',
  'Standing firm': '立つ',
  Attacking: '攻撃',
  Defending: '防御',
  Running: '走る',
  Speech: '会話',
  Thought: '心の声',
  Narration: 'ナレーション',
  Shout: '叫び',
  Whisper: 'ささやき',
  Top: '上',
  Bottom: '下',
  'Standard 4': '標準4コマ',
  'Top wide 3': '上段ワイド3コマ',
  'Standard 6': '標準6コマ',
  'Dense 8': '密集8コマ',
  'Climax 2': 'クライマックス2コマ',
  'Splash 1': '1枚絵',
  'Action 5': 'アクション5コマ',
  'Battle 7': 'バトル7コマ',
  'Main entity IDs': '主要キャラID',
  'New chapter title': '新しい章タイトル',
  'Untitled chapter': '無題の章',
  'New episode title': '新しい話タイトル',
  'Untitled episode': '無題の話',
  'Move up': '上へ',
  'Move down': '下へ',
  'No location': '場所未設定',
  Add: '追加',
  English: '英語',
  'AI improved': 'AI改善済み',
  Horizontal: '横書き',
  Vertical: '縦書き',
  'Manga gothic': '漫画ゴシック',
  'Mincho font': '明朝',
  'Rounded font': '丸ゴシック',
  'Bold font': '太字',
  'Characters in panel': 'コマ内キャラ',
  'Pick who appears first, then refine pose, facing, and effects per character.': 'まず登場キャラを決め、その後に向き・ポーズ・エフェクトを詰めます。',
  'Placement first, then expression, pose, and effect.': 'まず配置を決め、その後に表情・ポーズ・エフェクトを詰めます。',
  'These lines will be considered inside the generated panel art.': 'これらの行は生成画像のコマ内テキストとして扱われます。',
  'These lines stay outside the generated panel art.': 'これらの行は生成画像の外側のテキストとして扱われます。',
  Email: 'メールアドレス',
  'Send magic link': 'マジックリンクを送信',
  'Continue with Cognito': 'Cognitoでログイン',
  'Manual bearer token': '手動ベアラートークン',
  'Magic link sent.': 'マジックリンクを送信しました。',
  'Supabase client is not configured.': 'Supabase クライアントが設定されていません。',
  'Production Console': '制作コンソール',
  'Story, entity, page, billing.': 'ストーリー、キャラ、ページ、課金を管理します。',
  'Processing. This task can take a while.': '処理中です。この処理には時間がかかる場合があります。',
  'Queued. This task will start soon and can take a while.': '待機中です。まもなく開始され、この処理には時間がかかる場合があります。',
  'Page skeleton generation can take a while, especially for long episodes.': 'ページ骨格生成は、話数やページ数が多いと時間がかかる場合があります。',
  'Story plan autofill can take a while while pages and panels are being distributed.': '話全体の反映は、ページ配分とコマ分割を行うため時間がかかる場合があります。',
  'Character preview generation can take a while. The preview updates when the job finishes.': 'キャラのプレビュー生成は時間がかかる場合があります。完了するとプレビューが更新されます。',
  'Page image generation can take a while. The page image updates when the job finishes.': 'ページ画像生成は時間がかかる場合があります。完了するとページ画像が更新されます。',
  'Queued. Starts soon.': '待機中。順番に処理します。',
  'Queued. This process can take around 20 minutes.': '待機中です。この処理は20分程度かかる場合があります。',
  'Generating page plan. This can take a while.': '骨格生成中。少し時間がかかります。',
  'Applying story plan to pages and panels.': 'ページとコマへ反映中。',
  'Applying story plan to pages and panels. This process can take around 20 minutes.':
    'ページとコマへ反映中です。この処理は20分程度かかる場合があります。',
  'Compiling story plan chunks. This process can take around 20 minutes.':
    'ストーリーをページとコマへ分配中です。この処理は20分程度かかる場合があります。',
  'Saving story plan to pages and panels. This process can take around 20 minutes.':
    'ページとコマへ保存中です。この処理は20分程度かかる場合があります。',
  'Story plan applied to pages and panels.': 'ページとコマへの反映が完了しました。',
  'Story plan autofill failed.': 'ページとコマへの反映に失敗しました。',
  'Generating preview. It updates when finished.': 'プレビュー生成中。完了後に更新されます。',
  'Generating page. It updates when finished.': 'ページ生成中。完了後に更新されます。',
  'You do not need to fill every blank field.': 'すべての空欄を埋める必要はありません。',
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
    return 'ページ骨格生成';
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
    actionLabel === 'Apply story plan';
  if (language === 'ja') {
    return isAsyncGenerationAction ? `${translatedLabel}を開始` : `${translatedLabel}完了`;
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

function formatPlanLabel(language: UiLanguage, planCode: SubscriptionPlanCode): string {
  const labels: Record<SubscriptionPlanCode, { en: string; ja: string }> = {
    free: { en: 'Free', ja: 'フリー' },
    standard: { en: 'Standard', ja: 'スタンダード' },
    premium: { en: 'Premium', ja: 'プレミアム' },
  };

  return pickUiText(language, labels[planCode].en, labels[planCode].ja);
}

const tutorialSteps: Array<{
  title: { en: string; ja: string };
  steps: Array<{ en: string; ja: string }>;
}> = [
  {
    title: { en: 'Story', ja: 'ストーリー' },
    steps: [
      {
        en: 'Create a work from New work after entering at least a title.',
        ja: 'まずタイトルを入力し、「作品を作成」で新しい作品を作ります。',
      },
      {
        en: 'Add the world setting and overall flow roughly, then save.',
        ja: '世界観や全体の流れを大まかに書いて保存します。',
      },
      {
        en: 'Add a chapter, then add episodes inside that chapter.',
        ja: '章を追加し、その章の中に話を追加します。',
      },
      {
        en: 'Write the episode with either split input or full input. Use one input mode at a time.',
        ja: '話の本文は分割入力か一括入力のどちらかで書きます。両方は同時に使わないでください。',
      },
      {
        en: 'Story AI can improve the current episode and apply the result back into the fields.',
        ja: 'ストーリーAIを使うと、現在の話を改善して入力欄へ反映できます。',
      },
      {
        en: 'Add Scenes with location, time, and atmosphere before using Apply story plan.',
        ja: '「話全体を反映」を使う前に、シーンへ場所・時間・雰囲気を入力します。',
      },
    ],
  },
  {
    title: { en: 'Characters', ja: 'キャラクター' },
    steps: [
      {
        en: 'Press New character and fill the fields you already know.',
        ja: '「新規キャラ」を押し、分かっている特徴だけ入力します。',
      },
      {
        en: 'You do not need to fill every blank field. Save the selected character before generation.',
        ja: 'すべての空欄を埋める必要はありません。生成前に選択中のキャラを保存します。',
      },
      {
        en: 'Generate a full-body preview, then confirm the image you want to use as the reference.',
        ja: '全身プレビューを生成し、使いたい画像をリファレンスとして確定します。',
      },
      {
        en: 'To use your own image, import it first. You can confirm the imported image or generate a new preview from it.',
        ja: '手元の画像を使う場合は先に取り込みます。取り込み画像を確定することも、そこからプレビュー生成することもできます。',
      },
    ],
  },
  {
    title: { en: 'Page Plan And Export', ja: 'ページ骨格と出力' },
    steps: [
      {
        en: 'After creating the needed characters, return to Story and press Generate page plan.',
        ja: '必要なキャラを作成したらストーリーへ戻り、「ページ骨格生成」を押します。',
      },
      {
        en: 'Page plan generation creates pages, frames, and panel slots. It can take a few minutes.',
        ja: 'ページ骨格生成では、ページ・コマ割り・コマ枠を作ります。数分かかることがあります。',
      },
      {
        en: 'Use Apply story plan separately when you want the story distributed into panel details and dialogue.',
        ja: 'コマ内容やセリフまで自動入力したい場合は、別途「話全体を反映」を押します。',
      },
      {
        en: 'Open Pages, review each page, and adjust panel content, frame template, or panel count.',
        ja: 'ページを開き、各ページのコマ内容・テンプレート・コマ数を確認して調整します。',
      },
      {
        en: 'When ready, press Generate page. The image is created from the current page inputs.',
        ja: '調整後に「ページ生成」を押すと、現在の入力内容から画像が生成されます。',
      },
      {
        en: 'If the image is not right, edit the panel inputs and generate the page again.',
        ja: '結果が合わない場合は、コマの入力内容を直してもう一度ページ生成します。',
      },
      {
        en: 'When finished, choose pages and file format, then download them.',
        ja: '完成したら、保存するページとファイル形式を選んでダウンロードします。',
      },
    ],
  },
];

const selectedWorkStorageKey = 'lyra:web:selected-work';
const selectedChapterStorageKey = 'lyra:web:selected-chapter';
const selectedEpisodeStorageKey = 'lyra:web:selected-episode';
const selectedPageStorageKey = 'lyra:web:selected-page';
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

  return renderWithSplash(
    <StudioShell
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
        <h1>{translateUiString(language, 'Production Console')}</h1>
        <p className="muted">{translateUiString(language, 'Story, entity, page, billing.')}</p>
        {visibleNotice !== null ? <NoticeBanner notice={visibleNotice} /> : null}
        {props.cognitoAuthConfig !== null ? (
          <div className="stack">
            <button className="primary-button" onClick={() => void props.onCognitoLogin()} type="button">
              <KeyRound size={16} />
              {translateUiString(language, 'Continue with Cognito')}
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

function StudioShell(props: {
  email: string;
  token: string;
  supabaseClient: SupabaseClient | null;
  onAuthExpired: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const onAuthExpired = props.onAuthExpired;
  const api = useMemo(() => new LyraApiClient(() => props.token), [props.token]);
  const [uiLanguageStored, setUiLanguageStored] = useStoredString(window.localStorage, uiLanguageStorageKey, 'ja');
  const uiLanguage = normalizeUiLanguage(uiLanguageStored);
  const uiLanguageRef = useRef<UiLanguage>(uiLanguage);
  const isMobileViewport = useIsMobileViewport();
  const [newWorkFormOpen, setNewWorkFormOpen] = useState(!isMobileViewport);
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
  const handledJobsRef = useRef<Set<string>>(new Set());
  const lastWorkspaceRefreshRef = useRef(0);
  const billingVerificationTargetRef = useRef<BillingReturnMarker | null>(null);
  const [billingReturnChecking, setBillingReturnChecking] = useState(false);

  useEffect(() => {
    uiLanguageRef.current = uiLanguage;
  }, [uiLanguage]);

  useEffect(() => {
    setNewWorkFormOpen(!isMobileViewport);
  }, [isMobileViewport]);

  const trackedJobList = useMemo(() => parseTrackedJobIds(trackedJobIds), [trackedJobIds]);

  const worksQuery = useQuery({
    queryKey: ['works'],
    queryFn: () => api.getWorks(),
  });
  const works = useMemo(() => worksQuery.data?.works ?? [], [worksQuery.data?.works]);
  const showWorksLoading = works.length === 0 && worksQuery.isLoading;
  const showWorksError = works.length === 0 && worksQuery.isError;
  const showWorksEmpty = works.length === 0 && worksQuery.isSuccess;
  const worksErrorMessage = showWorksError ? toMessage(worksQuery.error, uiLanguage) : null;
  const worksErrorNeedsLogin = showWorksError && isApiStatus(worksQuery.error, 401);
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
  const authExpiredHandledRef = useRef(false);
  const apiSessionExpired = [
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
      queryKey: ['job', jobId],
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
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [queryClient, selectedWorkId, selectedChapter, selectedEpisode, selectedPage]);

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
    if (!billingReturnChecking || marker === null || balanceQuery.data === undefined) {
      return;
    }

    if (!isBillingReturnSatisfied(balanceQuery.data, marker)) {
      return;
    }

    billingVerificationTargetRef.current = null;
    setBillingReturnChecking(false);
    setNotice({ type: 'success', message: formatBillingReturnSuccessMessage(uiLanguage, marker.kind) });
  }, [balanceQuery.data, billingReturnChecking, uiLanguage]);

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
        void queryClient.invalidateQueries({ queryKey: ['billing-balance'] });

        if (job.job_type === 'page_generate') {
          const pageId = typeof job.params.page_id === 'string' ? job.params.page_id : null;
          if (pageId !== null) {
            void queryClient.invalidateQueries({ queryKey: ['panels', pageId] });
            void queryClient.invalidateQueries({ queryKey: ['frames', pageId] });
          }

          void queryClient.invalidateQueries({ queryKey: ['pages'] });
        }
        if (job.job_type === 'episode_story_autofill') {
          const episodeId = typeof job.params.episode_id === 'string' ? job.params.episode_id : null;
          if (episodeId !== null) {
            void queryClient.invalidateQueries({ queryKey: ['pages', episodeId] });
          }
          void queryClient.invalidateQueries({ queryKey: ['pages'] });
          void queryClient.invalidateQueries({ queryKey: ['panels'] });
          void queryClient.invalidateQueries({ queryKey: ['frames'] });
        }
        if (job.job_type === 'episode_page_skeleton') {
          const episodeId = typeof job.params.episode_id === 'string' ? job.params.episode_id : null;
          if (episodeId !== null) {
            void queryClient.invalidateQueries({ queryKey: ['pages', episodeId] });
          }
          void queryClient.invalidateQueries({ queryKey: ['episodes'] });
          void queryClient.invalidateQueries({ queryKey: ['pages'] });
          void queryClient.invalidateQueries({ queryKey: ['panels'] });
          void queryClient.invalidateQueries({ queryKey: ['frames'] });
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
              void queryClient.invalidateQueries({ queryKey: ['entity-reference-set', entityId] });
            }
          }
      }
    }
  }, [trackedJobs, queryClient]);

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
      referenceSelection.includes(candidate.s3_key),
    );
    const firstSelectedCandidateKey = referenceSelection.find((selectedKey) =>
      referenceCandidates.some((candidate) => candidate.s3_key === selectedKey),
    );

    if (!hasSelectionForCurrentCandidates) {
      setReferenceSelection(referenceCandidates.map((candidate) => candidate.s3_key));
      setReferencePrimaryKey(referenceCandidates[0]?.s3_key ?? '');
      return;
    }

    if (
      referencePrimaryKey.length > 0 &&
      !referenceSelection.includes(referencePrimaryKey) &&
      referenceCandidates.some((candidate) => candidate.s3_key === referencePrimaryKey)
    ) {
      setReferenceSelection([...referenceSelection, referencePrimaryKey]);
      return;
    }

    if (!referenceCandidates.some((candidate) => candidate.s3_key === referencePrimaryKey)) {
      setReferencePrimaryKey(firstSelectedCandidateKey ?? referenceCandidates[0]?.s3_key ?? '');
    }
  }, [referenceCandidates, referencePrimaryKey, referenceSelection]);

  const saveCurrentEpisodeContext = async (): Promise<void> => {
    if (selectedEpisode !== null) {
      await api.updateEpisode(selectedEpisode.id, toEpisodeAutosavePayload(episodeDraft));
    }

    if (selectedScene !== null) {
      await api.updateScene(selectedScene.id, toSceneAutosavePayload(sceneDraft));
    }

    if (selectedChapter !== null) {
      await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter.id] });
    }
    if (selectedEpisode !== null) {
      await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
    }
  };

  const setEpisodeStoryInputMode = (nextMode: EpisodeDraft['story_input_mode']): void => {
    setEpisodeDraft((current) => convertEpisodeDraftStoryInputMode(current, nextMode));
  };

  const saveCurrentPageGenerationContext = async (): Promise<void> => {
    if (selectedPage !== null) {
      await api.updatePage(selectedPage.id, toPageSettingsPayload(pageSettingsDraft));
    }

    if (selectedPage !== null && selectedPanel !== null) {
      const assignmentsPayload = toPanelAssignmentsPayload(panelDraft);
      await api.updatePanel(selectedPanel.id, toPanelPayload(panelDraft));
      await api.replacePanelAssignments(selectedPanel.id, assignmentsPayload);
    }
  };

  const saveCurrentEntityGenerationContext = async (): Promise<void> => {
    if (selectedEntity === null || selectedWork === null) {
      return;
    }

    const savedEntity = await api.updateEntity(selectedEntity.id, toEntityPayload(entityDraft));
    cacheEntityRecord(savedEntity);
    setEntityDraft(toEntityDraft(savedEntity));
    await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
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

  const cacheEntityRecord = (entity: EntityRecord): void => {
    queryClient.setQueryData<{ entities: EntityRecord[] }>(['entities', entity.work_id], (current) => {
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
    queryClient.setQueryData<{ entities: EntityRecord[] }>(['entities', workId], (current) =>
      current === undefined
        ? current
        : {
            ...current,
            entities: current.entities.filter((entity) => entity.id !== entityId),
          },
    );
  };

  const runAction = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      setBusyAction(label);
      await action();
      const translatedLabel = translateUiString(uiLanguage, label);
      setNotice({
        type: 'success',
        message: formatActionSuccessMessage(uiLanguage, label, translatedLabel),
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
        const response = await api.exportPageImage(page.id);
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
      const response = await api.exportPageImage(page.id);
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
        <details
          className="sidebar-disclosure sidebar-create-disclosure"
          onToggle={(event) => setNewWorkFormOpen(event.currentTarget.open)}
          open={newWorkFormOpen}
        >
          <summary>{translateUiString(uiLanguage, 'New work')}</summary>
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
              <span>{translateUiString(uiLanguage, 'Title')}</span>
              <input
                required
                value={newWorkDraft.title}
                onChange={(event) => setNewWorkDraft({ ...newWorkDraft, title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>{translateUiString(uiLanguage, 'Genre')}</span>
              <input
                value={newWorkDraft.genre}
                onChange={(event) => setNewWorkDraft({ ...newWorkDraft, genre: event.target.value })}
              />
            </label>
            <button className="primary-button" disabled={busyAction === 'Create work'} type="submit">
              {busyAction === 'Create work' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
              {translateUiString(uiLanguage, 'Create')}
            </button>
          </form>
        </details>
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
              <option value="en">{translateUiString(uiLanguage, 'English')}</option>
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
            <p>{translateUiString(uiLanguage, 'Create or select a work from the left panel to start editing.')}</p>
          </section>
        ) : (
          <div className="workspace-grid">
            <section className="main-column">
              {activeTab === 'story' ? (
                <>
                  <PanelSection
                    title={selectedWork.title}
                    subtitle={uiLanguage === 'ja' ? `状態 ${translateUiString(uiLanguage, selectedWork.status)}` : `status ${selectedWork.status}`}
                    collapsible
                    mobileDefaultCollapsed
                    actions={
                      <button
                        className="secondary-button"
                        disabled={busyAction === 'Save work'}
                        onClick={() =>
                          void runAction('Save work', async () => {
                            await api.updateWork(
                              selectedWork.id,
                              toWorkPayload(workDraft, loadedSelectedWorkEntityIds),
                            );
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
                    <div className="form-grid three">
                      <InputField label="Title" value={workDraft.title} onChange={(value) => setWorkDraft({ ...workDraft, title: value })} />
                      <InputField label="Genre" value={workDraft.genre} onChange={(value) => setWorkDraft({ ...workDraft, genre: value })} />
                      <InputField label="Theme" value={workDraft.theme} onChange={(value) => setWorkDraft({ ...workDraft, theme: value })} />
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
                  </PanelSection>

                  <PanelSection
                    title="Chapter / Episode"
                    collapsible
                    mobileDefaultCollapsed
                    actions={
                      <div className="toolbar">
                        <button
                          className="primary-button"
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
                              const result = await api.generatePageSkeleton(selectedEpisode.id, {
                                overwrite_existing: overwriteExisting,
                                apply_story_plan: false,
                                language: uiLanguage,
                              });
                              if ('job_id' in result) {
                                trackJob(result.job_id);
                              } else {
                                await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
                                await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
                                await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
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
                          className="ghost-button"
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
                              const result = await api.autofillEpisodePagesFromStory(selectedEpisode.id, uiLanguage);
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
                                      await api.moveChapter(chapter.id, 'up');
                                      await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
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
                                      await api.moveChapter(chapter.id, 'down');
                                      await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
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
                              );
                              setNewChapterDraft(createEmptyChapterDraft());
                              await queryClient.invalidateQueries({ queryKey: ['chapters', selectedWork.id] });
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
                                    );
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
                                      await api.moveEpisode(episode.id, 'up');
                                      await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
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
                                      await api.moveEpisode(episode.id, 'down');
                                      await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
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
                                );
                                setNewEpisodeDraft(createEmptyEpisodeDraft());
                                await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter.id] });
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
                              );
                              await queryClient.invalidateQueries({ queryKey: ['episodes', selectedChapter?.id ?? ''] });
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
                        type="number"
                        min={1}
                        max={MAX_EPISODE_PAGES}
                      />
                    </div>
                    <TextAreaField label="Purpose" rows={2} value={episodeDraft.purpose} onChange={(value) => setEpisodeDraft({ ...episodeDraft, purpose: value })} />
                    <SelectField
                      label="Story input mode"
                      value={episodeDraft.story_input_mode}
                      onChange={(value) => setEpisodeStoryInputMode(value as EpisodeDraft['story_input_mode'])}
                      options={[
                        ['structured', 'Split sections'],
                        ['full', 'Whole draft'],
                      ]}
                    />
                    {episodeDraft.story_input_mode === 'full' ? (
                      <TextAreaField
                        label="Whole story draft"
                        rows={10}
                        value={episodeDraft.story_full_draft}
                        onChange={(value) => setEpisodeDraft({ ...episodeDraft, story_full_draft: value })}
                      />
                    ) : (
                      <>
                        <div className="form-grid two">
                          <TextAreaField label="Introduction" rows={3} value={episodeDraft.introduction} onChange={(value) => setEpisodeDraft({ ...episodeDraft, introduction: value })} />
                          <TextAreaField label="Middle" rows={3} value={episodeDraft.middle} onChange={(value) => setEpisodeDraft({ ...episodeDraft, middle: value })} />
                        </div>
                        <div className="form-grid two">
                          <TextAreaField label="Climax" rows={3} value={episodeDraft.climax} onChange={(value) => setEpisodeDraft({ ...episodeDraft, climax: value })} />
                          <TextAreaField label="Ending hook" rows={3} value={episodeDraft.ending_hook} onChange={(value) => setEpisodeDraft({ ...episodeDraft, ending_hook: value })} />
                        </div>
                      </>
                    )}
                  </PanelSection>

                  <PanelSection
                    title="Story AI"
                    subtitle={pickUiText(
                      uiLanguage,
                      'Improve the current episode draft while keeping continuity with the rest of the work.',
                      '作品全体との整合を保ちながら、現在の話の下書きを改善します。',
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
                                });
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
                    <div className="stack">
                      <TextAreaField
                        label="Improved title"
                        rows={2}
                        value={storyImprovementDraft?.title ?? ''}
                        onChange={(value) =>
                          setStoryImprovementDraft((current) => ({
                            ...(current ?? createEmptyStoryImprovementDraft(episodeDraft.story_input_mode)),
                            title: value,
                          }))
                        }
                      />
                      <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, title: storyImprovementDraft?.title ?? current.title }))} type="button">
                        <Save size={16} />
                        {translateUiString(uiLanguage, 'Apply to title')}
                      </button>
                    </div>
                    {episodeDraft.story_input_mode === 'full' ? (
                      <>
                        <div className="stack">
                          <TextAreaField
                            label="Improved purpose"
                            rows={4}
                            value={storyImprovementDraft?.purpose ?? ''}
                            onChange={(value) =>
                              setStoryImprovementDraft((current) => ({
                                ...(current ?? createEmptyStoryImprovementDraft('full')),
                                purpose: value,
                              }))
                            }
                          />
                          <button className="secondary-button" onClick={() => setEpisodeDraft((current) => ({ ...current, purpose: storyImprovementDraft?.purpose ?? current.purpose }))} type="button">
                            <Save size={16} />
                            {translateUiString(uiLanguage, 'Apply purpose')}
                          </button>
                        </div>
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
                              label="Improved purpose"
                              rows={4}
                              value={storyImprovementDraft?.purpose ?? ''}
                              onChange={(value) =>
                                setStoryImprovementDraft((current) => ({
                                  ...(current ?? createEmptyStoryImprovementDraft('structured')),
                                  purpose: value,
                                }))
                              }
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
                        </div>
                        <div className="form-grid two">
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
                            );
                            setSceneDraft(createEmptySceneDraft());
                            await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
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
                              );
                              await queryClient.invalidateQueries({ queryKey: ['scenes', selectedEpisode.id] });
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
                    title="Story context"
                    subtitle="Choose the current work, chapter, and episode while editing characters."
                    compact
                    collapsible
                    mobileDefaultCollapsed
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
                                await api.deleteEntity(selectedEntity.id);
                                removeEntityFromCache(selectedWork.id, selectedEntity.id);
                                await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
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
                              const createdEntity = await api.createEntity(selectedWork.id, toEntityPayload(entityDraft));
                              cacheEntityRecord(createdEntity);
                              setEntityEditorMode('edit');
                              setSelectedEntityId(createdEntity.id);
                              setEntityDraft(toEntityDraft(createdEntity));
                              await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
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
                              const savedEntity = await api.updateEntity(selectedEntity.id, toEntityPayload(entityDraft));
                              cacheEntityRecord(savedEntity);
                              setEntityDraft(toEntityDraft(savedEntity));
                              await queryClient.invalidateQueries({ queryKey: ['entities', selectedWork.id] });
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

                  <PanelSection title="Import / References" collapsible mobileDefaultCollapsed>
                    <div className="state-pill-row">
                      <span className="state-pill state-pill-neutral">
                        {translateUiString(uiLanguage, 'Image import costs 1 credit.')}
                      </span>
                      <span className="state-pill state-pill-neutral">
                        {translateUiString(uiLanguage, 'Preview generation costs 1 credit.')}
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
                              await api.confirmEntityReference(selectedEntity.id, {
                                selected_s3_keys: selectedReferenceKeys,
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
                    <div className="reference-management-grid">
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
                              <div key={candidate.s3_key} className={`reference-card reference-card-portrait ${referenceSelection.includes(candidate.s3_key) ? 'active' : ''}`}>
                                <div className="reference-card-media">
                                  <AuthenticatedImage
                                    enabled={selectedEntity !== null}
                                    loadImage={() => api.exportEntityReferenceCandidateImage(selectedEntity?.id ?? '', candidate.s3_key)}
                                    queryKey={['entity-reference-candidate-image', selectedEntity?.id, candidate.s3_key]}
                                  />
                                </div>
                                <div className="reference-card-body">
                                  <span>{translateUiString(uiLanguage, candidate.source)}</span>
                                  <div className="reference-card-choice-row">
                                    <label>
                                      <input
                                        checked={referenceSelection.includes(candidate.s3_key)}
                                        onChange={(event) =>
                                          setReferenceSelection((current) =>
                                            event.target.checked
                                              ? current.includes(candidate.s3_key)
                                                ? current
                                                : [...current, candidate.s3_key]
                                              : current.filter((item) => item !== candidate.s3_key),
                                          )
                                        }
                                        type="checkbox"
                                      />
                                      {translateUiString(uiLanguage, 'Use reference')}
                                    </label>
                                    <label>
                                      <input
                                        checked={referencePrimaryKey === candidate.s3_key}
                                        name="reference-primary"
                                        onChange={() => {
                                          setReferencePrimaryKey(candidate.s3_key);
                                          setReferenceSelection((current) =>
                                            current.includes(candidate.s3_key)
                                              ? current
                                              : [...current, candidate.s3_key],
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
                                    loadImage={() => api.exportEntityReferenceImage(selectedEntity?.id ?? '', image.ref_id)}
                                    queryKey={['entity-reference-image', selectedEntity?.id, image.ref_id, image.created_at]}
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
                  <PanelSection
                    title="Target episode"
                    subtitle="Switch story context for page editing."
                    compact
                    collapsible
                    mobileDefaultCollapsed
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
                              loadImage={() => api.exportPageImage(page.id)}
                              onDoubleClick={(url) => openImageLightbox(url, `${translateUiString(uiLanguage, 'Page')} ${page.page_number}`)}
                              placeholderClassName="page-placeholder"
                              queryKey={['page-image', page.id, page.generated_image.generated_at]}
                            />
                          ) : (
                            <div className="page-placeholder">
                              <LayoutGrid size={18} />
                            </div>
                          )}
                          <div className="page-meta-list">
                            <span>
                              {uiLanguage === 'ja'
                                ? `フレーム ${page.frame_count} / コマ ${page.panel_count}`
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
                      <PanelSection title="Page settings" className="page-section-settings" collapsible mobileDefaultCollapsed actions={
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
                        compact
                        collapsible
                        defaultCollapsed
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
                        subtitle={
                          uiLanguage === 'ja'
                            ? `セリフ ${translateUiString(uiLanguage, selectedPage.dialogue_mode === 'image_baked' ? 'Image baked' : 'Mixed')}`
                            : `dialogue ${selectedPage.dialogue_mode === 'image_baked' ? 'image_baked' : 'mixed'}`
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
                                  const result = await api.generatePage(selectedPage.id);
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
                                  await api.confirmPage(selectedPage.id);
                                  await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
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
                                  await api.reopenPage(selectedPage.id);
                                  await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
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
                              loadImage={() => api.exportPageImage(selectedPage.id)}
                              onDoubleClick={(url) => openImageLightbox(url, `${translateUiString(uiLanguage, 'Page')} ${selectedPage.page_number}`)}
                              placeholderClassName="page-placeholder generated-image"
                              queryKey={['page-image', selectedPage.id, selectedPage.generated_image.generated_at]}
                            />
                          </div>
                        ) : null}
                      </PanelSection>

                      <div className="page-editing-cluster page-section-frames-panels">
                      <PanelSection
                        title="Panel layout"
                        collapsible
                        actions={
                          <div className="toolbar">
                            <label className="field" style={{ minWidth: '14rem' }}>
                              <span>{translateUiString(uiLanguage, 'Template')}</span>
                              <select value={frameTemplateId} onChange={(event) => setFrameTemplateId(event.target.value)}>
                                {FRAME_TEMPLATE_OPTIONS.map(([value, label]) => (
                                  <option key={value} value={value}>
                                    {translateUiString(uiLanguage, label)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="ghost-button"
                              onClick={() =>
                                void runAction('Apply panel layout', async () => {
                                  const nextPanelCount = FRAME_TEMPLATE_PANEL_COUNTS[frameTemplateId] ?? selectedPagePanelCount;
                                  const deletedPanelCount = Math.max(selectedPagePanelCount - nextPanelCount, 0);
                                  if (deletedPanelCount > 0) {
                                    const confirmed = window.confirm(
                                      uiLanguage === 'ja'
                                        ? `後ろの${deletedPanelCount}コマを削除します。続行しますか？`
                                        : `This will remove ${deletedPanelCount} later panel(s). Continue?`,
                                    );
                                    if (!confirmed) {
                                      return;
                                    }
                                  }

                                  await api.applyPageLayoutTemplate(selectedPage.id, frameTemplateId, deletedPanelCount > 0);
                                  await queryClient.invalidateQueries({ queryKey: ['frames', selectedPage.id] });
                                  await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                                  if (selectedEpisode !== null) {
                                    await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
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
                            ? 'テンプレートを選ぶとコマ数も揃います。'
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
                                await api.replaceFrames(selectedPage.id, toPanelFramesPayload(frameDrafts));
                                await queryClient.invalidateQueries({ queryKey: ['frames', selectedPage.id] });
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
                            {translateUiString(uiLanguage, 'Create panel')}
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
                                {translateUiString(uiLanguage, 'Save panel')}
                              </button>
                              <button
                                className="ghost-button danger"
                                onClick={() => {
                                  if (!confirmUiAction('Delete this panel? This can break the frame/panel count until frames are adjusted.')) {
                                    return;
                                  }

                                  void runAction('Delete panel', async () => {
                                    await api.deletePanel(selectedPanel.id);
                                    setSelectedPanelId('');
                                    await queryClient.invalidateQueries({ queryKey: ['panels', selectedPage.id] });
                                    await queryClient.invalidateQueries({ queryKey: ['frames', selectedPage.id] });
                                    if (selectedEpisode !== null) {
                                      await queryClient.invalidateQueries({ queryKey: ['pages', selectedEpisode.id] });
                                    }
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

              <PanelSection title="Jobs" compact collapsible mobileDefaultCollapsed>
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

              <PanelSection title="Tutorial" subtitle="First run guide" compact collapsible defaultCollapsed>
                <TutorialGuide />
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

function AuthenticatedImage(props: {
  alt?: string;
  className?: string;
  enabled?: boolean;
  loadImage: () => Promise<BlobResponse>;
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
    return <div className={props.placeholderClassName ?? 'thumb-placeholder'} />;
  }

  return (
    <img
      alt={props.alt ?? ''}
      className={props.className}
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

function BillingPanel(props: {
  balance: BillingBalanceRecord | undefined;
  balanceRefreshing: boolean;
  billingReturnChecking: boolean;
  busyAction: string | null;
  onOpenPortal: () => void;
  onPurchaseCredits: (packageCode: CreditCheckoutPackageCode) => void;
  onStartSubscription: (planCode: SubscriptionCheckoutPlanCode) => void;
}) {
  const language = useContext(UiLanguageContext);
  const actionBusy = props.busyAction === 'Checkout subscription' || props.busyAction === 'Checkout credits' || props.busyAction === 'Open portal';
  const currentPlanCode = props.balance?.plan_code ?? null;
  const isPaidPlan = currentPlanCode === 'standard' || currentPlanCode === 'premium';
  const canSelectSubscriptionPlan = (planCode: SubscriptionCheckoutPlanCode): boolean => {
    if (actionBusy || currentPlanCode === null || currentPlanCode === planCode) {
      return false;
    }

    if (currentPlanCode === 'free') {
      return true;
    }

    if (currentPlanCode === 'standard') {
      return planCode === 'premium';
    }

    return false;
  };
  const paidPlanNote =
    currentPlanCode === 'standard'
      ? pickUiText(
          language,
          'Manage paid plan changes and cancellation from "Manage subscription and invoices".',
          '有料プランの変更・解約は「サブスク・請求を管理」で行ってください。',
        )
      : currentPlanCode === 'premium'
        ? pickUiText(
            language,
            'Manage paid plan changes and cancellation from "Manage subscription and invoices".',
            '有料プランの変更・解約は「サブスク・請求を管理」で行ってください。',
          )
        : null;
  const billingStatusMessage = actionBusy
    ? pickUiText(language, 'Preparing Stripe...', 'Stripeページを準備中...')
    : props.billingReturnChecking
      ? pickUiText(language, 'Confirming payment result...', '決済結果を確認中...')
      : props.balanceRefreshing
        ? pickUiText(language, 'Updating balance...', '残高を更新中...')
        : null;

  return (
    <PanelSection
      title="Credits"
      subtitle={pickUiText(language, 'Buy and manage credits', '購入と管理')}
      compact
      collapsible
      mobileDefaultCollapsed
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
            <span>{translateUiString(language, 'Current plan')}</span>
            <strong>{formatPlanLabel(language, props.balance.plan_code)}</strong>
          </div>
          <div className="metric-grid billing-balance-grid">
            <Metric label="Total" value={String(props.balance.total_credits)} />
            <Metric label="Monthly" value={String(props.balance.monthly_credits)} />
            <Metric label="Purchased" value={String(props.balance.purchased_credits)} />
          </div>
        </>
      ) : (
        <div className="billing-loading">
          <LoaderCircle className="spin" size={16} />
          <span>{pickUiText(language, 'Loading balance', '残高を読み込み中')}</span>
        </div>
      )}

      <div className="billing-block">
        <div className="billing-block-header">
          <strong>{pickUiText(language, 'Monthly plan', '月額プラン')}</strong>
          <span>{pickUiText(language, 'Best value', '最安単価')}</span>
        </div>
        {subscriptionPurchaseOptions.map((plan) => (
          <button
            className={`billing-option primary-billing-option ${currentPlanCode === plan.code ? 'current' : ''}`}
            disabled={!canSelectSubscriptionPlan(plan.code)}
            key={plan.code}
            onClick={() => props.onStartSubscription(plan.code)}
            type="button"
          >
            <span>
              <strong>{pickUiText(language, plan.label.en, plan.label.ja)}</strong>
              <small>
                {pickUiText(language, `${plan.credits} credits / month`, `月${plan.credits}クレジット`)}
              </small>
            </span>
            <span className="billing-price">
              {currentPlanCode === plan.code ? translateUiString(language, 'Current') : formatJpy(plan.priceJpy)}
            </span>
          </button>
        ))}
        {isPaidPlan && paidPlanNote !== null ? <div className="billing-note">{paidPlanNote}</div> : null}
      </div>

      <div className="billing-block">
        <div className="billing-block-header">
          <strong>{pickUiText(language, 'One-time credits', '単発クレジット')}</strong>
          <span>{pickUiText(language, 'No renewal', '更新なし')}</span>
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
                <strong>{pickUiText(language, `${pack.credits} credits`, `${pack.credits}クレジット`)}</strong>
                <small>{pickUiText(language, 'one-time', '買い切り')}</small>
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
        <span>{pickUiText(language, 'Manage subscription and invoices', 'サブスク・請求を管理')}</span>
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
  mobileDefaultOpen?: boolean;
  title: string;
}) {
  const language = useContext(UiLanguageContext);
  const isMobileViewport = useIsMobileViewport();
  const defaultOpen = !isMobileViewport || props.mobileDefaultOpen === true;
  const resetKey = `${props.title}:${String(isMobileViewport)}:${String(props.mobileDefaultOpen ?? false)}`;
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
      </CharacterFieldsGroup>

      <CharacterFieldsGroup title="Anchors">
        <StringChipListField
          label="Aliases"
          value={props.value.aliases}
          onChange={(value) => update({ aliases: value })}
          placeholderLabel="Alias placeholder"
          addLabel="Add alias"
          emptyLabel="No aliases yet."
        />
        <div className="form-grid two compact-grid">
          <SelectOrCustomField label="Visual anchor" value={props.value.visual_anchor} onChange={(value) => update({ visual_anchor: value })} options={CHARACTER_VISUAL_ANCHOR_OPTIONS} />
          <SelectOrCustomField label="Signature feature" value={props.value.signature_feature} onChange={(value) => update({ signature_feature: value })} options={CHARACTER_SIGNATURE_FEATURE_OPTIONS} />
        </div>
        <div className="form-grid two compact-grid">
          <SelectOrCustomField label="Silhouette keywords" value={props.value.silhouette_keywords} onChange={(value) => update({ silhouette_keywords: value })} options={CHARACTER_SILHOUETTE_KEYWORD_OPTIONS} />
          <SelectOrCustomField label="Distinguishing features" value={props.value.distinguishing_features} onChange={(value) => update({ distinguishing_features: value })} options={CHARACTER_DISTINGUISHING_FEATURE_OPTIONS} />
        </div>
        <div className="form-grid four compact-grid">
          <SelectOrCustomField label="Head/body ratio" value={props.value.head_to_body_ratio} onChange={(value) => update({ head_to_body_ratio: value })} options={CHARACTER_HEAD_RATIO_OPTIONS} />
          <SelectOrCustomField label="Shoulder width" value={props.value.shoulder_width} onChange={(value) => update({ shoulder_width: value })} options={CHARACTER_SHOULDER_WIDTH_OPTIONS} />
          <SelectOrCustomField label="Leg length" value={props.value.leg_length} onChange={(value) => update({ leg_length: value })} options={CHARACTER_LEG_LENGTH_OPTIONS} />
          <SelectOrCustomField label="Posture axis" value={props.value.posture_axis} onChange={(value) => update({ posture_axis: value })} options={CHARACTER_POSTURE_AXIS_OPTIONS} />
        </div>
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
  const storyInputMode = episode.story_input_mode;
  return {
    order: String(episode.order),
    title: episode.title ?? '',
    purpose: episode.purpose ?? '',
    story_input_mode: storyInputMode,
    story_full_draft: storyInputMode === 'full' ? episode.story_full_draft ?? '' : '',
    introduction: storyInputMode === 'structured' ? episode.introduction ?? '' : '',
    middle: storyInputMode === 'structured' ? episode.middle ?? '' : '',
    climax: storyInputMode === 'structured' ? episode.climax ?? '' : '',
    ending_hook: storyInputMode === 'structured' ? episode.ending_hook ?? '' : '',
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
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: draft.story_input_mode,
    story_full_draft: draft.story_input_mode === 'full' ? nullableString(draft.story_full_draft) : null,
    introduction: draft.story_input_mode === 'structured' ? nullableString(draft.introduction) : null,
    middle: draft.story_input_mode === 'structured' ? nullableString(draft.middle) : null,
    climax: draft.story_input_mode === 'structured' ? nullableString(draft.climax) : null,
    ending_hook: draft.story_input_mode === 'structured' ? nullableString(draft.ending_hook) : null,
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    entities_involved: splitEntityIdCsv(draft.entities_involved, allowedEntityIds),
    status: draft.status,
  };
}

function toEpisodeAutosavePayload(draft: EpisodeDraft): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: draft.story_input_mode,
    story_full_draft: draft.story_input_mode === 'full' ? nullableString(draft.story_full_draft) : null,
    introduction: draft.story_input_mode === 'structured' ? nullableString(draft.introduction) : null,
    middle: draft.story_input_mode === 'structured' ? nullableString(draft.middle) : null,
    climax: draft.story_input_mode === 'structured' ? nullableString(draft.climax) : null,
    ending_hook: draft.story_input_mode === 'structured' ? nullableString(draft.ending_hook) : null,
    estimated_pages: parseNumberInput(draft.estimated_pages, 'estimated pages'),
    status: draft.status,
  };
}

function toCreateEpisodePayload(
  draft: EpisodeDraft,
  allowedEntityIds?: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    order: parseNumberInput(draft.order, 'episode order'),
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: draft.story_input_mode,
    story_full_draft: draft.story_input_mode === 'full' ? nullableString(draft.story_full_draft) : null,
    introduction: draft.story_input_mode === 'structured' ? nullableString(draft.introduction) : null,
    middle: draft.story_input_mode === 'structured' ? nullableString(draft.middle) : null,
    climax: draft.story_input_mode === 'structured' ? nullableString(draft.climax) : null,
    ending_hook: draft.story_input_mode === 'structured' ? nullableString(draft.ending_hook) : null,
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
  return {
    title: nullableString(draft.title),
    purpose: nullableString(draft.purpose),
    story_input_mode: draft.story_input_mode,
    story_full_draft: draft.story_input_mode === 'full' ? nullableString(draft.story_full_draft) : null,
    introduction: draft.story_input_mode === 'structured' ? nullableString(draft.introduction) : null,
    middle: draft.story_input_mode === 'structured' ? nullableString(draft.middle) : null,
    climax: draft.story_input_mode === 'structured' ? nullableString(draft.climax) : null,
    ending_hook: draft.story_input_mode === 'structured' ? nullableString(draft.ending_hook) : null,
  };
}

function convertEpisodeDraftStoryInputMode(
  draft: EpisodeDraft,
  nextMode: EpisodeDraft['story_input_mode'],
): EpisodeDraft {
  if (draft.story_input_mode === nextMode) {
    return draft;
  }

  if (nextMode === 'full') {
    return {
      ...draft,
      story_input_mode: 'full',
      story_full_draft: draft.story_full_draft,
      introduction: '',
      middle: '',
      climax: '',
      ending_hook: '',
    };
  }

  const derivedSections = deriveEpisodeDraftSectionsFromFullStory(draft.story_full_draft);
  return {
    ...draft,
    story_input_mode: 'structured',
    story_full_draft: '',
    introduction: draft.introduction || derivedSections.introduction,
    middle: draft.middle || derivedSections.middle,
    climax: draft.climax || derivedSections.climax,
    ending_hook: draft.ending_hook || derivedSections.ending_hook,
  };
}

function applyStoryImprovementDraftToEpisodeDraft(
  draft: EpisodeDraft,
  improvement: StoryEpisodeImprovementRecord['draft'],
): EpisodeDraft {
  if (improvement.story_input_mode === 'full') {
    return {
      ...draft,
      title: improvement.title ?? draft.title,
      purpose: improvement.purpose ?? draft.purpose,
      story_input_mode: 'full',
      story_full_draft: improvement.story_full_draft ?? draft.story_full_draft,
      introduction: '',
      middle: '',
      climax: '',
      ending_hook: '',
    };
  }

  return {
    ...draft,
    title: improvement.title ?? draft.title,
    purpose: improvement.purpose ?? draft.purpose,
    story_input_mode: 'structured',
    story_full_draft: '',
    introduction: improvement.introduction ?? draft.introduction,
    middle: improvement.middle ?? draft.middle,
    climax: improvement.climax ?? draft.climax,
    ending_hook: improvement.ending_hook ?? draft.ending_hook,
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

function deriveEpisodeDraftSectionsFromFullStory(fullStoryDraft: string): {
  introduction: string;
  middle: string;
  climax: string;
  ending_hook: string;
} {
  const normalizedFullStory = normalizeTextInput(fullStoryDraft);
  if (normalizedFullStory === null) {
    return {
      introduction: '',
      middle: '',
      climax: '',
      ending_hook: '',
    };
  }

  const segments = splitEpisodeStorySegments(normalizedFullStory);
  if (segments.length === 0) {
    return {
      introduction: '',
      middle: '',
      climax: '',
      ending_hook: '',
    };
  }

  const bucketCount = Math.min(4, segments.length);
  const buckets = Array.from({ length: bucketCount }, () => [] as string[]);

  for (let index = 0; index < segments.length; index += 1) {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor((index * bucketCount) / segments.length));
    buckets[bucketIndex]?.push(segments[index] ?? '');
  }

  return {
    introduction: buckets[0]?.join('\n\n') ?? '',
    middle: buckets[1]?.join('\n\n') ?? '',
    climax: buckets[2]?.join('\n\n') ?? '',
    ending_hook: buckets[3]?.join('\n\n') ?? '',
  };
}

function splitEpisodeStorySegments(fullStoryDraft: string): string[] {
  const paragraphs = fullStoryDraft
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const sentences = splitEpisodeStoryIntoSentences(fullStoryDraft);
  if (sentences.length > 0) {
    return sentences;
  }

  return [fullStoryDraft];
}

function splitEpisodeStoryIntoSentences(fullStoryDraft: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (let index = 0; index < fullStoryDraft.length; index += 1) {
    const character = fullStoryDraft[index] ?? '';
    current += character;
    if (isEpisodeStorySentenceBoundary(character, fullStoryDraft[index + 1] ?? '')) {
      const normalized = current.trim();
      if (normalized.length > 0) {
        sentences.push(normalized);
      }
      current = '';
    }
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    sentences.push(trailing);
  }

  return sentences;
}

function isEpisodeStorySentenceBoundary(current: string, next: string): boolean {
  if (current === '。' || current === '！' || current === '？' || current === '!' || current === '?') {
    return true;
  }

  if (current !== '.') {
    return false;
  }

  return next === '' || next === ' ' || next === '\n';
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
    story_input_mode: 'structured',
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
  return {
    dialogue_mode: page.dialogue_mode === 'balloon_only' ? 'mixed' : page.dialogue_mode,
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
  ['top_wide_3', 'Top wide 3'],
  ['standard_6', 'Standard 6'],
  ['dense_8', 'Dense 8'],
  ['climax_2', 'Climax 2'],
  ['splash_1', 'Splash 1'],
  ['action_5', 'Action 5'],
  ['battle_7', 'Battle 7'],
];
const FRAME_TEMPLATE_PANEL_COUNTS: Record<string, number> = {
  standard_4: 4,
  top_wide_3: 3,
  standard_6: 6,
  dense_8: 8,
  climax_2: 2,
  splash_1: 1,
  action_5: 5,
  battle_7: 7,
};
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
    if (seenKeys.has(candidate.s3_key)) {
      return false;
    }

    seenKeys.add(candidate.s3_key);
    return true;
  });
}

function sameReferenceCandidates(left: ReferenceCandidate[], right: ReferenceCandidate[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (candidate, index) =>
        candidate.s3_key === right[index]?.s3_key &&
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
      typeof (candidate as { s3_key?: unknown }).s3_key !== 'string'
    ) {
      return [];
    }

    return [
      {
        s3_key: (candidate as { s3_key: string }).s3_key,
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

function normalizeTextInput(value: string): string | null {
  return nullableString(value);
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

function createBillingReturnMarker(
  kind: BillingReturnMarker['kind'],
  balance: BillingBalanceRecord | undefined,
  details: Pick<BillingReturnMarker, 'planCode' | 'packageCode'> = {},
): BillingReturnMarker {
  return {
    kind,
    createdAt: Date.now(),
    planCode: details.planCode,
    packageCode: details.packageCode,
    initialPlanCode: balance?.plan_code,
    initialTotalCredits: balance?.total_credits,
    initialPurchasedCredits: balance?.purchased_credits,
  };
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
      planCode: parsed.planCode === 'standard' || parsed.planCode === 'premium' ? parsed.planCode : undefined,
      packageCode:
        parsed.packageCode === 'credits_200' || parsed.packageCode === 'credits_1000' || parsed.packageCode === 'credits_3000'
          ? parsed.packageCode
          : undefined,
      initialPlanCode:
        parsed.initialPlanCode === 'free' || parsed.initialPlanCode === 'standard' || parsed.initialPlanCode === 'premium'
          ? parsed.initialPlanCode
          : undefined,
      initialTotalCredits: typeof parsed.initialTotalCredits === 'number' ? parsed.initialTotalCredits : undefined,
      initialPurchasedCredits: typeof parsed.initialPurchasedCredits === 'number' ? parsed.initialPurchasedCredits : undefined,
    };
  } catch {
    return null;
  }
}

function isBillingReturnSatisfied(balance: BillingBalanceRecord, marker: BillingReturnMarker): boolean {
  if (marker.kind === 'subscription' && marker.planCode !== undefined) {
    return balance.plan_code === marker.planCode;
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
    return pickUiText(language, 'Opening Stripe billing...', 'Stripeの請求管理を開いています。');
  }
  return pickUiText(language, 'Preparing Stripe checkout...', 'Stripeの決済ページを準備中です。');
}
function formatBillingReturnPendingMessage(language: UiLanguage, kind: BillingReturnMarker['kind']): string {
  if (kind === 'subscription') {
    return pickUiText(language, 'Confirming your plan...', 'プランを確認中です。');
  }
  if (kind === 'credits') {
    return pickUiText(language, 'Confirming your credits...', 'クレジットを確認中です。');
  }
  return pickUiText(language, 'Refreshing billing...', '請求情報を更新中です。');
}

function formatBillingReturnSuccessMessage(language: UiLanguage, kind: BillingReturnMarker['kind']): string {
  if (kind === 'subscription') {
    return pickUiText(language, 'Plan updated.', 'プランを更新しました。');
  }
  if (kind === 'credits') {
    return pickUiText(language, 'Credits updated.', 'クレジットを更新しました。');
  }
  return pickUiText(language, 'Billing updated.', '請求情報を更新しました。');
}

function formatBillingReturnTimeoutMessage(language: UiLanguage): string {
  return pickUiText(
    language,
    'Payment is still being confirmed. The balance will update automatically after Stripe finishes processing.',
    '決済結果をまだ確認中です。Stripeの処理後に残高へ反映されます。',
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




