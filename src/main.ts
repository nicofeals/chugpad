import './styles.css';
import './themes/poster.css';
import './ui/events';
import { library } from './core/state';
import { connect, loadLocal } from './sync/cloud';
import { openSong } from './ui/render';

if (import.meta.env.MODE !== 'production') {
  const debug = await import('./debug');
  debug.install();
}

loadLocal();
openSong(library.currentId);
connect();
