import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { DiscoveredDevice } from "../../discovery";
import { useDiscoveredDeviceConnector } from "../discovery/useDiscoveredDeviceConnector";
import { useDiscoverController } from "../discovery/useDiscoverController";
import { usePairingController } from "../pairing/usePairingController";
import type { ProjectOption } from "../workspace/catalogUtils";

type RefreshProjectsCatalogOptions = {
  baseUrl?: string;
  token?: string;
  preferredRepoPath?: string;
};

export function useMobileConnectionFlow(params: {
  preferHttps: boolean;
  serverUrl: string;
  serverUrlInput: string;
  pairCode: string;
  pairCodeMapRef: MutableRefObject<Record<string, string>>;
  closeDiscoverRef: MutableRefObject<(() => void) | null>;
  discoveredPairRequiredRef: MutableRefObject<
    ((item: DiscoveredDevice, statusText: string) => void) | null
  >;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setServerUrl: Dispatch<SetStateAction<string>>;
  setServerUrlInput: Dispatch<SetStateAction<string>>;
  setServerUrlTouched: Dispatch<SetStateAction<boolean>>;
  setPreferHttps: Dispatch<SetStateAction<boolean>>;
  setPairCode: Dispatch<SetStateAction<string>>;
  setToken: Dispatch<SetStateAction<string>>;
  setRepoPath: Dispatch<SetStateAction<string>>;
  setProjects: Dispatch<SetStateAction<ProjectOption[]>>;
  pushConnLog: (message: string, level?: "info" | "error") => void;
  refreshProjectsCatalog: (
    opts?: RefreshProjectsCatalogOptions,
  ) => Promise<void>;
  toProjectOptionsFromPaths: (paths: string[]) => ProjectOption[];
}) {
  const {
    preferHttps,
    serverUrl,
    serverUrlInput,
    pairCode,
    pairCodeMapRef,
    closeDiscoverRef,
    discoveredPairRequiredRef,
    setBusy,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setServerUrlTouched,
    setPreferHttps,
    setPairCode,
    setToken,
    setRepoPath,
    setProjects,
    pushConnLog,
    refreshProjectsCatalog,
    toProjectOptionsFromPaths,
  } = params;

  const {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    connectWithAddressAndCode,
    onAuthSubmit,
    onOpenScanner,
    onPickQrFromAlbum,
    onBarcodeScanned,
    onCloseScanner,
    onScannerReady,
    onScannerMountError,
    onRescan: onScannerRescan,
  } = usePairingController({
    preferHttps,
    serverUrlInput,
    pairCode,
    setBusy,
    setStatus,
    setServerUrl,
    setServerUrlInput,
    setPairCode,
    setToken,
    setRepoPath,
    setProjects,
    pushConnLog,
    refreshProjectsCatalog,
    toProjectOptionsFromPaths,
    onCloseDiscoverRef: closeDiscoverRef,
    onDiscoveredPairRequiredRef: discoveredPairRequiredRef,
  });

  const connectDiscoveredDevice = useDiscoveredDeviceConnector({
    pairCode,
    pairCodeMapRef,
    setPreferHttps,
    setServerUrlInput,
    setServerUrlTouched,
    connectWithAddressAndCode,
  });

  const {
    discoverOpen,
    discoveringUi,
    deviceRows: discoverDeviceRows,
    connectingDiscoverId,
    connectProgressScaleX,
    pairPromptOpen,
    pairPromptHostPort,
    pairPromptValue,
    openDiscover: onOpenDiscover,
    closeDiscover: onCloseDiscover,
    startDiscover,
    reopenPairPromptForDevice,
    handleConnectPress: onConnectDiscoverPress,
    setPairPromptValue,
    cancelPairPrompt,
    confirmPairPrompt,
  } = useDiscoverController({
    serverUrl,
    pairCodeMapRef,
    setStatus,
    pushConnLog,
    connectDiscoveredDevice,
  });

  useEffect(() => {
    closeDiscoverRef.current = onCloseDiscover;
    discoveredPairRequiredRef.current = reopenPairPromptForDevice;
  }, [
    closeDiscoverRef,
    discoveredPairRequiredRef,
    onCloseDiscover,
    reopenPairPromptForDevice,
  ]);

  return {
    scannerOpen,
    scannerLocked,
    scannerReady,
    scanHitCount,
    lastScanAt,
    onAuthSubmit,
    onOpenScanner,
    onPickQrFromAlbum,
    onBarcodeScanned,
    onCloseScanner,
    onScannerReady,
    onScannerMountError,
    onScannerRescan,
    discoverOpen,
    discoveringUi,
    discoverDeviceRows,
    connectingDiscoverId,
    connectProgressScaleX,
    pairPromptOpen,
    pairPromptHostPort,
    pairPromptValue,
    onOpenDiscover,
    onCloseDiscover,
    startDiscover,
    onConnectDiscoverPress,
    setPairPromptValue,
    cancelPairPrompt,
    confirmPairPrompt,
  };
}
