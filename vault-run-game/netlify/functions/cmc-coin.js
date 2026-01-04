const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const BASE = 'https://pro-api.coinmarketcap.com';

exports.handler = async (event) => {
  try {
      const { symbol, convert = 'USD' } = event.queryStringParameters || {};
          if (!symbol) return { statusCode: 400, body: 'symbol required' };

              const [infoRes, quoteRes] = await Promise.all([
                    fetch(`${BASE}/v2/cryptocurrency/info?symbol=${encodeURIComponent(symbol)}`, { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }}),
                          fetch(`${BASE}/v2/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}&convert=${encodeURIComponent(convert.toUpperCase())}`, { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }}),
                              ]);

                                  if (!infoRes.ok) return { statusCode: infoRes.status, body: await infoRes.text() };
                                      if (!quoteRes.ok) return { statusCode: quoteRes.status, body: await quoteRes.text() };

                                          const info = await infoRes.json();
                                              const quote = await quoteRes.json();

                                                  return { statusCode: 200, body: JSON.stringify({
                                                        info: info.data?.[symbol]?.[0] ?? null,
                                                              quote: quote.data?.[symbol]?.[0] ?? null,
                                                                  })};
                                                                    } catch (e) {
                                                                        return { statusCode: 500, body: String(e) };
                                                                          }
                                                                          };