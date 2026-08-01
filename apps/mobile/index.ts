import { registerRootComponent } from 'expo';

import App from './App';
import {
  initializeObservability,
  withObservability
} from './src/lib/observability';

initializeObservability();
registerRootComponent(withObservability(App));
