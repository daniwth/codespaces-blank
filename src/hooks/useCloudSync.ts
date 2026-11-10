import { useEffect } from 'react';
import { tr } from '../i18n';
import { useAccountStore } from '../store/useAccountStore';
import { useGameStore } from '../store/useGameStore';

const AUTO_SYNC_MS = 3 * 60_000;

/**
 * Boots the account session, handles Stripe Checkout redirects and keeps the
 * cloud save in sync (every 3 minutes and whenever the tab is hidden).
 */
export function useCloudSync(): void {
  useEffect(() => {
    const account = useAccountStore.getState();
    void account.init().then(() => {
      void useAccountStore.getState().consumeEmailLink();
      const params = new URLSearchParams(window.location.search);
      const checkout = params.get('checkout');
      if (checkout || params.has('billing')) {
        const game = useGameStore.getState();
        game.setSideTab('account');
        // Coming back from Stripe is a deliberate action: go straight to the Account tab
        // instead of leaving the confirmation hidden behind the title menu.
        if (game.screen === 'menu') game.continueGame();
        if (checkout === 'success') game.pushLog(tr('Back from checkout. Confirming your Miner Pass with the server…'), 'info');
        if (checkout === 'cancel') game.pushLog(tr('Checkout cancelled. No charge was made.'), 'info');
        // The webhook may land a moment after the redirect: poll briefly.
        let tries = 0;
        const poll = setInterval(() => {
          tries += 1;
          void useAccountStore.getState().refresh().then(() => {
            const s = useAccountStore.getState();
            if (s.user?.subscription.active || tries >= 8) {
              clearInterval(poll);
              if (s.user?.subscription.active && checkout === 'success') void s.uploadSave({ silent: true });
            }
          });
        }, 1500);
        window.history.replaceState({}, '', window.location.pathname);
      }
    });

    const tick = () => {
      const s = useAccountStore.getState();
      if (s.autoSync && s.user?.subscription.active && s.syncState !== 'conflict') void s.uploadSave({ silent: true });
    };
    const interval = setInterval(tick, AUTO_SYNC_MS);
    const onHide = () => {
      const s = useAccountStore.getState();
      if (document.visibilityState === 'hidden' && s.autoSync && s.user?.subscription.active && s.syncState !== 'conflict') {
        void s.uploadSave({ silent: true, keepalive: true });
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);
}
