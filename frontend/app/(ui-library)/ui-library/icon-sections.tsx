// /ui-library section for G11-T32 (GOI-11 5.7.3; UIBASE-0056 FR-006, FR-013):
// the 94 icons of ThanhPhanNenTang §5 by group, as on the sheet, plus the three
// theme-choice icons of CheDoToi §3 and the three display sizes.
import { Icon } from '@/components/ui';
import { ICON_GROUPS, THEME_ICONS, type IconName } from '@/components/ui/icon/icon-set';

import base from './ui-library.module.css';
import styles from './icon-sections.module.css';

const THEME_LABELS: Record<keyof typeof THEME_ICONS, string> = {
  sun: 'Sáng', moon: 'Tối', 'theme-device': 'Theo thiết bị',
};

function IconCell({ name, label }: { name: IconName; label: string }) {
  return (
    <li className={styles.cell}>
      <Icon name={name} size={24} />
      <code className={styles.name}>{name}</code>
      <span className={styles.label}>{label}</span>
    </li>
  );
}

export function IconSection({ title }: { title: string }) {
  const total = ICON_GROUPS.reduce((sum, g) => sum + g.icons.length, 0);
  return (
    <section id="icons" className={base.section} aria-labelledby="icons-h">
      <h2 id="icons-h">{title}</h2>
      <p>{total} icon, {ICON_GROUPS.length} nhóm · lưới 24, nét 2, màu theo chữ. Đứng một mình thì có tên đọc; đi kèm chữ thì ẩn với trình đọc màn hình.</p>
      <div className={styles.groups}>
        {ICON_GROUPS.map((group) => (
          <div key={group.name}>
            <h3 className={styles.groupName}>{group.name} · {group.icons.length}</h3>
            <ul className={styles.grid}>
              {group.icons.map(([name, label]) => <IconCell key={name} name={name} label={label} />)}
            </ul>
          </div>
        ))}
        <div>
          <h3 className={styles.groupName}>Chế độ hiển thị (tờ CheDoToi) · 3</h3>
          <ul className={styles.grid}>
            {(Object.keys(THEME_LABELS) as (keyof typeof THEME_ICONS)[]).map((name) => (
              <IconCell key={name} name={name} label={THEME_LABELS[name]} />
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.sizes}>
        Cỡ:
        <span><Icon name="mic" size={16} /> 16 cạnh chữ 14–15px</span>
        <span><Icon name="mic" size={20} /> 20 mặc định, trong nút</span>
        <span><Icon name="mic" size={24} /> 24 bước và trạng thái lớn</span>
      </p>
    </section>
  );
}
