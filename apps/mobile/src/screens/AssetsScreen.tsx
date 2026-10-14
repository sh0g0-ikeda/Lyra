import { useIsFocused } from '@react-navigation/native';

import { MangaReader } from '@/components/MangaReader';

export function AssetsScreen(): React.JSX.Element | null {
  const focused = useIsFocused();
  return focused ? <MangaReader /> : null;
}