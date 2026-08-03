import { isSameRequestOrigin } from './csrf-origin';

describe('isSameRequestOrigin', () => {
  it('accepts the public AWS origin forwarded by the trusted proxy', () => {
    expect(isSameRequestOrigin('https://analytics.example.com', {
      protocol: 'http',
      host: 'nestjs-api:3001',
      forwardedProto: 'https',
      forwardedHost: 'analytics.example.com',
    })).toBe(true);
  });

  it('accepts a direct same-origin request', () => {
    expect(isSameRequestOrigin('http://localhost:3000', {
      protocol: 'http',
      host: 'localhost:3000',
    })).toBe(true);
  });

  it('rejects an attacker origin even when the request targets the real host', () => {
    expect(isSameRequestOrigin('https://attacker.example', {
      protocol: 'https',
      host: 'analytics.example.com',
      forwardedProto: 'https',
      forwardedHost: 'analytics.example.com',
    })).toBe(false);
  });
});
