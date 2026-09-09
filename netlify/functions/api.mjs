```javascript
export default async (req) => {
  try {
    /*
     * ------------------------------------------------------------
     * 1. READ REQUEST
     * ------------------------------------------------------------
     */

    let input = {};

    try {
      input = await req.json();
    } catch {
      return json(
        {
          detail: 'Invalid JSON request.'
        },
        400
      );
    }

    const url = normalizeUrl(
      input.url ||
      req.headers.get('x-listmonk-url') ||
      ''
    );

    const username = String(
      input.username ||
      req.headers.get('x-listmonk-user') ||
      ''
    ).trim();

    const token = String(
      input.token ||
      req.headers.get('x-listmonk-token') ||
      ''
    ).trim();

    /*
     * ------------------------------------------------------------
     * 2. SECURITY VALIDATION
     * ------------------------------------------------------------
     */

    if (!url) {
      return json(
        {
          detail: 'Listmonk URL is required.'
        },
        400
      );
    }

    if (!/^https:\/\//i.test(url)) {
      return json(
        {
          detail: 'Listmonk URL must use HTTPS.'
        },
        400
      );
    }

    let host = '';

    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return json(
        {
          detail: 'Invalid Listmonk URL.'
        },
        400
      );
    }

    if (host !== 'campaigns.my-arenagames.com') {
      return json(
        {
          detail:
            'For security, this web version is restricted to campaigns.my-arenagames.com.'
        },
        400
      );
    }

    if (!username) {
      return json(
        {
          detail: 'Listmonk username is required.'
        },
        400
      );
    }

    if (!token) {
      return json(
        {
          detail: 'Listmonk API token is required.'
        },
        400
      );
    }

    /*
     * ------------------------------------------------------------
     * 3. CONNECTION TEST
     * ------------------------------------------------------------
     *
     * We intentionally use GET without a request body.
     */

    if (input.action === 'connect') {
      const response = await lmFetch(
        url,
        username,
        token,
        'GET',
        '/lists?status=active&per_page=100&minimal=true'
      );

      const raw = await text(response);

      if (!response.ok) {
        return json(
          {
            detail: friendlyError(response.status, raw)
          },
          response.status
        );
      }

      const parsed = parseJson(raw);

      /*
       * Listmonk normally returns:
       *
       * {
       *   data: {
       *     total: ...,
       *     results: [...]
       *   }
       * }
       *
       * We normalize it so the frontend always gets:
       *
       * {
       *   connected: true,
       *   data: [...]
       * }
       */

      const results = extractResults(parsed);

      return json(
        {
          connected: true,
          url,
          data: results,
          count: results.length
        },
        200
      );
    }

    /*
     * ------------------------------------------------------------
     * 4. GENERAL LISTMONK REQUEST
     * ------------------------------------------------------------
     */

    if (input.action !== 'request') {
      return json(
        {
          detail: 'Unsupported action.'
        },
        400
      );
    }

    const path = String(input.path || '').trim();

    if (!path) {
      return json(
        {
          detail: 'Listmonk API path is required.'
        },
        400
      );
    }

    /*
     * Allowed endpoints:
     *
     * /lists
     * /lists?...
     *
     * /templates
     * /templates?...
     *
     * /campaigns
     * /campaigns?...
     *
     * /campaigns/123/test
     * /campaigns/123/status
     */

    const allowed =
      /^\/(lists|templates|campaigns)(\/\d+\/(test|status))?(?:\?.*)?$/;

    if (!allowed.test(path)) {
      return json(
        {
          detail: 'Endpoint not allowed.'
        },
        400
      );
    }

    const method = String(
      input.method || 'GET'
    ).toUpperCase();

    if (!['GET', 'POST', 'PUT'].includes(method)) {
      return json(
        {
          detail: 'Method not allowed.'
        },
        405
      );
    }

    /*
     * ------------------------------------------------------------
     * 5. LISTMONK REQUEST
     * ------------------------------------------------------------
     */

    const response = await lmFetch(
      url,
      username,
      token,
      method,
      path,
      input.body
    );

    const raw = await text(response);

    if (!response.ok) {
      return json(
        {
          detail: friendlyError(response.status, raw),
          status: response.status,
          endpoint: path
        },
        response.status
      );
    }

    const parsed = parseJson(raw);

    /*
     * ------------------------------------------------------------
     * 6. NORMALIZE LISTS / TEMPLATES
     * ------------------------------------------------------------
     *
     * Listmonk uses:
     *
     * data.results
     *
     * The frontend is much easier to maintain if this Function
     * always exposes the actual array directly as data.
     */

    if (
      method === 'GET' &&
      (
        path === '/lists' ||
        path.startsWith('/lists?')
      )
    ) {
      const results = extractResults(parsed);

      return json(
        {
          data: results,
          results,
          total: extractTotal(parsed, results.length)
        },
        response.status
      );
    }

    if (
      method === 'GET' &&
      (
        path === '/templates' ||
        path.startsWith('/templates?')
      )
    ) {
      const results = extractResults(parsed);

      return json(
        {
          data: results,
          results,
          total: extractTotal(parsed, results.length)
        },
        response.status
      );
    }

    /*
     * ------------------------------------------------------------
     * 7. CAMPAIGNS / OTHER RESPONSES
     * ------------------------------------------------------------
     *
     * Campaign responses are returned without destroying their
     * original Listmonk structure.
     */

    return json(
      parsed ?? {
        data: true
      },
      response.status
    );

  } catch (error) {
    /*
     * Never expose internal credentials or sensitive details.
     */

    console.error(
      'MY ARENA EMAIL SUITE / Listmonk proxy error:',
      error
    );

    return json(
      {
        detail:
          'Unexpected server error while contacting Listmonk.'
      },
      502
    );
  }
};


/*
 * ============================================================
 * URL NORMALIZATION
 * ============================================================
 */

function normalizeUrl(raw) {
  let url = String(raw || '').trim();

  /*
   * Remove trailing slash(es)
   */
  url = url.replace(/\/+$/, '');

  /*
   * If user enters:
   *
   * https://campaigns.my-arenagames.com/api
   *
   * convert it to:
   *
   * https://campaigns.my-arenagames.com
   */

  url = url.replace(/\/api$/i, '');

  return url;
}


/*
 * ============================================================
 * LISTMONK FETCH
 * ============================================================
 */

async function lmFetch(
  url,
  user,
  token,
  method,
  path,
  body
) {
  const m = String(
    method || 'GET'
  ).toUpperCase();

  /*
   * CRITICAL:
   *
   * GET and HEAD requests MUST NOT contain a body.
   *
   * This prevents:
   *
   * "Request with GET/HEAD method cannot have body."
   */

  const hasBody =
    !['GET', 'HEAD'].includes(m) &&
    body !== undefined &&
    body !== null;

  const headers = {
    Authorization: `token ${user}:${token}`,
    Accept: 'application/json'
  };

  if (hasBody) {
    headers['Content-Type'] =
      'application/json';
  }

  const endpoint =
    `${url}/api${path}`;

  return fetch(
    endpoint,
    {
      method: m,
      headers,
      body: hasBody
        ? JSON.stringify(body)
        : undefined
    }
  );
}


/*
 * ============================================================
 * READ RESPONSE BODY
 * ============================================================
 */

async function text(response) {
  try {
    return (
      await response.text()
    ).slice(0, 10000);
  } catch {
    return '';
  }
}


/*
 * ============================================================
 * SAFE JSON PARSER
 * ============================================================
 */

function parseJson(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {
      data: raw
    };
  }
}


/*
 * ============================================================
 * EXTRACT RESULTS
 * ============================================================
 *
 * Supports all of these possible structures:
 *
 * 1. { data: [...] }
 * 2. { data: { results: [...] } }
 * 3. { results: [...] }
 * 4. [...]
 *
 * This makes the frontend independent of minor API response
 * differences.
 */

function extractResults(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.results)) {
    return payload.results;
  }

  if (
    payload.data &&
    Array.isArray(payload.data)
  ) {
    return payload.data;
  }

  if (
    payload.data &&
    typeof payload.data === 'object' &&
    Array.isArray(payload.data.results)
  ) {
    return payload.data.results;
  }

  return [];
}


/*
 * ============================================================
 * EXTRACT TOTAL
 * ============================================================
 */

function extractTotal(payload, fallback = 0) {
  if (
    payload &&
    payload.data &&
    typeof payload.data === 'object' &&
    Number.isFinite(
      Number(payload.data.total)
    )
  ) {
    return Number(
      payload.data.total
    );
  }

  if (
    payload &&
    Number.isFinite(
      Number(payload.total)
    )
  ) {
    return Number(
      payload.total
    );
  }

  return fallback;
}


/*
 * ============================================================
 * FRIENDLY LISTMONK ERRORS
 * ============================================================
 */

function friendlyError(
  status,
  raw
) {
  let extra = '';

  try {
    const parsed =
      JSON.parse(raw);

    if (
      parsed &&
      typeof parsed.message === 'string'
    ) {
      extra =
        `: ${parsed.message}`;
    } else if (
      parsed &&
      typeof parsed.detail === 'string'
    ) {
      extra =
        `: ${parsed.detail}`;
    }
  } catch {
    /*
     * Response was not JSON.
     * Keep the standard error below.
     */
  }

  if (status === 400) {
    return (
      `Listmonk rejected the request (400)` +
      (
        extra ||
        ': check the request data.'
      )
    );
  }

  if (status === 401) {
    return (
      `Listmonk authentication failed (401)` +
      (
        extra ||
        ': check the API user and API token.'
      )
    );
  }

  if (status === 403) {
    return (
      `Listmonk access denied (403)` +
      (
        extra ||
        ': this API user does not have the required permissions.'
      )
    );
  }

  if (status === 404) {
    return (
      `Listmonk endpoint not found (404)` +
      (
        extra ||
        ': check the Listmonk URL or API endpoint.'
      )
    );
  }

  if (status === 405) {
    return (
      `Listmonk rejected this request method (405)` +
      extra
    );
  }

  if (status === 409) {
    return (
      `Listmonk conflict (409)` +
      (
        extra ||
        ': the requested operation conflicts with the current resource state.'
      )
    );
  }

  if (status === 422) {
    return (
      `Listmonk validation failed (422)` +
      (
        extra ||
        ': check the campaign or resource data.'
      )
    );
  }

  if (status === 500) {
    return (
      `Listmonk server error (500)` +
      (
        extra ||
        ': the Listmonk instance failed to process the request.'
      )
    );
  }

  if (status === 502) {
    return (
      `Listmonk gateway error (502)` +
      extra
    );
  }

  if (status === 503) {
    return (
      `Listmonk service unavailable (503)` +
      extra
    );
  }

  return (
    `Listmonk request failed (HTTP ${status})` +
    extra
  );
}


/*
 * ============================================================
 * JSON RESPONSE
 * ============================================================
 */

function json(
  body,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type':
          'application/json; charset=utf-8',
        'cache-control':
          'no-store'
      }
    }
  );
}
```
