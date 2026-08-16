import { redirect } from 'next/navigation';

/**
 * Pricing is intentionally closed before launch. Keep this decision at the
 * server boundary so visitors never receive or briefly paint the unreleased
 * pricing UI. The legacy HTML remains the rollback/source artifact for the
 * eventual launch, but it is not the canonical route owner anymore.
 */
export default function PricingPage() {
  redirect('/');
}
