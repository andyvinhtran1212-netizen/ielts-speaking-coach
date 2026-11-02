// Grammar 404s render inside the public-content layout, which already links
// the design tokens the shared error screen reads; reuse the 404 card without
// the root not-found's own tokens <link> (PC-J239: it loaded tokens.css twice).
export { default } from '../../not-found-card';
