import {
  DEFAULT_APP_TIMEZONE,
  getAppTimezone,
  resolveUserTimezone,
} from './app-timezone';

describe('app-timezone', () => {
  const prev = process.env.APP_TIMEZONE;

  afterEach(() => {
    if (prev === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = prev;
  });

  it('getAppTimezone usa Fortaleza por padrão', () => {
    delete process.env.APP_TIMEZONE;
    expect(getAppTimezone()).toBe(DEFAULT_APP_TIMEZONE);
  });

  it('getAppTimezone respeita APP_TIMEZONE', () => {
    process.env.APP_TIMEZONE = 'America/Manaus';
    expect(getAppTimezone()).toBe('America/Manaus');
  });

  it('resolveUserTimezone mapeia UTC e vazio para app timezone', () => {
    delete process.env.APP_TIMEZONE;
    expect(resolveUserTimezone(null)).toBe(DEFAULT_APP_TIMEZONE);
    expect(resolveUserTimezone('')).toBe(DEFAULT_APP_TIMEZONE);
    expect(resolveUserTimezone('UTC')).toBe(DEFAULT_APP_TIMEZONE);
    expect(resolveUserTimezone('Etc/UTC')).toBe(DEFAULT_APP_TIMEZONE);
  });

  it('resolveUserTimezone preserva IANA configurado', () => {
    expect(resolveUserTimezone('America/Recife')).toBe('America/Recife');
  });
});
