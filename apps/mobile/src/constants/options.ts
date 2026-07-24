import type {
  EntityType,
  PanelDialogueLine,
  PanelEntityAssignmentRecord,
  PanelRecord
} from '@/domain/types';

export interface LabelOption<T extends string> {
  value: T;
  labelJa: string;
  labelEn: string;
}

export const entityTypes: LabelOption<EntityType>[] = [
  { value: 'character', labelJa: '人物', labelEn: 'Character' },
  { value: 'nonhuman', labelJa: '人外', labelEn: 'Nonhuman' },
  { value: 'object', labelJa: '物・道具', labelEn: 'Object' }
];

export const panelRoleOptions: LabelOption<PanelRecord['panel_role']>[] = [
  { value: 'establish', labelJa: '導入', labelEn: 'Establish' },
  { value: 'action', labelJa: '行動', labelEn: 'Action' },
  { value: 'reaction', labelJa: '反応', labelEn: 'Reaction' },
  { value: 'emphasis', labelJa: '強調', labelEn: 'Emphasis' },
  { value: 'transition', labelJa: '転換', labelEn: 'Transition' },
  { value: 'pause', labelJa: '間', labelEn: 'Pause' },
  { value: 'impact', labelJa: '衝撃', labelEn: 'Impact' }
];

export const panelSizeOptions: LabelOption<PanelRecord['panel_size']>[] = [
  { value: 'standard', labelJa: '標準', labelEn: 'Standard' },
  { value: 'large', labelJa: '大', labelEn: 'Large' },
  { value: 'wide', labelJa: '横長', labelEn: 'Wide' },
  { value: 'narrow', labelJa: '細長', labelEn: 'Narrow' },
  { value: 'splash', labelJa: '大ゴマ', labelEn: 'Splash' }
];

export const dialogueTypeOptions: LabelOption<PanelDialogueLine['type']>[] = [
  { value: 'speech', labelJa: 'セリフ', labelEn: 'Speech' },
  { value: 'thought', labelJa: '思考', labelEn: 'Thought' },
  { value: 'narration', labelJa: 'ナレーション', labelEn: 'Narration' },
  { value: 'shout', labelJa: '叫び', labelEn: 'Shout' },
  { value: 'whisper', labelJa: 'ささやき', labelEn: 'Whisper' }
];

export const dialoguePositionOptions: LabelOption<PanelDialogueLine['position']>[] = [
  { value: 'top', labelJa: '上', labelEn: 'Top' },
  { value: 'bottom', labelJa: '下', labelEn: 'Bottom' },
  { value: 'left', labelJa: '左', labelEn: 'Left' },
  { value: 'right', labelJa: '右', labelEn: 'Right' },
  { value: 'center', labelJa: '中央', labelEn: 'Center' }
];

export const panelEntityRoleOptions: LabelOption<PanelEntityAssignmentRecord['role']>[] = [
  { value: 'primary', labelJa: '主役', labelEn: 'Primary' },
  { value: 'secondary', labelJa: '副', labelEn: 'Secondary' },
  { value: 'background', labelJa: '背景', labelEn: 'Background' }
];

export const panelEntityPositionOptions: LabelOption<PanelEntityAssignmentRecord['position']>[] = [
  { value: 'left', labelJa: '左', labelEn: 'Left' },
  { value: 'center', labelJa: '中央', labelEn: 'Center' },
  { value: 'right', labelJa: '右', labelEn: 'Right' },
  { value: 'background', labelJa: '背景', labelEn: 'Background' }
];

export const panelEntityFacingOptions: LabelOption<NonNullable<PanelEntityAssignmentRecord['facing_direction']>>[] = [
  { value: 'front', labelJa: '正面', labelEn: 'Front' },
  { value: 'left', labelJa: '左向き', labelEn: 'Left' },
  { value: 'right', labelJa: '右向き', labelEn: 'Right' },
  { value: 'away', labelJa: '背中', labelEn: 'Away' },
  { value: 'three_quarter_left', labelJa: '左斜め', labelEn: '3/4 left' },
  { value: 'three_quarter_right', labelJa: '右斜め', labelEn: '3/4 right' }
];

export const panelEntityExpressionOptions: LabelOption<PanelEntityAssignmentRecord['expression']>[] = [
  { value: 'determined', labelJa: '決意', labelEn: 'Determined' },
  { value: 'calm', labelJa: '冷静', labelEn: 'Calm' },
  { value: 'angry', labelJa: '怒り', labelEn: 'Angry' },
  { value: 'sad', labelJa: '悲しみ', labelEn: 'Sad' },
  { value: 'surprised', labelJa: '驚き', labelEn: 'Surprised' },
  { value: 'custom', labelJa: '自由入力', labelEn: 'Custom' }
];

export const panelEntityActionOptions: LabelOption<PanelEntityAssignmentRecord['action']>[] = [
  { value: 'standing_firm', labelJa: '踏ん張る', labelEn: 'Standing firm' },
  { value: 'attacking', labelJa: '攻撃', labelEn: 'Attacking' },
  { value: 'defending', labelJa: '防御', labelEn: 'Defending' },
  { value: 'running', labelJa: '走る', labelEn: 'Running' },
  { value: 'custom', labelJa: '自由入力', labelEn: 'Custom' }
];

export const panelCompositionSourceOptions: LabelOption<PanelRecord['composition']['source']>[] = [
  { value: 'ai_auto', labelJa: 'AI自動', labelEn: 'AI auto' },
  { value: 'gallery', labelJa: 'ギャラリー', labelEn: 'Gallery' },
  { value: 'custom', labelJa: '自由指定', labelEn: 'Custom' }
];

export const shotTypeOptions: LabelOption<string>[] = [
  { value: '', labelJa: '-', labelEn: '-' },
  { value: 'full_body', labelJa: '全身', labelEn: 'Full body' },
  { value: 'half_body', labelJa: '半身', labelEn: 'Half body' },
  { value: 'close_up', labelJa: 'アップ', labelEn: 'Close up' },
  { value: 'wide', labelJa: '引き', labelEn: 'Wide' },
  { value: 'extreme_close_up', labelJa: '極端なアップ', labelEn: 'Extreme close up' }
];

export const angleOptions: LabelOption<string>[] = [
  { value: '', labelJa: '-', labelEn: '-' },
  { value: 'front', labelJa: '正面', labelEn: 'Front' },
  { value: 'side', labelJa: '横', labelEn: 'Side' },
  { value: 'three_quarter', labelJa: '斜め', labelEn: 'Three quarter' },
  { value: 'bird_eye', labelJa: '俯瞰', labelEn: 'Bird eye' },
  { value: 'worm_eye', labelJa: 'あおり', labelEn: 'Worm eye' },
  { value: 'dutch_angle', labelJa: '傾き', labelEn: 'Dutch angle' }
];

export const panelAssignmentDefaults: PanelEntityAssignmentRecord = {
  entity_id: '',
  role: 'primary',
  expression: 'calm',
  custom_expression: null,
  action: 'standing_firm',
  custom_action: null,
  position: 'center',
  facing_direction: 'front',
  effect_note: null,
  state_id: null
};
