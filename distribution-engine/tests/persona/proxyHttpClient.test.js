const { buildProxyUrl, rewriteProxyHost } = require('../../src/persona/proxyHttpClient');

describe('proxyHttpClient', () => {
  const prevAlias = process.env.PROXY_LOCAL_HOST_ALIAS;

  afterEach(() => {
    if (prevAlias === undefined) delete process.env.PROXY_LOCAL_HOST_ALIAS;
    else process.env.PROXY_LOCAL_HOST_ALIAS = prevAlias;
  });

  test('buildProxyUrl http', () => {
    expect(buildProxyUrl({ host: '127.0.0.1', port: 1101, proxy_type: 'http' })).toBe(
      'http://host.docker.internal:1101',
    );
  });

  test('rewriteProxyHost maps localhost to docker alias', () => {
    process.env.PROXY_LOCAL_HOST_ALIAS = 'gateway.test';
    expect(rewriteProxyHost('127.0.0.1')).toBe('gateway.test');
    expect(rewriteProxyHost('5.135.7.102')).toBe('5.135.7.102');
  });
});
