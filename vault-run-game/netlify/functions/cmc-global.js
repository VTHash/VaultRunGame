const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const BASE = 'https://pro-api.coinmarketcap.com';

exports.handler = async (event) => {
  try {
      const { convert = 'USD' } = event.queryStringParameters || {};
          const url = `${BASE}/v1/global-metrics/quotes/latest?convert=${encodeURIComponent(convert.toUpperCase())}`;
              const res = await fetch(url, { headers: { 'X-CMC_PRO_API_KEY': process.env.CMC_API_KEY }});
                  const text = await res.text();
                      return { statusCode: res.status, body: res.ok ? JSON.stringify(JSON.parse(text).data) : text };
                        } catch (e) {
                            return { statusCode: 500, body: String(e) };
                              }
                              };