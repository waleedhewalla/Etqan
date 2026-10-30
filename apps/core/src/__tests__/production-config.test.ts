import { describe, expect, it } from 'vitest';
import { productionProblems } from '../config';

const good = {
  NODE_ENV: 'production' as const, JWT_SECRET: 'x'.repeat(48), MINIO_ACCESS_KEY: 'ak-real', MINIO_SECRET_KEY: 'sk-real',
  STORAGE_DRIVER: 's3' as const, DATABASE_URL: 'postgresql://itqan:strong@postgres:5432/itqan',
};

describe('productionProblems', () => {
  it('accepts a configuration with its own secrets', () => {
    expect(productionProblems(good)).toEqual([]);
  });

  it('says nothing outside production, where the defaults are meant to be used', () => {
    const dev = { ...good, NODE_ENV: 'development' as const, JWT_SECRET: 'dev-secret-change-me-in-production-32chars', STORAGE_DRIVER: 'memory' as const };
    expect(productionProblems(dev)).toEqual([]);
    expect(productionProblems({ ...dev, NODE_ENV: 'test' as const })).toEqual([]);
  });

  it('refuses the public default JWT secret', () => {
    const p = productionProblems({ ...good, JWT_SECRET: 'dev-secret-change-me-in-production-32chars' });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/JWT_SECRET/);
  });

  it('refuses in-memory recording storage and default MinIO keys', () => {
    expect(productionProblems({ ...good, STORAGE_DRIVER: 'memory' })[0]).toMatch(/STORAGE_DRIVER/);
    expect(productionProblems({ ...good, MINIO_SECRET_KEY: 'minioadmin' })[0]).toMatch(/MINIO/);
    // the MinIO keys do not matter when nothing uses MinIO
    expect(productionProblems({ ...good, STORAGE_DRIVER: 'memory', MINIO_SECRET_KEY: 'minioadmin' })).toHaveLength(1);
  });

  it('accepts the file driver without S3 keys, and checks the keys only for s3', () => {
    expect(productionProblems({ ...good, STORAGE_DRIVER: 'file', MINIO_ACCESS_KEY: 'minioadmin', MINIO_SECRET_KEY: 'minioadmin' })).toEqual([]);
    expect(productionProblems({ ...good, STORAGE_DRIVER: 's3', MINIO_ACCESS_KEY: 'minioadmin' })).toHaveLength(1);
  });

  it('refuses the development database password', () => {
    expect(productionProblems({ ...good, DATABASE_URL: 'postgresql://itqan:itqan_dev_password@db:5432/itqan' })[0]).toMatch(/DATABASE_URL/);
  });

  it('lists every problem at once', () => {
    const p = productionProblems({ ...good, JWT_SECRET: 'dev-secret-change-me-in-production-32chars', MINIO_ACCESS_KEY: 'minioadmin', STORAGE_DRIVER: 's3', DATABASE_URL: 'x:itqan_dev_password@y' });
    expect(p).toHaveLength(3);
  });
});
