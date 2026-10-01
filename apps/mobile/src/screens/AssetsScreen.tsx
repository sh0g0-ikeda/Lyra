import { useIsFocused } from '@react-navigation/native';

import { CharactersScreen } from '@/screens/CharactersScreen';

// Only the focused destination owns the character editor. Manga and Assets must
// never register two editors under the existing global character-editor key.
export function AssetsScreen(): React.JSX.Element | null {
  const focused = useIsFocused();
  return focused ? <CharactersScreen /> : null;
}
