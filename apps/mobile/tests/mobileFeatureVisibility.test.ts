import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  characterContinuityStateUiEnabled,
  pageLayoutEditingUiEnabled,
  panelCharacterStateOverrideUiEnabled
} from '@/constants/mobileFeatureVisibility';

describe('Mobile feature visibility', () => {
  it('キャラ状態管理UIを公開準備が整うまで表示しない', () => {
    expect(characterContinuityStateUiEnabled).toBe(false);
    expect(panelCharacterStateOverrideUiEnabled).toBe(false);
    expect(pageLayoutEditingUiEnabled).toBe(false);
  });

  it('旧機能フラグを維持し状態画像previewはserver能力と見積で閉じる', () => {
    const characters = readFileSync(
      resolve(process.cwd(), 'src/screens/CharactersScreen.tsx'),
      'utf8'
    );
    const pages = readFileSync(
      resolve(process.cwd(), 'src/screens/PagesScreen.tsx'),
      'utf8'
    );
    const app = readFileSync(
      resolve(process.cwd(), 'src/App.tsx'),
      'utf8'
    );
    const appState = readFileSync(
      resolve(process.cwd(), 'src/state/appState.tsx'),
      'utf8'
    );

    expect(characters).toContain('characterContinuityStateUiEnabled ? (');
    expect(pages).toContain('<EntityStatePicker');
    const stateEditor = readFileSync(resolve(process.cwd(), 'src/components/EntityStateEditor.tsx'), 'utf8');
    const statePolicy = readFileSync(resolve(process.cwd(), 'src/domain/entityStateEditor.ts'), 'utf8');
    expect(stateEditor).toContain('session?.capabilities?.entity_state_reference_generation === true && session?.capabilities?.generation_quotes === true');
    expect(stateEditor).toContain("!quotedPreviewEnabled ? 'unavailable'");
    expect(stateEditor).toContain('<AssetGenerationQuoteDialog');
    expect(stateEditor).not.toContain('api.generateEntityStateReference(');
    expect(statePolicy).toContain('capabilities?.entity_state_reference_generation === true && cost !== null');
    expect(statePolicy).toContain("state.reference_status === 'confirmed' && state.reference_image != null");
    expect(pages).toContain('pageLayoutEditingUiEnabled ? (');
    expect(pages).toContain(
      'onLayout={pageLayoutEditingUiEnabled ? () => setTemplateModalVisible(true) : undefined}'
    );
    expect(app).toContain('canRegisterPushNotifications(sessionQuery.data) ? <PushNotificationCoordinator /> : null');
    expect(appState).toContain('await unregisterPushNotifications(api);');
  });
});
