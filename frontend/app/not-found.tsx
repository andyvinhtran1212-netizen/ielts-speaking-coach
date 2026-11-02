import NotFoundCard from './not-found-card';

export default function NotFound() {
  // The root layout loads no design tokens (route-group shells do), so an
  // unmatched URL rendered here without any `--av-*` values — an unstyled
  // page (U-14 / BL-03). Load the tokens the module CSS reads, as
  // global-error.tsx does.
  return <><link rel="stylesheet" href="/css/aver-design/tokens.css" /><NotFoundCard /></>;
}
