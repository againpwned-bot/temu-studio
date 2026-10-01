import '@fontsource-variable/outfit';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/sora';
import '@fontsource-variable/syne';
import '@fontsource-variable/jetbrains-mono';

import './styles/tokens.css';
import './styles/base.css';
import './styles/sky.css';
import './styles/glass.css';
import './styles/controls.css';
import './styles/player.css';
import './styles/overlays.css';

import { App } from './app.js';

new App().start().catch((error) => {
  console.error('temu studio failed to start', error);
});
