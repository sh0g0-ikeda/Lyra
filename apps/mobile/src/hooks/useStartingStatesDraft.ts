import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { EpisodeStartingState } from '@/domain/episodeStartingStates';

interface StartingEpisode {
  id: string;
  updated_at: string;
  starting_entity_states?: EpisodeStartingState[];
}
interface StartingStatesInput {
  scope: string;
  episode: StartingEpisode | null;
  canEdit: boolean;
  enabled: boolean;
  onSave: (episodeId: string, payload: {
    starting_entity_states: EpisodeStartingState[];
    expected_updated_at: string;
  }) => Promise<void>;
}
interface Draft {
  scope: string;
  revision: string;
  value: EpisodeStartingState[];
  saved: boolean;
}
interface StartingStatesDraft {
  value: EpisodeStartingState[];
  dirty: boolean;
  saving: boolean;
  error: unknown;
  setValue: (value: EpisodeStartingState[]) => void;
  discard: () => void;
  save: () => Promise<void>;
}

// The state belongs to the episode even though its control lives before page
// autofill. A draft pins its first revision; late saves cannot clear newer input
// or a different tenant/episode. Rendering alone never sends a write.
export function useStartingStatesDraft(input: StartingStatesInput): StartingStatesDraft {
  const { scope, episode, canEdit, enabled, onSave } = input;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [failure, setFailure] = useState<{ scope: string; error: unknown } | null>(null);
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const flight = useRef<{ scope: string; promise: Promise<void> } | null>(null);
  const live = useRef({ scope: scope, mounted: true });
  useLayoutEffect(() => {
    live.current = { scope: scope, mounted: true };
    return () => { live.current.mounted = false; };
  }, [scope]);
  const active = draft?.scope === scope &&
    (!draft.saved || draft.revision === episode?.updated_at) ? draft : null;
  const value = active?.value ?? episode?.starting_entity_states ?? [];
  const dirty = active !== null && !active.saved;
  const setValue = useCallback((next: EpisodeStartingState[]): void => {
    if (episode === null) return;
    const revision = episode.updated_at;
    setDraft((current) => ({
      scope: scope,
      revision: current?.scope === scope && !current.saved ? current.revision : revision,
      value: next.map((state) => ({ ...state })),
      saved: false,
    }));
    setFailure(null);
  }, [episode, scope]);
  const discard = useCallback((): void => { setDraft(null); setFailure(null); }, []);
  const save = useCallback((): Promise<void> => {
    if (flight.current?.scope === scope) return flight.current.promise;
    if (!dirty || active === null) return Promise.resolve();
    if (!canEdit || !enabled || episode === null) {
      return Promise.reject(new Error('Starting state editing is unavailable'));
    }
    const captured = active;
    setSavingScope(scope);
    setFailure(null);
    const pending = onSave(episode.id, {
      starting_entity_states: captured.value.map((state) => ({ ...state })),
      expected_updated_at: captured.revision,
    }).then(() => {
      if (!live.current.mounted || live.current.scope !== scope) return;
      setDraft((current) => current === captured ? { ...current, saved: true } : current);
    }).catch((error: unknown) => {
      if (live.current.mounted && live.current.scope === scope) setFailure({ scope, error });
      throw error;
    }).finally(() => {
      if (flight.current?.promise !== pending) return;
      flight.current = null;
      if (live.current.mounted) setSavingScope(null);
    });
    flight.current = { scope, promise: pending };
    return pending;
  }, [active, dirty, canEdit, enabled, episode, onSave, scope]);
  return { value, dirty, saving: savingScope === scope,
    error: failure?.scope === scope ? failure.error : null,
    setValue, discard, save };
}
