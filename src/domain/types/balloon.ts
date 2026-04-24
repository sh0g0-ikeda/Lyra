export type BalloonType = 'speech' | 'thought' | 'narration' | 'shout' | 'whisper' | 'sfx' | 'caption';
export type BalloonWritingMode = 'vertical' | 'horizontal';
export type BalloonFontFamily = 'manga_gothic' | 'mincho' | 'rounded' | 'bold';

export interface BalloonPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BalloonTail {
  baseX: number;
  baseY: number;
  tipX: number;
  tipY: number;
}

export interface Balloon {
  id: string;
  pageId: string;
  speakerEntityId: string | null;
  balloonType: BalloonType;
  writingMode: BalloonWritingMode;
  text: string;
  position: BalloonPosition;
  tail: BalloonTail | null;
  fontSize: number;
  fontFamily: BalloonFontFamily;
  panelOrderReference: number | null;
  zIndex: number;
}

export interface CreateBalloonInput {
  speakerEntityId: string | null;
  balloonType: BalloonType;
  writingMode: BalloonWritingMode;
  text: string;
  position: BalloonPosition;
  tail: BalloonTail | null;
  fontSize: number;
  fontFamily: BalloonFontFamily;
  panelOrderReference: number | null;
  zIndex: number;
}

export interface UpdateBalloonInput {
  speakerEntityId?: string | null;
  balloonType?: BalloonType;
  writingMode?: BalloonWritingMode;
  text?: string;
  position?: BalloonPosition;
  tail?: BalloonTail | null;
  fontSize?: number;
  fontFamily?: BalloonFontFamily;
  panelOrderReference?: number | null;
  zIndex?: number;
}
