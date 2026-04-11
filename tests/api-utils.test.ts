import { describe, it, expect } from 'vitest';
import { json } from '../src/lib/api-utils';

describe('json helper', () => {
  it('returns JSON response with correct content type', async () => {
    const res = json({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.hello).toBe('world');
  });

  it('respects custom status code', async () => {
    const res = json({ error: 'Not found' }, 404);
    expect(res.status).toBe(404);
  });

  it('handles null/undefined data', async () => {
    const res = json(null);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('null');
  });
});
