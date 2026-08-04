interface PanelDialoguePlacementNoticeProps {
  dialogueInPanel: boolean;
  language: 'ja' | 'en';
  onOpenWeb: () => void;
}

export function PanelDialoguePlacementNotice({
  dialogueInPanel: _dialogueInPanel,
  language: _language,
  onOpenWeb: _onOpenWeb
}: PanelDialoguePlacementNoticeProps): null {
  // The placement remains in the saved page payload; mobile does not need a blocking notice.
  return null;
}
