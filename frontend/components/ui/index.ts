// Public exports of the "Bản in" component set (UIBASE-0056, GOI-03 §5.4).
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './button';
export { ChoiceGroup, type ChoiceGroupProps, type ChoiceOption } from './choice-group';
export { Icon, type IconProps } from './icon/icon';
export { type IconName } from './icon/icon-set';
export { IconButton, type IconButtonProps } from './icon-button';
export { SearchField, type SearchFieldProps } from './search-field';
export { Select, type SelectOption, type SelectProps } from './select';
export { StatusBadge, STATUS_BADGE_SETS, type StatusBadgeProps } from './status-badge';
export { TextArea, type TextAreaProps } from './text-area';
export { TextField, type TextFieldProps } from './text-field';
export { AV2_BREAKPOINTS, av2MinWidth } from './breakpoints';
export { ConfirmDialog, ConfirmDialogFrame, type ConfirmDialogProps, type ConfirmDialogTone } from './confirm-dialog';
export { Dialog, DialogFrame, type DialogProps, type DialogVariant } from './dialog';
export { MediaPlaceholder, PendingValue, type MediaPlaceholderKind, type MediaPlaceholderProps } from './media-placeholder';
export { Notice, type NoticeKind, type NoticeProps } from './notice';
export { PageState, type PageStateKind, type PageStateProps } from './page-state';
export { BackLink, Breadcrumb, type BackLinkProps, type BreadcrumbItem, type BreadcrumbProps } from './breadcrumb';
export { formatCount } from './format-count';
export { Pagination, type PaginationProps } from './pagination';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export { Stepper, type Step, type StepperProps, type StepStatus } from './stepper';
export { Tabs, type TabItem, type TabsProps } from './tabs';
export { AV2_THEME_COLOR, AV2_VIEWPORT, syncThemeColor } from './theme-color';
export { ThemeChoiceGroup, type ThemeChoiceGroupProps } from './theme-choice';
export { ThemeMenu, ThemeMenuList, type ThemeMenuListProps, type ThemeMenuProps } from './theme-menu';
export { THEME_SCRIPT, ThemeScript } from './theme-script';
export { useThemeChoice, type ThemeChoice, type ThemeChoiceState, type ThemeMode } from './use-theme-choice';
export {
  AudioPlayer, type AudioLoop, type AudioPlayerLang, type AudioPlayerMode, type AudioPlayerProps, type AudioPlayerState, type AudioPlayerVariant,
} from './audio-player';
export { formatMediaTime, formatSpeed } from './media-time';
export { safeYoutubeEmbed, safeYoutubeWatch, VideoFrame, type VideoFrameProps, type VideoFrameState, type VideoSource } from './video-frame';
