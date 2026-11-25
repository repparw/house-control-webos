// Ambient browser globals used by the webOS build. Type-only: Vite never bundles this file.

declare const __APP_VERSION__: string | undefined;

interface Window {
  __houseTV?: unknown;
}

interface Navigator {
  deviceMemory?: number;
}

declare var webOS: {
  service?: {
    request(uri: string, options: {
      method: string;
      parameters: object;
      onSuccess(response: { returnValue?: boolean; [key: string]: unknown }): void;
      onFailure(response: { returnValue?: boolean; errorCode?: number; errorText?: string }): void;
    }): { cancel(): void };
  };
} | undefined;
