import { ipcRenderer } from 'electron';

import {
  webShareSettingsResponseSchema,
  webShareSettingsSnapshotSchema,
  type WebShareSettingsRequest,
  type WebShareSettingsSnapshot,
  type SerpentWebShareSettingsApi,
} from '../../shared/web-share';
import {
  WEB_SHARE_SETTINGS_EVENT_CHANNEL,
  WEB_SHARE_SETTINGS_REQUEST_CHANNEL,
} from '../../shared/protocol/channels';

export const webShare: SerpentWebShareSettingsApi = Object.freeze({
  async request(input: WebShareSettingsRequest) {
    return webShareSettingsResponseSchema.parse(
      await ipcRenderer.invoke(WEB_SHARE_SETTINGS_REQUEST_CHANNEL, input),
    );
  },
  onChanged(listener: (snapshot: WebShareSettingsSnapshot) => void) {
    const handler = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = webShareSettingsSnapshotSchema.safeParse(input);
      if (parsed.success) listener(parsed.data);
    };
    ipcRenderer.on(WEB_SHARE_SETTINGS_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WEB_SHARE_SETTINGS_EVENT_CHANNEL, handler);
  },
});
