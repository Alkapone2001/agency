const { sql } = require('@vercel/postgres');

const nowIso = () => new Date().toISOString();
const createId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const agency = {
  name: 'Orchidea',
  tagline: 'Custom vacation journeys, managed by people who care.',
  about:
    'We curate practical and memorable vacation offers for families, couples, and solo travelers. Compare by state, duration, and value, then talk directly with our team before you book.',
  heroCta: 'Find your next state getaway'
};

const adminKey = process.env.ADMIN_DASHBOARD_KEY || 'admin123';
const hasPostgresConfig = Boolean(process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL);

const seedOffers = [
  {
    id: 'seed-florida',
    title: 'Beach Relax Package',
    description: '4 nights near the coast with breakfast and airport pickup included.',
    state: 'Florida',
    resortName: 'Azure Palm Resort',
    highlights: 'Ocean-view suite, airport pickup, breakfast buffet, beach access',
    imageUrl:
      'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    durationDays: 5,
    price: 920,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: 'seed-colorado',
    title: 'Mountain Adventure Week',
    description: 'Hiking, cabin stay, and guided local tours for active travelers.',
    state: 'Colorado',
    resortName: 'Summit Pine Lodge',
    highlights: 'Guided treks, alpine cabins, breakfast and dinner, shuttle service',
    imageUrl:
      'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=80',
    durationDays: 7,
    price: 1280,
    createdAt: nowIso(),
    updatedAt: nowIso()
  },
  {
    id: 'seed-newyork',
    title: 'City Lights Weekend',
    description: '3-day city package with museum passes and central hotel stay.',
    state: 'New York',
    resortName: 'Metropolitan Grand Hotel',
    highlights: 'City center location, museum pass, rooftop lounge, late checkout',
    imageUrl:
      'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
    durationDays: 3,
    price: 670,
    createdAt: nowIso(),
    updatedAt: nowIso()
  }
];

let bootstrapPromise;
let useMemoryFallback = !hasPostgresConfig;

const memoryStore = {
  offers: [...seedOffers],
  threads: []
};

const sendJson = (res, statusCode, data) => {
  res.status(statusCode).json(data);
};

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-key');
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

const validateOfferInput = (body) => {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const state = String(body.state || '').trim();
  const resortName = String(body.resortName || '').trim();
  const highlights = String(body.highlights || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  const durationDays = Number(body.durationDays);
  const price = Number(body.price);

  if (!title || !description || !state || !resortName || !imageUrl) {
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
      resortName,
      highlights,
      imageUrl,
      durationDays,
      price
    }
  };
};

const toOffer = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  state: row.state,
  resortName: row.resort_name || '',
  highlights: row.highlights || '',
  imageUrl: row.image_url || '',
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

const ensureDbBootstrap = async () => {
  if (useMemoryFallback) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS offers (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          state TEXT NOT NULL,
          resort_name TEXT NOT NULL DEFAULT '',
          highlights TEXT NOT NULL DEFAULT '',
          image_url TEXT NOT NULL DEFAULT '',
          duration_days INTEGER NOT NULL CHECK (duration_days > 0),
          price NUMERIC(10,2) NOT NULL CHECK (price > 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`ALTER TABLE offers ADD COLUMN IF NOT EXISTS resort_name TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE offers ADD COLUMN IF NOT EXISTS highlights TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE offers ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT ''`;

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
        INSERT INTO offers (id, title, description, state, resort_name, highlights, image_url, duration_days, price, created_at, updated_at)
        VALUES
          (
            'seed-florida',
            'Beach Relax Package',
            '4 nights near the coast with breakfast and airport pickup included.',
            'Florida',
            'Azure Palm Resort',
            'Ocean-view suite, airport pickup, breakfast buffet, beach access',
            'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
            5,
            920,
            NOW(),
            NOW()
          ),
          (
            'seed-colorado',
            'Mountain Adventure Week',
            'Hiking, cabin stay, and guided local tours for active travelers.',
            'Colorado',
            'Summit Pine Lodge',
            'Guided treks, alpine cabins, breakfast and dinner, shuttle service',
            'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1200&q=80',
            7,
            1280,
            NOW(),
            NOW()
          ),
          (
            'seed-newyork',
            'City Lights Weekend',
            '3-day city package with museum passes and central hotel stay.',
            'New York',
            'Metropolitan Grand Hotel',
            'City center location, museum pass, rooftop lounge, late checkout',
            'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
            3,
            670,
            NOW(),
            NOW()
          )
        ON CONFLICT (id) DO UPDATE
        SET
          resort_name = EXCLUDED.resort_name,
          highlights = EXCLUDED.highlights,
          image_url = EXCLUDED.image_url,
          updated_at = NOW()
      `;
    })();
  }

  await bootstrapPromise;
};

const listOffers = async (state) => {
  if (useMemoryFallback) {
    const normalized = state.trim().toLowerCase();
    const source = normalized
      ? memoryStore.offers.filter((offer) => offer.state.toLowerCase() === normalized)
      : memoryStore.offers;
    return [...source].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

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

  return queryResult.rows.map(toOffer);
};

const getOfferById = async (offerId) => {
  if (useMemoryFallback) {
    return memoryStore.offers.find((offer) => offer.id === offerId) || null;
  }

  const { rows } = await sql`SELECT * FROM offers WHERE id = ${offerId} LIMIT 1`;
  return rows[0] ? toOffer(rows[0]) : null;
};

const createOffer = async (payload) => {
  if (useMemoryFallback) {
    const stamp = nowIso();
    const created = {
      id: createId(),
      ...payload,
      createdAt: stamp,
      updatedAt: stamp
    };
    memoryStore.offers.unshift(created);
    return created;
  }

  const stamp = nowIso();
  const offerId = createId();
  const inserted = await sql`
    INSERT INTO offers (id, title, description, state, resort_name, highlights, image_url, duration_days, price, created_at, updated_at)
    VALUES (
      ${offerId},
      ${payload.title},
      ${payload.description},
      ${payload.state},
      ${payload.resortName},
      ${payload.highlights},
      ${payload.imageUrl},
      ${payload.durationDays},
      ${payload.price},
      ${stamp},
      ${stamp}
    )
    RETURNING *
  `;

  return toOffer(inserted.rows[0]);
};

const updateOffer = async (offerId, payload) => {
  if (useMemoryFallback) {
    const target = memoryStore.offers.find((offer) => offer.id === offerId);
    if (!target) {
      return null;
    }

    target.title = payload.title;
    target.description = payload.description;
    target.state = payload.state;
    target.resortName = payload.resortName;
    target.highlights = payload.highlights;
    target.imageUrl = payload.imageUrl;
    target.durationDays = payload.durationDays;
    target.price = payload.price;
    target.updatedAt = nowIso();

    return target;
  }

  const updated = await sql`
    UPDATE offers
    SET
      title = ${payload.title},
      description = ${payload.description},
      state = ${payload.state},
      resort_name = ${payload.resortName},
      highlights = ${payload.highlights},
      image_url = ${payload.imageUrl},
      duration_days = ${payload.durationDays},
      price = ${payload.price},
      updated_at = NOW()
    WHERE id = ${offerId}
    RETURNING *
  `;

  return updated.rows[0] ? toOffer(updated.rows[0]) : null;
};

const removeOffer = async (offerId) => {
  if (useMemoryFallback) {
    const index = memoryStore.offers.findIndex((offer) => offer.id === offerId);
    if (index < 0) {
      return false;
    }

    memoryStore.offers.splice(index, 1);
    memoryStore.threads = memoryStore.threads.filter((thread) => thread.offerId !== offerId);
    return true;
  }

  const deleted = await sql`DELETE FROM offers WHERE id = ${offerId} RETURNING id`;
  return deleted.rows.length > 0;
};

const getThreadById = async (threadId) => {
  if (useMemoryFallback) {
    const thread = memoryStore.threads.find((item) => item.id === threadId);
    if (!thread) {
      return null;
    }

    return {
      ...thread,
      messages: [...thread.messages]
    };
  }

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
  if (useMemoryFallback) {
    return [...memoryStore.threads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }

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

const appendMessage = async (offer, clientId, clientName, sender, text) => {
  const threadId = threadIdFor(offer.id, clientId);
  const messageTime = nowIso();

  if (useMemoryFallback) {
    let thread = memoryStore.threads.find((item) => item.id === threadId);
    if (!thread) {
      thread = {
        id: threadId,
        offerId: offer.id,
        offerTitle: offer.title,
        clientId,
        clientName,
        lastMessageAt: messageTime,
        messages: []
      };
      memoryStore.threads.unshift(thread);
    }

    const message = {
      id: createId(),
      threadId,
      offerId: offer.id,
      clientId,
      clientName,
      sender,
      text,
      createdAt: messageTime
    };

    thread.messages.push(message);
    thread.offerTitle = offer.title;
    thread.clientName = clientName;
    thread.lastMessageAt = messageTime;

    return {
      ...thread,
      messages: [...thread.messages]
    };
  }

  await sql`
    INSERT INTO chat_threads (id, offer_id, offer_title, client_id, client_name, last_message_at)
    VALUES (${threadId}, ${offer.id}, ${offer.title}, ${clientId}, ${clientName}, ${messageTime})
    ON CONFLICT (id)
    DO UPDATE SET
      offer_title = EXCLUDED.offer_title,
      client_name = EXCLUDED.client_name,
      last_message_at = EXCLUDED.last_message_at
  `;

  await sql`
    INSERT INTO chat_messages (id, thread_id, offer_id, client_id, client_name, sender, text, created_at)
    VALUES (${createId()}, ${threadId}, ${offer.id}, ${clientId}, ${clientName}, ${sender}, ${text}, ${messageTime})
  `;

  return getThreadById(threadId);
};

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    await ensureDbBootstrap();
  } catch {
    useMemoryFallback = true;
  }

  const segments = getPathSegments(req.url);

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'agency') {
    sendJson(res, 200, agency);
    return;
  }

  if (req.method === 'GET' && segments.length === 2 && segments[0] === 'admin' && segments[1] === 'session') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      storageMode: useMemoryFallback ? 'memory-fallback' : 'postgres'
    });
    return;
  }

  if (req.method === 'GET' && segments.length === 1 && segments[0] === 'offers') {
    const state = String((req.query && req.query.state) || '').trim().toLowerCase();
    sendJson(res, 200, await listOffers(state));
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

    sendJson(res, 201, await createOffer(validation.value));
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

    sendJson(res, 200, await updateOffer(offerId, validation.value));
    return;
  }

  if (req.method === 'DELETE' && segments.length === 3 && segments[0] === 'admin' && segments[1] === 'offers') {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { message: 'Unauthorized admin access' });
      return;
    }

    const removed = await removeOffer(segments[2]);
    if (!removed) {
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

    sendJson(res, 200, await getThreadById(threadIdFor(offerId, clientId)));
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

    sendJson(res, 200, await appendMessage(offer, clientId, clientName, sender, text));
    return;
  }

  sendJson(res, 404, { message: 'Route not found' });
};
