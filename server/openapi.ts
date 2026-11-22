export const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Relief Message Checker API (Hackathon Prototype)',
    version: '1.0.0',
    description:
      'Multi-user civic verification SaaS API helping shopkeepers, citizens, and community helpers verify relief payment messages with asymmetric safety routing (10x missed scam cost), PII redaction, versioned rules, server-enforced consent, and append-only audit trails. PROTOTYPE ONLY — all identity, payment, and sender registry data are 100% synthetic/mocked.',
  },
  servers: [
    {
      url: '/',
      description: 'Current Prototype Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Server-signed HMAC-SHA256 Bearer token returned by POST /api/auth/login',
      },
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Partner API key for POST /v1/check (Demo key: rmc_demo_public_key_2026)',
      },
    },
  },
  paths: {
    '/v1/check': {
      post: {
        tags: ['Public Partner API'],
        summary: 'Verify a relief payment message (API Key + Rate Limited 20 req/min)',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message_text'],
                properties: {
                  message_text: { type: 'string', minLength: 6, maxLength: 2500 },
                  sender_claimed: { type: 'string', example: '8171' },
                  payment_ref: { type: 'string', nullable: true, example: 'PAY-8171-4401' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Asymmetric verdict, plain English/Urdu reasons, registry check, and rate-limit metadata' },
          '400': { description: 'Validation error' },
          '401': { description: 'Missing or invalid X-API-Key' },
          '429': { description: 'Rate limit exceeded (includes Retry-After header)' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate via email/password or hackathon demo_role and receive a Bearer JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'helper@relief.demo' },
                  password: { type: 'string', example: 'demo1234' },
                  demo_role: { type: 'string', enum: ['citizen', 'helper', 'officer', 'admin', 'auditor'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Returns { token, user }' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Fetch current authenticated user profile and server capabilities',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Current user object' } },
      },
    },
    '/api/cases': {
      get: {
        tags: ['Cases'],
        summary: 'List cases scoped by role and server-side consent status',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of cases with immutable decision histories' } },
      },
      post: {
        tags: ['Cases'],
        summary: 'Submit a relief message (supports idempotent client_request_id for offline sync)',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message_text'],
                properties: {
                  message_text: { type: 'string' },
                  sender_claimed: { type: 'string' },
                  payment_ref: { type: 'string', nullable: true },
                  family_id: { type: 'string', nullable: true },
                  client_request_id: { type: 'string', nullable: true },
                  use_gemini: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Evaluated case with PII redaction and dual explanation' },
          '200': { description: 'Idempotent replay returning existing case for duplicate client_request_id' },
        },
      },
    },
    '/api/cases/{id}/escalate': {
      post: {
        tags: ['Cases'],
        summary: 'Escalate a case directly to the Department Officer priority queue',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated case routed to officer queue' } },
      },
    },
    '/api/cases/{id}/close': {
      post: {
        tags: ['Cases'],
        summary: 'Close a resolved or reviewed case',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Closed case record' } },
      },
    },
    '/api/families': {
      get: {
        tags: ['Families (Helper Mode)'],
        summary: 'List managed families for Helper Mode',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of family records with phonetic keys' } },
      },
      post: {
        tags: ['Families (Helper Mode)'],
        summary: 'Create family record (returns phonetic candidate_matches without auto-merging)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': { description: 'Phonetic candidate matches found; explicit confirmation required' },
          '201': { description: 'New family record created' },
        },
      },
    },
    '/api/families/{id}': {
      patch: {
        tags: ['Families (Helper Mode)'],
        summary: 'Correct family profile fields (logged in append-only audit log)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated family record' } },
      },
    },
    '/api/review/queue': {
      get: {
        tags: ['Officer Review'],
        summary: 'Priority queue sorted by unverified_officer_review and lowest confidence',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Ordered review queue respecting server-side consent' } },
      },
    },
    '/api/review/{id}/decide': {
      post: {
        tags: ['Officer Review'],
        summary: 'Record an immutable Department Officer verdict (403 if consent withdrawn)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Officer decision recorded' },
          '403': { description: 'Blocked server-side because case_review consent was withdrawn' },
        },
      },
    },
    '/api/review/{id}/request-info': {
      post: {
        tags: ['Officer Review'],
        summary: 'Request safe non-sensitive context (400 Anti-Phishing Guardrail if OTP/CNIC/PIN requested)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Safe info request sent' },
          '400': { description: 'Blocked by server-side anti-phishing guardrail' },
        },
      },
    },
    '/api/rules': {
      get: {
        tags: ['Rules & Thresholds (Admin)'],
        summary: 'List all detection rules and active rule version',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Rules list and active_version' } },
      },
      post: {
        tags: ['Rules & Thresholds (Admin)'],
        summary: 'Publish a new detection rule (increments version live with zero redeploy)',
        security: [{ BearerAuth: [] }],
        responses: { '201': { description: 'New rule created' } },
      },
    },
    '/api/thresholds': {
      get: {
        tags: ['Rules & Thresholds (Admin)'],
        summary: 'Retrieve active asymmetric routing thresholds',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Active thresholds and history' } },
      },
      put: {
        tags: ['Rules & Thresholds (Admin)'],
        summary: 'Update asymmetric thresholds live without redeploy',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'New active threshold version' } },
      },
    },
    '/api/consent': {
      get: {
        tags: ['Consent & Governance'],
        summary: 'View active and withdrawn data sharing consents',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Consent records' } },
      },
    },
    '/api/consent/{id}': {
      delete: {
        tags: ['Consent & Governance'],
        summary: 'Withdraw consent (immediately enforced server-side with 403 on blocked accesses)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Consent withdrawn and logged' } },
      },
    },
    '/api/audit': {
      get: {
        tags: ['Audit (Read-Only)'],
        summary: 'Query append-only audit log (reads, writes, AI decisions, security/consent events)',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Audit log entries' } },
      },
    },
    '/api/audit/cases/{id}/trace': {
      get: {
        tags: ['Audit (Read-Only)'],
        summary: 'Inspect complete immutable JSON AuditorTrace for a specific case',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Case and full JSON auditor_trace' } },
      },
    },
    '/api/stats': {
      get: {
        tags: ['Evaluation'],
        summary: 'Live evaluation of synthetic prototype dataset (N=30) under active DB rules & thresholds',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Raw counts: missed_scams, false_alarms, human_handoffs, rows' } },
      },
    },
    '/api/mock/sender/{senderId}': {
      get: {
        tags: ['Mock DPI Services'],
        summary: 'Query Mock Official Notice / Sender Registry',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'senderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Mock sender verification status + spoof disclaimer' } },
      },
    },
    '/api/mock/identity/{ref}': {
      get: {
        tags: ['Mock DPI Services'],
        summary: 'Consent-gated Mock Identity lookup (returns 403 if mock_identity consent withdrawn)',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Mock identity tier & district' },
          '403': { description: 'Consent withdrawn' },
        },
      },
    },
    '/api/mock/payment/{paymentRef}': {
      get: {
        tags: ['Mock DPI Services'],
        summary: 'Consent-gated Mock Payment Disbursement lookup',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'paymentRef', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Mock disbursement status (valid_pending, duplicate_flagged, etc.)' },
          '403': { description: 'Consent withdrawn' },
        },
      },
    },
  },
};

export function renderDocsHtml(): string {
  const escapedSpec = JSON.stringify(OPENAPI_SPEC).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Relief Message Checker — OpenAPI Documentation</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #F8FAFC; color: #0F172A; }
    .banner { background: #FFFBEB; border-bottom: 1px solid #FDE68A; padding: 10px 24px; font-size: 13px; color: #78350F; text-align: center; }
    .wrap { max-width: 1040px; margin: 0 auto; padding: 32px 24px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    .sub { color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    .actions { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .btn { display: inline-block; background: #0F4C5C; color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 0; cursor: pointer; }
    .btn-sec { background: #fff; color: #0F172A; border: 1px solid #CBD5E1; }
    .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 16px 20px; margin-bottom: 12px; }
    .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .method { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; }
    .GET { background: #EFF6FF; color: #1D4ED8; }
    .POST { background: #F0FDF4; color: #15803D; }
    .PUT, .PATCH { background: #FFFBEB; color: #B45309; }
    .DELETE { background: #FEF2F2; color: #B91C1C; }
    .path { font-family: ui-monospace, monospace; font-size: 14px; font-weight: 600; }
    .tag { font-size: 12px; color: #64748B; margin-left: auto; }
    .desc { margin: 8px 0 0; font-size: 13px; color: #334155; }
    pre { background: #0F172A; color: #E2E8F0; padding: 14px; border-radius: 8px; overflow: auto; font-size: 12px; }
  </style>
</head>
<body>
  <div class="banner"><strong>PROTOTYPE ONLY</strong> — OpenAPI 3.0.3 Reference for Relief Message Checker (Synthetic / Mock DPI Services)</div>
  <div class="wrap">
    <h1>Relief Message Checker — OpenAPI 3.0 Docs</h1>
    <p class="sub">Interactive REST reference for public verification (<code>POST /v1/check</code> with <code>X-API-Key</code>), JWT RBAC case management, Officer review guardrails, versioned rules, server-enforced consent, and append-only audit traces.</p>
    <div class="actions">
      <a class="btn" href="/">Back to App</a>
      <a class="btn btn-sec" href="/openapi.json" target="_blank">Download /openapi.json</a>
      <button class="btn btn-sec" id="try-v1">Try Live POST /v1/check</button>
    </div>
    <div id="live-out" style="display:none;margin-bottom:20px;"><pre id="live-pre"></pre></div>
    <div id="routes"></div>
  </div>
  <script>
    const spec = ${escapedSpec};
    const container = document.getElementById('routes');
    Object.entries(spec.paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, op]) => {
        const div = document.createElement('div');
        div.className = 'card';
        const m = method.toUpperCase();
        div.innerHTML =
          '<div class="row">' +
            '<span class="method ' + m + '">' + m + '</span>' +
            '<span class="path"></span>' +
            '<span class="tag"></span>' +
          '</div>' +
          '<p class="desc"></p>';
        div.querySelector('.path').textContent = path;
        div.querySelector('.tag').textContent = (op.tags || []).join(', ');
        div.querySelector('.desc').textContent = op.summary || '';
        container.appendChild(div);
      });
    });
    document.getElementById('try-v1').addEventListener('click', async () => {
      const out = document.getElementById('live-out');
      const pre = document.getElementById('live-pre');
      out.style.display = 'block';
      pre.textContent = 'Calling POST /v1/check with demo key rmc_demo_public_key_2026...';
      try {
        const res = await fetch('/v1/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': 'rmc_demo_public_key_2026' },
          body: JSON.stringify({
            sender_claimed: '0301-8842109',
            message_text: 'BISP urgent! Send Rs 500 registration fee and OTP 482910 immediately.'
          })
        });
        const data = await res.json();
        pre.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        pre.textContent = String(e);
      }
    });
  </script>
</body>
</html>`;
}
