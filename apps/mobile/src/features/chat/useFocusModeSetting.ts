import { useCallback, useEffect, useState } from 'react';
import {
  loadFocusModePrefs,
  setFocusModeEnabled,
  subscribeFocusModePrefs
} from '../../storage/focusModePrefs';

/**
 * 设置页 + 聊天页：专注模式开关（生成中收起顶栏/输入）。
 */
export function useFocusModeSetting() {
  const [enabled, setEnabled] = useState(() => loadFocusModePrefs().enabled);

  useEffect(() => {
    return subscribeFocusModePrefs(() => {
      setEnabled(loadFocusModePrefs().enabled);
    });
  }, []);

  const toggle = useCallback(() => {
    setFocusModeEnabled(!loadFocusModePrefs().enabled);
  }, []);

  const setEnabledValue = useCallback((next: boolean) => {
    setFocusModeEnabled(next);
  }, []);

  return {
    enabled,
    toggle,
    setEnabled: setEnabledValue
  };
}
