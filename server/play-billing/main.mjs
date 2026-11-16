import { GoogleAuth } from 'google-auth-library';
import { createBillingServer } from './server.mjs';
import { PACKAGE, PRODUCT } from './verify.mjs';

if (process.env.SUBTITLE_BILLING_ENABLED !== 'true') throw new Error('Play Billing verifier is disabled.');

const playAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
const integrityAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/playintegrity'] });
const app = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + PACKAGE;
const integration = 'https://playintegrity.googleapis.com/v1/' + PACKAGE + ':decodeIntegrityToken';
const options = { timeout: 4500, retry: false };
const play = {
  async decode(integrityToken) {
    const { data } = await integrityAuth.request({
      ...options, url: integration, method: 'POST', data: { integrity_token: integrityToken },
    });
    return data.tokenPayloadExternal;
  },
  async checkCatalog() {
    await playAuth.request({ ...options, url: app + '/subscriptions/' + PRODUCT });
  },
  async read(token) {
    try {
      const { data } = await playAuth.request({
        ...options, url: app + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token),
      });
      return data;
    } catch (error) {
      if ([404, 410].includes(error.response?.status)) return null;
      throw error;
    }
  },
  async acknowledge(token) {
    try {
      await playAuth.request({
        ...options, method: 'POST', data: {},
        url: app + '/purchases/subscriptions/' + PRODUCT + '/tokens/' + encodeURIComponent(token) + ':acknowledge',
      });
    } catch (error) {
      // Another worker may have acknowledged it first. The subsequent read must confirm it.
      if (![400, 409].includes(error.response?.status)) throw error;
    }
  },
};
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid billing verifier port.');
createBillingServer({ play }).listen(port, '0.0.0.0');
