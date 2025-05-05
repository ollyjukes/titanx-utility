// tests/holders.e2e.test.js
import { jest } from '@jest/globals';
import request from 'supertest';
import { initializeCache } from '@/app/api/utils/cache';
import { app } from '@/app'; // Assuming you have a Next.js app export

describe('Holders API', () => {
  beforeAll(async () => {
    await initializeCache();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return holders for ascendant contract', async () => {
    const response = await request(app)
      .get('/api/holders/ascendant')
      .query({ page: 1, pageSize: 10 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      holders: expect.any(Array),
      totalItems: expect.any(Number),
      totalPages: expect.any(Number),
      currentPage: 1,
      pageSize: 10,
      totalBurned: expect.any(Number),
      totalTokens: expect.any(Number),
      totalShares: expect.any(Number),
      pendingRewards: expect.any(Number),
      status: expect.any(String),
      cacheState: expect.any(Object),
    });
    expect(HoldersResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('should return 400 for invalid contract', async () => {
    const response = await request(app)
      .get('/api/holders/invalid')
      .query({ page: 1, pageSize: 10 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid contract: invalid' });
  });
});