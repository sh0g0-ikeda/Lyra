import { useEffect, useRef } from 'react';
import { firstPanelForPage } from '@/domain/pageSelection';

interface PagePanelSelectionInput {
  page: { id: string } | null;
  selectionScope: string;
  panels: readonly { id: string; order: number; page_id: string }[] | undefined;
  panelsLoaded: boolean;
  panelsFetching?: boolean;
  onSelect: (id: string | null) => void;
}

/** Read once per page/scope; refreshing cannot replace the user's later selection. */
export function usePagePanelSelection({
  page, selectionScope, panels, panelsLoaded, panelsFetching = false, onSelect
}: PagePanelSelectionInput): void {
  const initialized = useRef<{ scope: string | null; selected: boolean }>({ scope: null, selected: false });
  const pageId = page?.id ?? null;
  const scope = pageId === null ? null : JSON.stringify([selectionScope, pageId]);
  useEffect(() => {
    if (initialized.current.scope !== scope) {
      initialized.current = { scope, selected: false };
      onSelect(null);
    }
    if (pageId === null || !panelsLoaded || initialized.current.selected) return;
    const first = firstPanelForPage(pageId, panels ?? []);
    // An old page's nonempty result cannot complete initialization of this page.
    if (first === null && (panelsFetching || (panels?.length ?? 0) > 0)) return;
    initialized.current.selected = true;
    onSelect(first);
  }, [scope, pageId, panels, panelsLoaded, panelsFetching, onSelect]);
}
