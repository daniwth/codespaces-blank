/**
 * Email verification / password reset flows of the account store. fetch and window are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountUser } from '../../src/services/cloudApi';
import { useAccountStore } from '../../src/store/useAccountStore';

const user: AccountUser = {
  id: 'u1',
  email: 'new@example.com',
  createdAt: 0,
  subscription: { active: false, status: 'none', plan: null, periodEnd: null, cancelAtPeriodEnd: false },
};
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let fetchMock: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;

const stubLocation = (search: string) => {
  replaceState = vi.fn();
  vi.stubGlobal('window', { location: { search, pathname: '/', hash: '' }, history: { replaceState } });
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  useAccountStore.setState({
    token: null, user: null, error: null, errorCode: null, notice: null, busy: false, authView: 'login',
    pendingEmail: null, devLink: null, resetToken: null, linkOutcome: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('account email flows', () => {
  it('register never signs in: it shows the "check your email" view for any address', async () => {
    fetchMock.mockImplementation(() => json(202, { accepted: true }));
    expect(await useAccountStore.getState().register('New@Example.com ', 'password123')).toBe(true);
    const s = useAccountStore.getState();
    expect(s.token).toBeNull();
    expect(s.user).toBeNull();
    expect(s.authView).toBe('check-email');
    expect(s.pendingEmail).toBe('new@example.com');
  });

  it('an unconfirmed login surfaces the error and switches to the resend view', async () => {
    fetchMock.mockImplementation(() => json(403, { error: { code: 'email_not_verified', message: 'Confirm your email first: check your inbox or request a new link.' } }));
    expect(await useAccountStore.getState().login('new@example.com', 'password123')).toBe(false);
    const s = useAccountStore.getState();
    expect(s.error).toMatch(/Confirm your email first/);
    expect(s.authView).toBe('check-email');
    expect(s.pendingEmail).toBe('new@example.com');
    expect(s.token).toBeNull();
  });

  it('resend posts the pending address and tells the player without revealing anything', async () => {
    fetchMock.mockImplementation(() => json(202, { accepted: true }));
    useAccountStore.setState({ pendingEmail: 'new@example.com' });
    expect(await useAccountStore.getState().resendVerification()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/resend');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'new@example.com' });
    expect(useAccountStore.getState().notice).toMatch(/new link is on its way/);
  });

  it('?verify= is consumed once: URL cleaned, session stored, success shown', async () => {
    stubLocation('?verify=abc123&keep=1');
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/auth/verify') ? json(200, { token: 'tok-123', expiresAt: 1, user }) : json(200, { user, save: null }),
    );
    await useAccountStore.getState().consumeEmailLink();
    expect(replaceState).toHaveBeenCalledWith({}, '', '/?keep=1');
    const s = useAccountStore.getState();
    expect(s.token).toBe('tok-123');
    expect(s.user?.email).toBe('new@example.com');
    expect(s.notice).toMatch(/Email confirmed/);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ token: 'abc123' });
  });

  it('a dead ?verify= link shows an error and signs nobody in', async () => {
    stubLocation('?verify=dead');
    fetchMock.mockImplementation(() => json(400, { error: { code: 'invalid_token', message: 'This link is invalid or has expired.' } }));
    await useAccountStore.getState().consumeEmailLink();
    const s = useAccountStore.getState();
    expect(s.error).toBe('This link is invalid or has expired.');
    expect(s.token).toBeNull();
    expect(s.linkOutcome).toBe('verify-failed');
    expect(s.authView).toBe('login');
  });

  it('?reset= opens the new-password form, and saving returns to login with a notice', async () => {
    stubLocation('?reset=tok');
    await useAccountStore.getState().consumeEmailLink();
    expect(replaceState).toHaveBeenCalledWith({}, '', '/');
    expect(useAccountStore.getState().authView).toBe('reset');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(() => json(200, { ok: true }));
    expect(await useAccountStore.getState().resetPassword('new-password1')).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ token: 'tok', password: 'new-password1' });
    const s = useAccountStore.getState();
    expect(s.authView).toBe('login');
    expect(s.resetToken).toBeNull();
    expect(s.token).toBeNull();
    expect(s.notice).toMatch(/Password updated/);
  });

  it('a rejected reset keeps the form and shows the error', async () => {
    useAccountStore.setState({ resetToken: 'old', authView: 'reset' });
    fetchMock.mockImplementation(() => json(400, { error: { code: 'invalid_token', message: 'This link is invalid or has expired.' } }));
    expect(await useAccountStore.getState().resetPassword('new-password1')).toBe(false);
    expect(useAccountStore.getState().authView).toBe('reset');
    expect(useAccountStore.getState().error).toBe('This link is invalid or has expired.');
  });

  it('forgot password shows the same "check your email" state for any address', async () => {
    fetchMock.mockImplementation(() => json(202, { accepted: true }));
    expect(await useAccountStore.getState().forgotPassword('Nobody@Example.com')).toBe(true);
    expect(useAccountStore.getState().authView).toBe('forgot-sent');
    expect(useAccountStore.getState().pendingEmail).toBe('nobody@example.com');
  });
});
