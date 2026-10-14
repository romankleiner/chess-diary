import { vi, describe, it, expect, beforeEach } from 'vitest';
import { auth } from '@clerk/nextjs/server';
import { currentUserId, dataUserId } from '@/lib/user-id';

const PROD = 'user_3KgYiYzMxX8zUjN4dBbv55hfT1T';
const DEV = 'user_395GdJ9fMuBbALA4mvYzpEUQrNI';
const mockAuth = vi.mocked(auth);

describe('dataUserId', () => {
  it('takes the author’s Production account to the Development id its data is kept under', () => {
    expect(dataUserId(PROD)).toBe(DEV);
  });

  it('leaves the Development id as it is, so local development reaches the same data', () => {
    expect(dataUserId(DEV)).toBe(DEV);
  });

  it('leaves everyone else’s id as it is', () => {
    expect(dataUserId('user_someoneElse')).toBe('user_someoneElse');
    expect(dataUserId('test-user-123')).toBe('test-user-123');
  });

  it('is null for nobody', () => {
    expect(dataUserId(null)).toBeNull();
    expect(dataUserId(undefined)).toBeNull();
    expect(dataUserId('')).toBeNull();
  });

  it('maps nothing by an id that merely looks like an object’s own property', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(dataUserId(id)).toBe(id);
  });

  it('maps only the exact id', () => {
    expect(dataUserId(PROD.toLowerCase())).toBe(PROD.toLowerCase());
    expect(dataUserId(` ${PROD}`)).toBe(` ${PROD}`);
  });
});

describe('currentUserId', () => {
  beforeEach(() => mockAuth.mockReset());

  it('is the signed-in user’s data id', async () => {
    mockAuth.mockResolvedValue({ userId: PROD } as never);
    expect(await currentUserId()).toBe(DEV);
    mockAuth.mockResolvedValue({ userId: 'user_other' } as never);
    expect(await currentUserId()).toBe('user_other');
  });

  it('is null when nobody is signed in', async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    expect(await currentUserId()).toBeNull();
  });
});
