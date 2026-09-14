const NAVIGATION_GUARD_EVENT = 'aver:navigation-guard';

type NavigationGuard = (event: BeforeUnloadEvent) => void;

/**
 * Registers one guard for both native document exits and App Router intents.
 * The same callback therefore remains the canonical owner of dirty-state
 * policy regardless of which navigation mechanism initiated the transition.
 */
export function registerNavigationGuard(guard: NavigationGuard) {
  const appRouterGuard = (event: Event) => guard(event as BeforeUnloadEvent);
  window.addEventListener('beforeunload', guard);
  window.addEventListener(NAVIGATION_GUARD_EVENT, appRouterGuard);
  return () => {
    window.removeEventListener('beforeunload', guard);
    window.removeEventListener(NAVIGATION_GUARD_EVENT, appRouterGuard);
  };
}

export function navigationGuardBlocks() {
  return !window.dispatchEvent(new Event(NAVIGATION_GUARD_EVENT, { cancelable: true }));
}
