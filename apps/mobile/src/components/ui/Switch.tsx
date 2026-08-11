import React from 'react';
import { Pressable, View } from 'react-native';
import { useMobileTheme } from '../../features/theme/ThemeProvider';

type MobileSwitchProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
};

/**
 * 通用开关。复用 composer picker 的视觉规格（48×28 轨道 + 22×22 滑块），
 * 颜色跟随主题（on=primary，off=border），用于模型管理页等需要 toggle 的场景。
 */
export function MobileSwitch({ value, onValueChange, disabled }: MobileSwitchProps) {
  const { colors } = useMobileTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{
        width: 48,
        height: 28,
        borderRadius: 999,
        padding: 3,
        justifyContent: 'center',
        backgroundColor: value ? colors.primary : colors.border,
        opacity: disabled ? 0.5 : 1
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          backgroundColor: colors.card,
          marginLeft: value ? 20 : 0
        }}
      />
    </Pressable>
  );
}
