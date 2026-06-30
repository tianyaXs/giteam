import { useCallback } from "react";
import type { MutableRefObject } from "react";
import { toText } from "../../lib/text";
import type { DiscoveredDevice } from "../../discovery";
import { deviceKeyOf } from "./useDiscoverController";

type ConnectWithAddressAndCode = (
  baseUrl: string,
  code: string,
  opts?: { discoveredDevice?: DiscoveredDevice },
) => Promise<void>;

type UseDiscoveredDeviceConnectorParams = {
  pairCode: string;
  pairCodeMapRef: MutableRefObject<Record<string, string>>;
  setPreferHttps: (value: boolean) => void;
  setServerUrlInput: (value: string) => void;
  setServerUrlTouched: (value: boolean) => void;
  connectWithAddressAndCode: ConnectWithAddressAndCode;
};

export function useDiscoveredDeviceConnector({
  pairCode,
  pairCodeMapRef,
  setPreferHttps,
  setServerUrlInput,
  setServerUrlTouched,
  connectWithAddressAndCode,
}: UseDiscoveredDeviceConnectorParams) {
  return useCallback(
    async (item: DiscoveredDevice, codeOverride?: string) => {
      const hostWithPort = (() => {
        try {
          const u = new URL(item.baseUrl);
          return u.host || `${item.host}:${item.port}`;
        } catch {
          return `${item.host}:${item.port}`;
        }
      })();

      setServerUrlTouched(true);
      setServerUrlInput(hostWithPort);
      setPreferHttps(item.baseUrl.startsWith("https://"));

      const key = deviceKeyOf(item);
      const cached = key ? toText(pairCodeMapRef.current[key]).trim() : "";
      const code = (codeOverride ?? cached ?? pairCode).trim();

      await connectWithAddressAndCode(item.baseUrl, code, {
        discoveredDevice: item,
      });
    },
    [
      connectWithAddressAndCode,
      pairCode,
      pairCodeMapRef,
      setPreferHttps,
      setServerUrlInput,
      setServerUrlTouched,
    ],
  );
}
