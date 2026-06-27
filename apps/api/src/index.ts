import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type {
  AgencyInfo,
  ChatMessage,
  ChatMessageInput,
  ChatThread,
  Offer,
  OfferInput
} from '@agency/shared';

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 3001);
const adminKey = process.env.ADMIN_DASHBOARD_KEY ?? 'admin123';

const isAdminAuthorized = (rawHeader: string | string[] | undefined) => {
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return Boolean(value && value.trim() && value.trim() === adminKey);
};

const agency: AgencyInfo = {
  name: 'Orchidea',
  tagline: 'Custom vacation journeys, managed by people who care.',
  about:
    'We curate practical and memorable vacation offers for families, couples, and solo travelers. Compare by state, duration, and value, then talk directly with our team before you book.',
  heroCta: 'Find your next state getaway'
};

const nowIso = () => new Date().toISOString();

const offers: Offer[] = [
  {
    id: randomUUID(),
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
    id: randomUUID(),
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
    id: randomUUID(),
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

const chatThreads: ChatThread[] = [];

const toThreadId = (offerId: string, clientId: string) => `${offerId}:${clientId}`;

const getOfferOrThrow = (offerId: string) => {
  const offer = offers.find((item) => item.id === offerId);
  if (!offer) {
    throw new Error('Offer not found');
  }

  return offer;
};

const assertOfferInput = (body: OfferInput) => {
  if (!body.title || !body.description || !body.state || !body.resortName || !body.imageUrl) {
    throw new Error('Missing required offer fields');
  }

  if (!Number.isFinite(body.durationDays) || body.durationDays <= 0) {
    throw new Error('Duration must be a positive number');
  }

  if (!Number.isFinite(body.price) || body.price <= 0) {
    throw new Error('Price must be a positive number');
  }
};

await app.register(cors, {
  origin: true
});

app.get('/api/agency', async () => agency);

app.get('/api/admin/session', async (request, reply) => {
  if (!isAdminAuthorized(request.headers['x-admin-key'])) {
    return reply.status(401).send({ message: 'Unauthorized admin access' });
  }

  return { ok: true };
});

app.get<{ Querystring: { state?: string } }>('/api/offers', async (request) => {
  const state = request.query.state?.trim().toLowerCase();
  if (!state) {
    return offers;
  }

  return offers.filter((offer) => offer.state.toLowerCase() === state);
});

app.post<{ Body: OfferInput }>('/api/admin/offers', async (request, reply) => {
  if (!isAdminAuthorized(request.headers['x-admin-key'])) {
    return reply.status(401).send({ message: 'Unauthorized admin access' });
  }

  try {
    assertOfferInput(request.body);
  } catch (error) {
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Invalid offer payload'
    });
  }

  const timestamp = nowIso();
  const offer: Offer = {
    id: randomUUID(),
    title: request.body.title.trim(),
    description: request.body.description.trim(),
    state: request.body.state.trim(),
    resortName: request.body.resortName.trim(),
    highlights: request.body.highlights.trim(),
    imageUrl: request.body.imageUrl.trim(),
    durationDays: request.body.durationDays,
    price: request.body.price,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  offers.unshift(offer);
  return reply.status(201).send(offer);
});

app.put<{ Params: { id: string }; Body: OfferInput }>('/api/admin/offers/:id', async (request, reply) => {
  if (!isAdminAuthorized(request.headers['x-admin-key'])) {
    return reply.status(401).send({ message: 'Unauthorized admin access' });
  }

  const target = offers.find((offer) => offer.id === request.params.id);
  if (!target) {
    return reply.status(404).send({ message: 'Offer not found' });
  }

  try {
    assertOfferInput(request.body);
  } catch (error) {
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Invalid offer payload'
    });
  }

  target.title = request.body.title.trim();
  target.description = request.body.description.trim();
  target.state = request.body.state.trim();
  target.resortName = request.body.resortName.trim();
  target.highlights = request.body.highlights.trim();
  target.imageUrl = request.body.imageUrl.trim();
  target.durationDays = request.body.durationDays;
  target.price = request.body.price;
  target.updatedAt = nowIso();

  return target;
});

app.delete<{ Params: { id: string } }>('/api/admin/offers/:id', async (request, reply) => {
  if (!isAdminAuthorized(request.headers['x-admin-key'])) {
    return reply.status(401).send({ message: 'Unauthorized admin access' });
  }

  const index = offers.findIndex((offer) => offer.id === request.params.id);
  if (index < 0) {
    return reply.status(404).send({ message: 'Offer not found' });
  }

  offers.splice(index, 1);
  for (let i = chatThreads.length - 1; i >= 0; i -= 1) {
    if (chatThreads[i].offerId === request.params.id) {
      chatThreads.splice(i, 1);
    }
  }

  return reply.status(204).send();
});

app.get('/api/admin/chats', async (request, reply) => {
  if (!isAdminAuthorized(request.headers['x-admin-key'])) {
    return reply.status(401).send({ message: 'Unauthorized admin access' });
  }

  return [...chatThreads].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
});

app.get<{ Params: { offerId: string; clientId: string } }>(
  '/api/offers/:offerId/chats/:clientId',
  async (request, reply) => {
    try {
      getOfferOrThrow(request.params.offerId);
    } catch {
      return reply.status(404).send({ message: 'Offer not found' });
    }

    const threadId = toThreadId(request.params.offerId, request.params.clientId);
    const thread = chatThreads.find((item) => item.id === threadId);
    if (!thread) {
      return null;
    }

    return thread;
  }
);

app.post<{ Params: { offerId: string }; Body: ChatMessageInput }>(
  '/api/offers/:offerId/chats',
  async (request, reply) => {
    let offer: Offer;
    try {
      offer = getOfferOrThrow(request.params.offerId);
    } catch {
      return reply.status(404).send({ message: 'Offer not found' });
    }

    const text = request.body.text?.trim();
    const clientId = request.body.clientId?.trim();
    const clientName = request.body.clientName?.trim();
    if (!text || !clientId || !clientName) {
      return reply.status(400).send({ message: 'Missing message fields' });
    }

    const sender = request.body.sender === 'admin' ? 'admin' : 'client';
    if (sender === 'admin' && !isAdminAuthorized(request.headers['x-admin-key'])) {
      return reply.status(401).send({ message: 'Unauthorized admin access' });
    }

    const threadId = toThreadId(offer.id, clientId);
    let thread = chatThreads.find((item) => item.id === threadId);

    if (!thread) {
      thread = {
        id: threadId,
        offerId: offer.id,
        offerTitle: offer.title,
        clientId,
        clientName,
        lastMessageAt: nowIso(),
        messages: []
      };
      chatThreads.unshift(thread);
    }

    const message: ChatMessage = {
      id: randomUUID(),
      threadId,
      offerId: offer.id,
      clientId,
      clientName,
      sender,
      text,
      createdAt: nowIso()
    };

    thread.messages.push(message);
    thread.lastMessageAt = message.createdAt;
    thread.clientName = clientName;
    thread.offerTitle = offer.title;

    return thread;
  }
);

const start = async () => {
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
