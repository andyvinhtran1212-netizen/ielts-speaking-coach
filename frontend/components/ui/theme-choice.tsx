'use client';

import { useId } from 'react';

import { Icon } from './icon/icon';
import styles from './theme-menu.module.css';
import { cx } from './cx';
import { DEVICE_WORD, THEME_CHOICES, useThemeChoice } from './use-theme-choice';

export type ThemeChoiceGroupProps = {
  /** Visible group name; default "Giao diện". */
  legend?: string;
  className?: string;
};

/**
 * The same three choices as a radio group, for the Account page (UIBASE-0056
 * FR-021, CheDoToi.dc.html §3 "trong trang Hồ sơ là nhóm radio"). Native
 * radios drawn as one segmented control; applies at once.
 */
export function ThemeChoiceGroup({ legend = 'Giao diện', className }: ThemeChoiceGroupProps) {
  const { choice, device, setChoice } = useThemeChoice();
  const name = useId();
  return (
    <fieldset className={cx(styles.group, className)}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.segments}>
        {THEME_CHOICES.map((option) => (
          <label key={option.id} className={styles.segment}>
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={choice === option.id}
              onChange={() => setChoice(option.id)}
              className={styles.radio}
            />
            <Icon name={option.icon} size={16} />
            {option.label}
          </label>
        ))}
      </div>
      {choice === 'system' ? <p className={styles.note}>Máy đang đặt {DEVICE_WORD[device]}.</p> : null}
    </fieldset>
  );
}
