import { useCallback, useEffect, useRef, useState } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MangaLibrary } from '@/components/MangaLibrary';
import { EmbeddedScreenProvider } from '@/components/Screen';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useWorkspaceContextSelection } from '@/components/WorkspaceContextPicker';
import { colors, radius, spacing, textStyles } from '@/constants/theme';
import { episodeMobileDraft } from '@/domain/episodeMobileDraft';
import { mangaCreationSteps, mangaWorkflowScopeKey, resumeMangaStep, type MangaCreationStep } from '@/domain/mangaWorkflow';
import { t } from '@/lib/i18n';
import { MOBILE_LIST_PAGE_SIZE, nextCursorFromPage } from '@/lib/listPagination';
import { pagesInfiniteQueryKey } from '@/lib/queryKeys';
import type { MobileTabParamList } from '@/navigation/tabs';
import { CharactersScreen } from '@/screens/CharactersScreen';
import { PagesScreen } from '@/screens/PagesScreen';
import { StoryScreen } from '@/screens/StoryScreen';
import { useAppState } from '@/state/appState';
import { MangaWorkflowContext, type MangaStateCandidate } from '@/state/mangaWorkflow';
import { useDirtyState } from '@/state/dirtyState';

interface WorkflowView {
  scopeKey: string;
  step: MangaCreationStep | null;
  visited: MangaCreationStep[];
}

// Design 05 §1 / step 08: compose existing editors without changing their save,
// generation, export, account, or workspace contracts. Page drafts intentionally
// do not block navigation, so visited page/story instances remain mounted and
// inaccessible while hidden. Character editors have a blocking dirty guard and
// are exclusive to the focused route to avoid duplicate global registrations.
export function MangaScreen(): React.JSX.Element {
  const { api, language, selection, sessionKey, updateSelection } = useAppState();
  const { resolveDirtyEditors } = useDirtyState();
  const focused = useIsFocused();
  const navigation = useNavigation<BottomTabNavigationProp<MobileTabParamList>>();
  const route = useRoute<RouteProp<MobileTabParamList, 'Story'>>();
  const { top } = useSafeAreaInsets();
  const context = useWorkspaceContextSelection();
  const scopeKey = mangaWorkflowScopeKey(sessionKey, selection);
  const [workflow, setWorkflow] = useState<WorkflowView>({ scopeKey, step: null, visited: [] });
  const [stateCandidate, setStateCandidate] = useState<{ scopeKey: string; value: MangaStateCandidate } | null>(null);
  const pageBackHandler = useRef<(() => boolean) | null>(null);
  const registerPageBackHandler = useCallback((handler: () => boolean): (() => void) => {
    pageBackHandler.current = handler;
    return () => { if (pageBackHandler.current === handler) pageBackHandler.current = null; };
  }, []);
  const requestVersion = useRef(0);
  const handledRouteRequest = useRef<string | null>(null);
  const step = workflow.scopeKey === scopeKey ? workflow.step : null;
  const episode = context.episodes.find((item) => item.id === context.selectedEpisodeId);
  const pagesQuery = useInfiniteQuery({
    enabled: context.selectedEpisodeId !== null,
    queryKey: pagesInfiniteQueryKey(sessionKey, context.selectedEpisodeId, selection.organizationId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.getPagesPage(context.selectedEpisodeId ?? '', {
      organizationId: selection.organizationId,
      limit: MOBILE_LIST_PAGE_SIZE,
      cursor: pageParam
    }),
    getNextPageParam: nextCursorFromPage
  });
  const resumeStep = resumeMangaStep({
    hasEpisode: episode !== undefined,
    hasPages: selection.pageId !== null || episode?.page_skeleton_generated === true ||
      (pagesQuery.data?.pages.some((page) => page.pages.length > 0) ?? false),
    savedStory: episode === undefined ? '' : episodeMobileDraft(episode)
  });

  useEffect(() => {
    // A pending dirty answer cannot reopen an earlier scope or an unfocused tab.
    requestVersion.current += 1;
    return () => { requestVersion.current += 1; };
  }, [scopeKey, focused]);

  const openStep = useCallback(async (next: MangaCreationStep | null): Promise<void> => {
    const request = ++requestVersion.current;
    if (!focused || next === step) return;
    if (!(await resolveDirtyEditors(language)) || request !== requestVersion.current) return;
    setWorkflow((current) => ({
      scopeKey,
      step: next,
      visited: next === null || current.visited.includes(next) ? current.visited : [...current.visited, next]
    }));
  }, [focused, language, resolveDirtyEditors, scopeKey, step]);

  const requestStateCandidate = useCallback(async (candidate: MangaStateCandidate): Promise<boolean> => {
    const request = ++requestVersion.current;
    if (!focused || selection.workId === null || !(await resolveDirtyEditors(language))) return false;
    const entity = await api.getEntity(candidate.entityId, selection.organizationId);
    if (request !== requestVersion.current) return false;
    if (entity.work_id !== selection.workId) throw new Error('State candidate is not available in this work');
    if (!(await updateSelection({ entityId: candidate.entityId })) || request !== requestVersion.current) return false;
    setStateCandidate({ scopeKey, value: candidate });
    setWorkflow((current) => ({ scopeKey, step: 'characters', visited: current.visited.includes('characters') ? current.visited : [...current.visited, 'characters'] }));
    return true;
  }, [api, focused, language, resolveDirtyEditors, scopeKey, selection.organizationId, selection.workId, updateSelection]);

  useEffect(() => {
    const requested = route.params;
    if (!focused || requested === undefined) return;
    const requestKey = `${requested.requestId}:${requested.step}`;
    if (handledRouteRequest.current === requestKey) return;
    handledRouteRequest.current = requestKey;
    void openStep(requested.step);
  }, [focused, openStep, route.params]);

  const goBack = useCallback((): void => {
    const index = step === null ? -1 : mangaCreationSteps.indexOf(step);
    void openStep(index <= 0 ? null : mangaCreationSteps[index - 1]);
  }, [openStep, step]);

  useEffect(() => {
    if (!focused || step === null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'pages' && pageBackHandler.current?.()) return true;
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [focused, goBack, step]);

  const hidden = (target: MangaCreationStep): boolean => !focused || step !== target;
  return (
    <MangaWorkflowContext.Provider value={{ requestStateCandidate, registerPageBackHandler, activeStep: focused ? step : null }}>
    <View style={styles.root} testID="manga-workflow">
      {step === null ? (
        <MangaLibrary
          context={context}
          loadingProgress={episode !== undefined && pagesQuery.isPending && pagesQuery.isFetching}
          onOpenGuide={() => { void resolveDirtyEditors(language).then((allowed) => { if (allowed) navigation.navigate('Guide'); }); }}
          onResume={() => void openStep(resumeStep)}
          onStartStory={() => void openStep('story')}
          onRetryProgress={() => { void pagesQuery.refetch(); }}
          progressError={pagesQuery.error}
          resumeStep={resumeStep}
        />
      ) : (
        <View style={[styles.header, { paddingTop: top + spacing.xs }]}>
          <Pressable accessibilityRole="button" onPress={() => void openStep(null)} style={styles.libraryLink} testID="manga-back-library">
            <Text style={styles.linkText}>{t(language, 'navigation.library')}</Text>
          </Pressable>
          <View accessibilityLabel={t(language, 'navigation.workflow')} style={styles.steps}>
            {mangaCreationSteps.map((target, index) => {
              const disabled = target === 'characters' ? selection.workId === null : target === 'pages' && selection.episodeId === null;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: step === target, disabled }}
                  disabled={disabled}
                  key={target}
                  onPress={() => void openStep(target)}
                  style={[styles.step, target === step ? styles.selectedStep : null, disabled ? styles.disabledStep : null]}
                  testID={`manga-step-${target}`}
                >
                  <Text style={[styles.stepLabel, target === step ? styles.selectedLabel : null]}>{index + 1}. {t(language, target)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <EmbeddedScreenProvider>
      {workflow.visited.includes('story') ? (
        <View accessibilityElementsHidden={hidden('story')} importantForAccessibility={hidden('story') ? 'no-hide-descendants' : 'auto'} style={hidden('story') ? styles.hidden : styles.editor} testID="manga-story-editor">
          <StoryScreen onOpenCharacters={() => void openStep('characters')} />
        </View>
      ) : null}
      {focused && step === 'characters' ? <View style={styles.editor} testID="manga-characters-editor"><CharactersScreen secondaryActions initialStateCandidate={stateCandidate?.scopeKey === scopeKey ? stateCandidate.value : undefined} onReturnToPages={() => void openStep('pages')} /></View> : null}
      {workflow.visited.includes('pages') ? (
        <View accessibilityElementsHidden={hidden('pages')} importantForAccessibility={hidden('pages') ? 'no-hide-descendants' : 'auto'} style={hidden('pages') ? styles.hidden : styles.editor} testID="manga-pages-editor">
          <PagesScreen />
        </View>
      ) : null}
      </EmbeddedScreenProvider>
      {step === null ? null : (
        <View style={styles.actions}>
          <View style={styles.action}><PrimaryButton label={t(language, 'navigation.previous')} onPress={goBack} variant="ghost" testID="manga-previous" /></View>
          {step === 'pages' ? null : <View style={styles.action}><PrimaryButton
            label={t(language, step === 'story' ? 'navigation.nextCharacters' : 'navigation.nextPages')}
            onPress={() => void openStep(step === 'story' ? 'characters' : 'pages')}
            disabled={step === 'story' ? selection.workId === null : selection.episodeId === null}
            testID="manga-next"
          /></View>}
        </View>
      )}
    </View>
    </MangaWorkflowContext.Provider>
  );
}

const styles = StyleSheet.create({
  action: { flex: 1, minWidth: 140 },
  actions: { backgroundColor: colors.canvas, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm },
  disabledStep: { opacity: 0.45 },
  editor: { flex: 1 },
  header: { backgroundColor: colors.canvas, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  hidden: { display: 'none' },
  libraryLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { ...textStyles.body, color: colors.primary },
  root: { flex: 1, backgroundColor: colors.canvas },
  selectedLabel: { color: colors.primaryText },
  selectedStep: { backgroundColor: colors.primary, borderColor: colors.primary },
  step: { flex: 1, minWidth: 94, minHeight: 44, borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radius.sm, justifyContent: 'center', padding: spacing.sm },
  stepLabel: { ...textStyles.caption, color: colors.inkStrong, textAlign: 'center', fontWeight: '700' },
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }
});
