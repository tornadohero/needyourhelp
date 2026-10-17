import { beforeEach, describe, expect, it } from 'vitest';

import { ProfileService } from '../../../src/modules/profile/application/profile.service';
import { FakeParentProfileRepository, FakeUserRepository } from './fakes';

describe('ProfileService', () => {
  let users: FakeUserRepository;
  let parents: FakeParentProfileRepository;
  let service: ProfileService;
  let userId: string;

  beforeEach(async () => {
    users = new FakeUserRepository();
    parents = new FakeParentProfileRepository();
    service = new ProfileService(users, parents);
    const user = await users.create({ displayName: '微信用户abc' });
    userId = user.id;
  });

  it('returns the account profile without a parent profile yet', async () => {
    const profile = await service.getProfile(userId);

    expect(profile.userId).toBe(userId);
    expect(profile.displayName).toBe('微信用户abc');
    expect(profile.parentProfile).toBeNull();
  });

  it('updates account display fields', async () => {
    const profile = await service.updateProfile(userId, {
      displayName: '家长小李',
      avatarUrl: 'https://cdn.example/a.png',
    });

    expect(profile.displayName).toBe('家长小李');
    expect(profile.avatarUrl).toBe('https://cdn.example/a.png');
    expect(users.users.get(userId)?.displayName).toBe('家长小李');
  });

  it('upserts the parent profile with city and timezone defaults', async () => {
    const profile = await service.updateProfile(userId, { cityCode: 'BEIJING' });

    expect(profile.parentProfile?.cityCode).toBe('BEIJING');
    expect(profile.parentProfile?.timezone).toBe('Asia/Shanghai');
    expect(profile.parentProfile?.displayName).toBe('微信用户abc');

    const again = await service.updateProfile(userId, { timezone: 'Asia/Chongqing' });
    expect(again.parentProfile?.cityCode).toBe('BEIJING');
    expect(again.parentProfile?.timezone).toBe('Asia/Chongqing');
    expect(parents.profiles.size).toBe(1);
  });

  it('fails for an unknown account', async () => {
    await expect(service.getProfile('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(service.updateProfile('missing', { displayName: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('never exposes identity hashes', async () => {
    const profile = await service.getProfile(userId);

    expect(Object.keys(profile).sort()).toEqual(
      ['avatarUrl', 'displayName', 'parentProfile', 'userId'].sort(),
    );
  });
});
