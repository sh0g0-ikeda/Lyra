export interface ManuscriptPanelSlot { pageId: string; order: number }

export interface EpisodeManuscriptPlan {
  blocks: Array<{
    id: string;
    text: string;
    anchor: string;
    fixedPanel: boolean;
    slots: ManuscriptPanelSlot[];
  }>;
  directions: Array<{ instruction: string; anchor: string; blockId: string }>;
}
