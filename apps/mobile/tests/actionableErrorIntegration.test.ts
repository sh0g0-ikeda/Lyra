import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readMobileSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('actionable error screen integration', () => {
  it.each([
    'src/screens/StoryScreen.tsx',
    'src/screens/CharactersScreen.tsx'
  ])('%s renders shared actionable API errors', (relativePath) => {
    const source = readMobileSource(relativePath);

    expect(source).toContain("from '@/components/ActionableErrorNotice'");
    expect(source).toContain('<ActionableErrorNotice');
  });

  it('Pages delegates recovery behavior to its component-tested error notice', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).toContain(
      "from '@/components/PageErrorRecoveryNotice'"
    );
    expect(source).toContain('<PageErrorRecoveryNotice');
  });

  it('Pagesは取得不能・失敗・中止になったローカルジョブを解除する', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).toContain('onMissing={async () => {');
    expect(source).toContain('onFailed={async () => {');
    expect(source).toContain('onCanceled={async () => {');
    expect(source).toContain('setLocalPageDesignJob((current) =>');
    expect(source).toContain('setLocalJob((current) =>');
  });

  it('uses React Navigation in Characters instead of a browser global', () => {
    const source = readMobileSource('src/screens/CharactersScreen.tsx');

    expect(source).toContain("import { useNavigation } from '@react-navigation/native'");
    expect(source).toContain(
      'useNavigation<BottomTabNavigationProp<MobileTabParamList>>()'
    );
  });

  it('gives active job, credit, and frame mismatch blockers direct actions', () => {
    const pages = readMobileSource('src/screens/PagesScreen.tsx');
    const characters = readMobileSource('src/screens/CharactersScreen.tsx');

    expect(pages).toContain("pageGenerationBlockerRecoveryTarget(blocker.code)");
    expect(pages).toContain("errorRecoveryActionLabel(recoveryTarget, language)");
    expect(characters).toContain(
      "entityGenerationBlockerRecoveryTarget(code)"
    );
  });

  it('gives the shared workspace hierarchy query its own recovery commands', () => {
    const source = readMobileSource(
      'src/components/WorkspaceContextPicker.tsx'
    );

    expect(source).toContain("from '@/components/ActionableErrorNotice'");
    expect(source).toContain('retry: () => {');
    expect(source).toContain('<ActionableErrorNotice');
    expect(source).toContain('retry: context.retry');
    expect(source).toContain("navigationRef.navigate('Account')");
  });

  it('gives invitation preview and acceptance failures retry and account recovery actions', () => {
    const source = readMobileSource('src/screens/InvitationScreen.tsx');

    expect(source).toContain("from '@/components/ActionableErrorNotice'");
    expect(source).toContain('<ActionableErrorNotice');
    expect(source).toContain('retry: () => {');
    expect(source).toContain('void previewQuery.refetch()');
    expect(source).toContain('acceptMutation.mutate()');
    expect(source).toContain('login: () => {');
    expect(source).toContain('workspace: () => {');
  });

  it('Accountは一時的な残高・ジョブ履歴取得失敗を赤いエラーとして表示しない', () => {
    const source = readMobileSource('src/screens/AccountScreen.tsx');

    expect(source).not.toContain('balanceQuery.isError ? (');
    expect(source).not.toContain('jobsQuery.isError &&');
    expect(source).toContain('jobs.length === 0 && jobsQuery.isSuccess');
  });

  it('Accountから利用規約・プライバシー・問い合わせへ移動できる', () => {
    const source = readMobileSource('src/screens/AccountScreen.tsx');

    expect(source).toContain("terms: 'https://app.lyra-editor.com/terms.html'");
    expect(source).toContain("privacy: 'https://app.lyra-editor.com/privacy.html'");
    expect(source).toContain("support: 'https://app.lyra-editor.com/support.html'");
    expect(source).toContain("t(language, 'screen.terms.termsLink')");
    expect(source).toContain("t(language, 'screen.terms.privacyLink')");
    expect(source).toContain("t(language, 'screen.terms.supportLink')");
  });

  it('reloads the authoritative page draft when PAGE_STALE is the primary error', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).toContain('onReloadStale={() => {');
    expect(source).toContain('void reloadAfterPageStale()');
  });
});
