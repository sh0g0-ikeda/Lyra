export type PanelEntityRole = 'primary' | 'secondary' | 'background';
export type PanelEntityExpression = 'determined' | 'calm' | 'angry' | 'sad' | 'surprised' | 'custom';
export type PanelEntityAction = 'standing_firm' | 'attacking' | 'defending' | 'running' | 'custom';
export type PanelEntityPosition = 'left' | 'center' | 'right' | 'background';

export interface PanelEntityAssignment {
  entityId: string;
  role: PanelEntityRole;
  expression: PanelEntityExpression;
  customExpression: string | null;
  action: PanelEntityAction;
  customAction: string | null;
  position: PanelEntityPosition;
  stateId: string | null;
}

export interface PanelEntityStateReference {
  entityId: string;
  stateId: string;
}
