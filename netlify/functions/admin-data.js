// Netlify Function: secure server-side access to Netlify Forms submissions.
//
// The admin page (/admin12345/) POSTs { password, type } here. The password
// is checked against the ADMIN_PASSWORD environment variable *before* any
// data is fetched, so a wrong/missing password never reaches the Netlify API
// and never returns real lead/product data.
//
// Required environment variables (set in Netlify: Site settings -> Environment
// variables):
//   ADMIN_PASSWORD    - the shared password for the admin page
//   NETLIFY_API_TOKEN - a Personal Access Token (User settings -> Applications)
// SITE_ID is provided automatically by Netlify at runtime, so it does not
// need to be set manually (NETLIFY_SITE_ID can still be set to override it).

const FORM_NAMES_BY_TYPE = {
  leads: ['contact', 'configurator-request'],
  products: ['product-submission'],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { password, type } = payload;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedPassword || typeof password !== 'string' || password !== expectedPassword) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid password' }) };
  }

  const wantedForms = FORM_NAMES_BY_TYPE[type];
  if (!wantedForms) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid type. Use "leads" or "products".' }) };
  }

  const token = process.env.NETLIFY_API_TOKEN;
  // SITE_ID is auto-injected by Netlify into every Function at runtime.
  // NETLIFY_SITE_ID is kept as an optional manual override/fallback (e.g. for
  // local `netlify dev` runs where it may not always be populated).
  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  if (!token || !siteId) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server not configured: missing NETLIFY_API_TOKEN environment variable (or SITE_ID could not be determined).',
      }),
    };
  }

  const authHeaders = { Authorization: 'Bearer ' + token };

  try {
    const formsRes = await fetch(
      'https://api.netlify.com/api/v1/sites/' + siteId + '/forms',
      { headers: authHeaders }
    );
    if (!formsRes.ok) {
      const text = await formsRes.text();
      throw new Error('Netlify API forms list failed (' + formsRes.status + '): ' + text);
    }
    const allForms = await formsRes.json();

    const results = {};
    for (const formName of wantedForms) {
      const form = allForms.find((f) => f.name === formName);
      if (!form) {
        results[formName] = [];
        continue;
      }
      const subsRes = await fetch(
        'https://api.netlify.com/api/v1/forms/' + form.id + '/submissions',
        { headers: authHeaders }
      );
      results[formName] = subsRes.ok ? await subsRes.json() : [];
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, forms: results }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to reach Netlify API: ' + (err && err.message ? err.message : String(err)) }),
    };
  }
};
