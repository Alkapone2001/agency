const { sql } = require('@vercel/postgres');

const nowIso = () => new Date().toISOString();
const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const agency = {
  name: 'Atlas Escape Agency',
  tagline: 'Custom vacation journeys, managed by people who care.',
  about:
    'We curate practical and memorable vacation offers for families, couples, and solo travelers. Compare by state, duration, and value, then talk directly with our team before you book.',
  heroCta: 'Find your next state getaway'
};

let bootstrapPromise;
const adminKey = process.env.ADMIN_DASHBOARD_KEY || 'admin123';

const sendJson = (res, statusCode, data) => {
  res.status(statusCode).json(data);
};

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const parseBody = (req) => {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
};

const getPathSegments = (url = '/') => {
  const path = url.split('?')[0] || '/';
  return path.replace(/^\/api\/?/, '').split('/').filter(Boolean);
};

const isAdminAuthorized = (req) => {
  const provided = String(req.headers['x-admin-key'] || '').trim();
  return provided.length > 0 && provided === adminKey;
};

const threadIdFor = (offerId, clientId) => `${offerId}:${clientId}`;

const toOffer = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  state: row.state,
  durationDays: Number(row.duration_days),
  price: Number(row.price),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

const toMessage = (row) => ({
  id: row.id,
  threadId: row.thread_id,
  offerId: row.offer_id,
  clientId: row.client_id,
  clientName: row.client_name,
  sender: row.sender,
  text: row.text,
  createdAt: new Date(row.created_at).toISOString()
});

const toThread = (row, messages) => ({
  id: row.id,
  offerId: row.offer_id,
  offerTitle: row.offer_title,
  clientId: row.client_id,
  clientName: row.client_name,
  lastMessageAt: new Date(row.last_message_at).toISOString(),
  messages
});

const ensureBootstrap = async () => {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS offers (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          state TEXT NOT NULL,
          duration_days INTEGER NOT NULL CHECK (duration_days > 0),
          price NUMERIC(10,2) NOT NULL CHECK (price > 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS chat_threads (
          id TEXT PRIMARY KEY,
          offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
          offer_title TEXT NOT NULL,
          client_id TEXT NOT NULL,
          client_name TEXT NOT NULL,
          last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
          offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
          client_id TEXT NOT NULL,
          client_name TEXT NOT NULL,
          sender TEXT NOT NULL CHECK (sender IN ('client', 'admin')),
          text TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        INSERT INTO offers (id, title, description, state, duration_days, price, created_at, updated_at)
        VALUES
          ('seed-florida', 'Beach Relax Package', '4 nights near the coast with breakfast and airport pickup included.', 'Florida', 5, 920, NOW(), NOW()),
          ('seed-colorado', 'Mountain Adventure Week', 'Hiking, cabin stay, and guided local tours for active travelers.', 'Colorado', 7, 1280, NOW(), NOW()),
          ('seed-newyork', 'City Lights Weekend', '3-day city package with museum passes and central hotel stay.', 'New York', 3, 670, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `;
    })();
  }

  await bootstrapPromise;
};

const getOfferById = async (offerId) => {
  const { rows } = await sql`SELECT * FROM offers WHERE id = ${offerId} LIMIT 1`;
  return rows[0] ? toOffer(rows[0]) : null;
};

const getThreadById = async (threadId) => {
  const { rows: threadRows } = await sql`SELECT * FROM chat_threads WHERE id = ${threadId} LIMIT 1`;
  if (!threadRows[0]) {
    return null;
  }

  const { rows: messageRows } = await sql`
    SELECT * FROM chat_messages
    WHERE thread_id = ${threadId}
    ORDER BY created_at ASC
  `;

  return toThread(threadRows[0], messageRows.map(toMessage));
};

const getAllThreads = async () => {
  const { rows: threadRows } = await sql`
    SELECT * FROM chat_threads
    ORDER BY last_message_at DESC
  `;

  if (threadRows.length === 0) {
    return [];
  }

  const { rows: messageRows } = await sql`
    SELECT * FROM chat_messages
    ORDER BY created_at ASC
  `;

  const grouped = new Map();
  for (const row of messageRows) {
    const key = row.thread_id;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(toMessage(row));
  }

  return threadRows.map((row) => toThread(row, grouped.get(row.id) || []));
};

const validateOfferInput = (body) => {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const state = String(body.state || '').trim();
  const durationDays = Number(body.durationDays);
  const price = Number(body.price);

  if (!title || !description || !state) {
    return { ok: false, message: 'Missing required offer fields' };
  }

  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return { ok: false, message: 'Duration must be a positive number' };
  }

  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, message: 'Price must be a positive number' };
  }

  return {
    ok: true,
    value: {
      title,
      description,
      state,
      durationDays,
      price
    }
  };
};

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const segments = getPathSegments(req.url);

  try {
    await ensureBootstrap();
  } catch (error) {
    sendJson(res, 500, {
      message: 'Database bootstrap failed',
      detail: error instanceof Error ? error.message : 'Unknown database error'
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'agency') {
    sendJson(res, 200, agency);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'admin' && segments[1] === 'session') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'offers') {
    const state = String((req.query && req.query.state) || '').trim().toLowerCase();
    const queryResult = state
      ? await sql`
          SELECT * FROM offers
          WHERE LOWER(state) = ${state}
          ORDER BY updated_at DESC
        `
      : await sql`
          SELECT * FROM offers
          ORDER BY updated_at DESC
        `;

    sendJson(res, 200, queryResult.rows.map(toOffer));
    return;
  }

  if (req.method === 'POST' && segments.length === 2 && segments[0] === 'admin' && segments[1] === 'offers') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    const validation = validateOfferInput(parseBody(req));
    if (!validation.ok) {
      sendJson(res, 400, { message: validation.message });
      return;
    }

    const stamp = nowIso();
    const offerId = createId();
    const inserted = await sql`
      INSERT INTO offers (id, title, description, state, duration_days, price, created_at, updated_at)
      VALUES (
        ${offerId},
        ${validation.value.title},
        ${validation.value.description},
        ${validation.value.state},
        ${validation.value.durationDays},
        ${validation.value.price},
        ${stamp},
        ${stamp}
      )
      RETURNING *
    `;

    sendJson(res, 201, toOffer(inserted.rows[0]));
    return;
  }

  if (req.method === 'PUT' && segments.length === 3 && segments[0] === 'admin' && segments[1] === 'offers') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    const offerId = segments[2];
    const existingOffer = await getOfferById(offerId);
    if (!existingOffer) {
      sendJson(res, 404, { message: 'Offer not found' });
      return;
    }

    const validation = validateOfferInput(parseBody(req));
    if (!validation.ok) {
      sendJson(res, 400, { message: validation.message });
      return;
    }

    const updated = await sql`
      UPDATE offers
      SET
        title = ${validation.value.title},
        description = ${validation.value.description},
        state = ${validation.value.state},
        duration_days = ${validation.value.durationDays},
        price = ${validation.value.price},
        updated_at = NOW()
      WHERE id = ${offerId}
      RETURNING *
    `;

    sendJson(res, 200, toOffer(updated.rows[0]));
    return;
  }

  if (req.method === 'DELETE' && segments.length === 3 && segments[0] === 'admin' && segments[1] === 'offers') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    const offerId = segments[2];
    const deleted = await sql`DELETE FROM offers WHERE id = ${offerId} RETURNING id`;
    if (deleted.rows.length === 0) {
      sendJson(res, 404, { message: 'Offer not found' });
      return;
    }

    res.status(204).end();
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'admin' && segments[1] === 'chats') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    sendJson(res, 200, await getAllThreads());
    return;
  }

  if (
    req.method === 'GET' &&
    segments.length === 4 &&
    segments[0] === 'offers' &&
    segments[2] === 'chats'
  ) {
    const offerId = segments[1];
    const clientId = segments[3];
    const offer = await getOfferById(offerId);
    if (!offer) {
      sendJson(res, 404, { message: 'Offer not found' });
      return;
    }

    const thread = await getThreadById(threadIdFor(offerId, clientId));
    sendJson(res, 200, thread);
    return;
  }

  if (
    req.method === 'POST' &&
    segments.length === 3 &&
    segments[0] === 'offers' &&
    segments[2] === 'chats'
  ) {
    const offerId = segments[1];
    const offer = await getOfferById(offerId);
    if (!offer) {
      sendJson(res, 404, { message: 'Offer not found' });
      return;
    }

    const body = parseBody(req);
    const clientId = String(body.clientId || '').trim();
    const clientName = String(body.clientName || '').trim();
    const text = String(body.text || '').trim();
    const sender = body.sender === 'admin' ? 'admin' : 'client';

    if (sender === 'admin' && !isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    if (!clientId || !clientName || !text) {
      sendJson(res, 400, { message: 'Missing message fields' });
      return;
    }

    const threadId = threadIdFor(offerId, clientId);
    const messageTime = nowIso();

    await sql`
      INSERT INTO chat_threads (id, offer_id, offer_title, client_id, client_name, last_message_at)
      VALUES (${threadId}, ${offerId}, ${offer.title}, ${clientId}, ${clientName}, ${messageTime})
      ON CONFLICT (id)
      DO UPDATE SET
        offer_title = EXCLUDED.offer_title,
        client_name = EXCLUDED.client_name,
        last_message_at = EXCLUDED.last_message_at
    `;

    await sql`
      INSERT INTO chat_messages (id, thread_id, offer_id, client_id, client_name, sender, text, created_at)
      VALUES (${createId()}, ${threadId}, ${offerId}, ${clientId}, ${clientName}, ${sender}, ${text}, ${messageTime})
    `;

    sendJson(res, 200, await getThreadById(threadId));
    return;
  }

  sendJson(res, 404, { message: 'Route not found' });
};
