import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readMobileSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('actionable error screen integration', () => {
  it.each([
    'src/screens/StoryScreen.tsx',
    'src/screens/CharactersScreen.tsx',
    'src/screens/AccountScreen.tsx'
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

  it('lets account errors return to the personal workspace', () => {
    const source = readMobileSource('src/screens/AccountScreen.tsx');

    expect(source).toContain('const selectPersonalWorkspace = (): void => {');
    expect(source).toContain('workspace: selectPersonalWorkspace');
  });

  it('ジョブ履歴の読み込み失敗を審査用画面の汎用エラーとして表示しない', () => {
    const source = readMobileSource('src/screens/AccountScreen.tsx');

    expect(source).not.toContain('{jobsQuery.isError ? (');
  });

  it('一時的に利用できないジョブ履歴のエラー文言を表示しない', () => {
    const source = readMobileSource('src/components/JobStatusCard.tsx');

    expect(source).toContain("job.message_key === 'job.error.temporarilyUnavailable'");
    expect(source).toContain('const statusMessage = job === undefined ? null : jobStatusMessage(job, language);');
  });

  it('reloads the authoritative page draft when PAGE_STALE is the primary error', () => {
    const source = readMobileSource('src/screens/PagesScreen.tsx');

    expect(source).toContain('onReloadStale={() => {');
    expect(source).toContain('void reloadAfterPageStale()');
  });
});
