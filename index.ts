// supabase-js expects the standard URL global, which RN doesn't provide —
// must be imported before anything that touches supabase-js.
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
