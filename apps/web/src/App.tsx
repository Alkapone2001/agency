import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgencyInfo, ChatThread, Offer, OfferInput } from '@agency/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? '';

type Panel = 'client' | 'admin';
type SeenMap = Record<string, string>;

const createClientId = () =>
  `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

const getClientId = () => {
  const existing = window.localStorage.getItem('agency-client-id');
  if (existing) {
    return existing;
  }

  const generated = createClientId();
  window.localStorage.setItem('agency-client-id', generated);
  return generated;
};

const getClientName = () => window.localStorage.getItem('agency-client-name') ?? '';

const toOfferInput = (form: OfferInput): OfferInput => ({
  title: form.title.trim(),
  description: form.description.trim(),
  state: form.state.trim(),
  resortName: form.resortName.trim(),
  highlights: form.highlights.trim(),
  imageUrl: form.imageUrl.trim(),
  durationDays: Number(form.durationDays),
  price: Number(form.price)
});

const initialOfferForm: OfferInput = {
  title: '',
  description: '',
  state: '',
  resortName: '',
  highlights: '',
  imageUrl: '',
  durationDays: 4,
  price: 400
};

const fallbackOfferImage =
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80';

const quickClientPrompts = [
  'Can you share full package details?',
  'Is airport transfer included?',
  'Can you suggest family-friendly options?',
  'What is the cancellation policy?'
];

const initialPanel: Panel = window.location.pathname.startsWith('/admin') ? 'admin' : 'client';

const readSeenMap = (key: string): SeenMap => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as SeenMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const saveSeenMap = (key: string, value: SeenMap) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function App() {
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [agency, setAgency] = useState<AgencyInfo | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stateFilter, setStateFilter] = useState('All States');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOfferId, setSelectedOfferId] = useState<string>('');

  const [clientId] = useState<string>(() => getClientId());
  const [clientName, setClientName] = useState<string>(() => getClientName());
  const [clientChatInput, setClientChatInput] = useState('');
  const [clientThread, setClientThread] = useState<ChatThread | null>(null);
  const [clientChatOpen, setClientChatOpen] = useState(false);
  const [clientSeenByThread, setClientSeenByThread] = useState<SeenMap>(() =>
    readSeenMap('agency-client-seen-map')
  );

  const [adminKeyInput, setAdminKeyInput] = useState(
    () => window.localStorage.getItem('agency-admin-key') ?? ''
  );
  const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('agency-admin-key') ?? '');
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [offerForm, setOfferForm] = useState<OfferInput>(initialOfferForm);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [adminThreads, setAdminThreads] = useState<ChatThread[]>([]);
  const [activeAdminThreadId, setActiveAdminThreadId] = useState<string>('');
  const [adminReply, setAdminReply] = useState('');
  const [adminSeenByThread, setAdminSeenByThread] = useState<SeenMap>(() =>
    readSeenMap('agency-admin-seen-map')
  );
  const clientMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.id === selectedOfferId) ?? null,
    [offers, selectedOfferId]
  );

  const activeAdminThread = useMemo(
    () => adminThreads.find((thread) => thread.id === activeAdminThreadId) ?? null,
    [adminThreads, activeAdminThreadId]
  );

  const states = useMemo(() => {
    const values = Array.from(new Set(offers.map((offer) => offer.state))).sort();
    return ['All States', ...values];
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const byState =
      stateFilter === 'All States' ? offers : offers.filter((offer) => offer.state === stateFilter);

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return byState;
    }

    return byState.filter(
      (offer) =>
        offer.title.toLowerCase().includes(query) ||
        offer.description.toLowerCase().includes(query) ||
        offer.state.toLowerCase().includes(query) ||
        offer.resortName.toLowerCase().includes(query) ||
        offer.highlights.toLowerCase().includes(query)
    );
  }, [offers, stateFilter, searchQuery]);

  const adminRequest = <T,>(path: string, init?: RequestInit) =>
    requestJson<T>(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        'x-admin-key': adminKey
      }
    });

  const refreshOffers = async () => {
    const loaded = await requestJson<Offer[]>('/api/offers');
    setOffers(loaded);
    if (!selectedOfferId && loaded[0]) {
      setSelectedOfferId(loaded[0].id);
    }
  };

  const refreshAdminThreads = async () => {
    if (!adminLoggedIn) {
      setAdminThreads([]);
      return;
    }

    const loaded = await adminRequest<ChatThread[]>('/api/admin/chats');
    setAdminThreads(loaded);
    if (!activeAdminThreadId && loaded.length > 0) {
      setActiveAdminThreadId(loaded[0].id);
    }
  };

  const switchPanel = (nextPanel: Panel) => {
    setPanel(nextPanel);
    const targetPath = nextPanel === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
  };

  const loadBase = async () => {
    setError(null);
    const [agencyInfo] = await Promise.all([requestJson<AgencyInfo>('/api/agency'), refreshOffers()]);
    setAgency(agencyInfo);
  };

  const validateAdminSession = async (candidate: string) => {
    await requestJson<{ ok: true }>('/api/admin/session', {
      headers: { 'x-admin-key': candidate }
    });
  };

  useEffect(() => {
    const load = async () => {
      try {
        await loadBase();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load application');
      }
    };

    void load();
  }, []);

  useEffect(() => {
    if (panel !== 'admin') {
      return;
    }

    const bootstrapAdmin = async () => {
      if (!adminKey) {
        return;
      }

      try {
        await validateAdminSession(adminKey);
        setAdminLoggedIn(true);
      } catch {
        setAdminLoggedIn(false);
      }
    };

    void bootstrapAdmin();
  }, [panel, adminKey]);

  useEffect(() => {
    if (!selectedOfferId || !clientId) {
      setClientThread(null);
      return;
    }

    const poll = async () => {
      try {
        const thread = await requestJson<ChatThread | null>(
          `/api/offers/${selectedOfferId}/chats/${clientId}`
        );
        setClientThread(thread);
      } catch {
        setClientThread(null);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 2200);
    return () => window.clearInterval(timer);
  }, [selectedOfferId, clientId]);

  useEffect(() => {
    if (!adminLoggedIn || panel !== 'admin') {
      return;
    }

    void refreshAdminThreads();
    const timer = window.setInterval(() => void refreshAdminThreads(), 2500);
    return () => window.clearInterval(timer);
  }, [adminLoggedIn, panel, activeAdminThreadId]);

  useEffect(() => {
    if (!clientThread || !clientChatOpen) {
      return;
    }

    const updated = {
      ...clientSeenByThread,
      [clientThread.id]: new Date().toISOString()
    };
    setClientSeenByThread(updated);
    saveSeenMap('agency-client-seen-map', updated);
  }, [clientThread, clientChatOpen]);

  useEffect(() => {
    if (!activeAdminThread) {
      return;
    }

    const updated = {
      ...adminSeenByThread,
      [activeAdminThread.id]: new Date().toISOString()
    };
    setAdminSeenByThread(updated);
    saveSeenMap('agency-admin-seen-map', updated);
  }, [activeAdminThreadId]);

  useEffect(() => {
    if (!clientChatOpen) {
      return;
    }

    clientMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [clientChatOpen, clientThread?.messages.length]);

  const resetOfferForm = () => {
    setOfferForm(initialOfferForm);
    setEditingOfferId(null);
  };

  const loginAdmin = async () => {
    const candidate = adminKeyInput.trim();
    if (!candidate) {
      setError('Enter your admin key to continue');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      await validateAdminSession(candidate);
      window.localStorage.setItem('agency-admin-key', candidate);
      setAdminKey(candidate);
      setAdminLoggedIn(true);
      await refreshAdminThreads();
    } catch (err) {
      setAdminLoggedIn(false);
      setError(err instanceof Error ? err.message : 'Admin login failed');
    } finally {
      setBusy(false);
    }
  };

  const logoutAdmin = () => {
    window.localStorage.removeItem('agency-admin-key');
    setAdminKey('');
    setAdminKeyInput('');
    setAdminLoggedIn(false);
    setAdminThreads([]);
    setActiveAdminThreadId('');
  };

  const saveOffer = async () => {
    try {
      setBusy(true);
      setError(null);
      const payload = JSON.stringify(toOfferInput(offerForm));

      if (editingOfferId) {
        await adminRequest<Offer>(`/api/admin/offers/${editingOfferId}`, {
          method: 'PUT',
          body: payload
        });
      } else {
        await adminRequest<Offer>('/api/admin/offers', {
          method: 'POST',
          body: payload
        });
      }

      await refreshOffers();
      resetOfferForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save offer');
    } finally {
      setBusy(false);
    }
  };

  const deleteOffer = async (offerId: string) => {
    try {
      setBusy(true);
      setError(null);
      await adminRequest<void>(`/api/admin/offers/${offerId}`, { method: 'DELETE' });
      await Promise.all([refreshOffers(), refreshAdminThreads()]);
      if (selectedOfferId === offerId) {
        setSelectedOfferId('');
      }
      if (editingOfferId === offerId) {
        resetOfferForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete offer');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (offer: Offer) => {
    setEditingOfferId(offer.id);
    setOfferForm({
      title: offer.title,
      description: offer.description,
      state: offer.state,
      resortName: offer.resortName,
      highlights: offer.highlights,
      imageUrl: offer.imageUrl,
      durationDays: offer.durationDays,
      price: offer.price
    });
    switchPanel('admin');
  };

  const sendClientMessage = async () => {
    const text = clientChatInput.trim();
    if (!selectedOfferId || !text) {
      return;
    }

    const safeName = clientName.trim() || 'Guest Traveler';
    window.localStorage.setItem('agency-client-name', safeName);
    setClientName(safeName);

    try {
      setError(null);
      const thread = await requestJson<ChatThread>(`/api/offers/${selectedOfferId}/chats`, {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          clientName: safeName,
          sender: 'client',
          text
        })
      });
      setClientThread(thread);
      setClientChatInput('');
      setClientChatOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    }
  };

  const sendAdminReply = async () => {
    if (!activeAdminThread || !adminReply.trim()) {
      return;
    }

    try {
      const thread = await adminRequest<ChatThread>(`/api/offers/${activeAdminThread.offerId}/chats`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: activeAdminThread.clientId,
          clientName: activeAdminThread.clientName,
          sender: 'admin',
          text: adminReply
        })
      });

      setAdminReply('');
      setAdminThreads((current) =>
        [thread, ...current.filter((item) => item.id !== thread.id)].sort((a, b) =>
          b.lastMessageAt.localeCompare(a.lastMessageAt)
        )
      );
      if (clientThread?.id === thread.id) {
        setClientThread(thread);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send admin reply');
    }
  };

  const clientUnreadCount = useMemo(() => {
    if (!clientThread) {
      return 0;
    }

    const seenAt = clientSeenByThread[clientThread.id] ?? '';
    return clientThread.messages.filter(
      (message) => message.sender === 'admin' && message.createdAt > seenAt
    ).length;
  }, [clientSeenByThread, clientThread]);

  const adminUnreadByThread = useMemo(() => {
    const map: Record<string, number> = {};
    for (const thread of adminThreads) {
      const seenAt = adminSeenByThread[thread.id] ?? '';
      map[thread.id] = thread.messages.filter(
        (message) => message.sender === 'client' && message.createdAt > seenAt
      ).length;
    }
    return map;
  }, [adminSeenByThread, adminThreads]);

  return (
    <main className="full-shell">
      <header className="main-nav-wrap">
        <div className="main-nav">
          <div className="logo-box">
            <span className="logo-dot" />
            <strong>Orchidea</strong>
          </div>
          <div className="main-links">
            <a href="#home">Home</a>
            <a href="#solutions">Solutions</a>
            <a href="#offers">Offers</a>
            <a href="#messenger">Messenger</a>
          </div>
          <div className="main-actions">
            <button
              type="button"
              className={panel === 'client' ? 'nav-pill active' : 'nav-pill'}
              onClick={() => switchPanel('client')}
            >
              Client
            </button>
            <button
              type="button"
              className={panel === 'admin' ? 'nav-pill active' : 'nav-pill'}
              onClick={() => switchPanel('admin')}
            >
              Admin
            </button>
          </div>
        </div>
      </header>

      <section className="hero-grid" id="home">
        <div className="hero-left">
          <p className="hero-kicker">Modern Travel Booking Operations</p>
          <h1>{agency?.name ?? 'Orchidea'}</h1>
          <p className="hero-tag">{agency?.tagline}</p>
          <p className="hero-text">{agency?.about}</p>
          <div className="hero-cta-row">
            <button type="button" onClick={() => document.getElementById('offers')?.scrollIntoView()}>
              Explore Offers
            </button>
            <button type="button" className="ghost" onClick={() => setClientChatOpen(true)}>
              Contact Advisor
            </button>
          </div>
        </div>
        <div className="hero-right">
          <article>
            <h4>Vacation Offers</h4>
            <p>All-inclusive and custom curated experiences by destination and budget.</p>
          </article>
          <article>
            <h4>Flight Tickets</h4>
            <p>Flexible flight support from route planning to schedule optimization.</p>
          </article>
          <article>
            <h4>Hotel Bookings</h4>
            <p>Premium to smart-stay options tailored to your trip style.</p>
          </article>
        </div>
      </section>

      <section className="info-grid" id="solutions">
        <article>
          <h3>Dedicated Agency Experts</h3>
          <p>Every request is handled by a real advisor with direct context of your travel intent.</p>
        </article>
        <article>
          <h3>Fast Multi-service Quotes</h3>
          <p>Packages, flights, and hotels coordinated under one conversation flow.</p>
        </article>
        <article>
          <h3>Messenger-grade Support</h3>
          <p>Threaded chat with read/unread awareness for better response management.</p>
        </article>
      </section>

      {error && <p className="error-banner">{error}</p>}

      {panel === 'client' && (
        <section className="client-layout" id="offers">
          <article className="catalog-panel">
            <div className="section-head">
              <h2>Find Offers Faster</h2>
              <p>Use smart filters and search to get the right package before chatting.</p>
            </div>
            <div className="filters">
              <label>
                Name
                <input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Your full name"
                />
              </label>
              <label>
                State
                <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
                  {states.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Search
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Beach, city, mountain"
                />
              </label>
            </div>
            <div className="offer-grid">
              {filteredOffers.map((offer) => (
                <article
                  key={offer.id}
                  className={offer.id === selectedOfferId ? 'offer-card selected' : 'offer-card'}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedOfferId(offer.id);
                    setClientChatOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedOfferId(offer.id);
                      setClientChatOpen(true);
                    }
                  }}
                >
                  <img
                    className="offer-image"
                    src={offer.imageUrl || fallbackOfferImage}
                    alt={`${offer.resortName} in ${offer.state}`}
                    loading="lazy"
                  />
                  <div className="offer-top">
                    <h3>{offer.title}</h3>
                    <span>${offer.price}</span>
                  </div>
                  <p className="offer-subtitle">{offer.resortName}</p>
                  <p>{offer.description}</p>
                  <p className="offer-highlights">{offer.highlights}</p>
                  <div className="chips">
                    <span>{offer.state}</span>
                    <span>{offer.durationDays} days</span>
                  </div>
                  <div className="btn-row">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedOfferId(offer.id);
                        setClientChatOpen(true);
                      }}
                    >
                      Chat This Offer
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="messenger-panel" id="messenger">
            <div className="messenger-header">
              <div>
                <strong>Agency Messenger</strong>
                <p>
                  {selectedOffer
                    ? `Now discussing: ${selectedOffer.title}`
                    : 'Select an offer to start chatting'}
                </p>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setClientChatOpen((value) => !value)}
              >
                {clientChatOpen ? 'Minimize' : 'Open'}
                {clientUnreadCount > 0 && <span className="badge">{clientUnreadCount}</span>}
              </button>
            </div>

            {selectedOffer && (
              <div className="active-offer-banner">
                <span>{selectedOffer.title}</span>
                <small>
                  {selectedOffer.state} • {selectedOffer.durationDays} days • ${selectedOffer.price}
                </small>
              </div>
            )}

            {clientChatOpen && (
              <>
                <div className="messages">
                  {!clientThread?.messages.length && (
                    <div className="chat-empty">
                      Choose an offer and send your first message. Our team replies here in real time.
                    </div>
                  )}
                  {(clientThread?.messages ?? []).map((message) => (
                    <div
                      key={message.id}
                      className={message.sender === 'admin' ? 'message admin' : 'message client'}
                    >
                      <p>{message.text}</p>
                      <small>
                        {message.sender === 'admin' ? 'Advisor' : clientName || 'You'} •{' '}
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </small>
                    </div>
                  ))}
                  <div ref={clientMessagesEndRef} />
                </div>
                <div className="quick-row">
                  {quickClientPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="quick"
                      onClick={() => {
                        setClientChatInput(prompt);
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="compose-row">
                  <input
                    value={clientChatInput}
                    onChange={(event) => setClientChatInput(event.target.value)}
                    placeholder={selectedOfferId ? 'Type your message...' : 'Select an offer first'}
                    disabled={!selectedOfferId}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void sendClientMessage();
                      }
                    }}
                  />
                  <button type="button" onClick={() => void sendClientMessage()} disabled={!selectedOfferId}>
                    Send
                  </button>
                </div>
              </>
            )}
          </article>
        </section>
      )}

      {panel === 'admin' && !adminLoggedIn && (
        <section className="admin-login-wrap">
          <article className="admin-login-card">
            <h2>Admin Login</h2>
            <p>Enter secure admin key to manage offers and messenger threads.</p>
            <input
              type="password"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              placeholder="ADMIN_DASHBOARD_KEY"
            />
            <div className="btn-row">
              <button type="button" onClick={() => void loginAdmin()} disabled={busy}>
                Sign In
              </button>
              <button type="button" className="ghost" onClick={() => switchPanel('client')}>
                Back
              </button>
            </div>
          </article>
        </section>
      )}

      {panel === 'admin' && adminLoggedIn && (
        <section className="admin-layout">
          <article className="admin-offers">
            <div className="section-head split">
              <div>
                <h2>{editingOfferId ? 'Update Offer' : 'Create Offer'}</h2>
                <p>Offer management for vacation, flights, and hotels.</p>
              </div>
              <button type="button" className="ghost" onClick={logoutAdmin}>
                Logout
              </button>
            </div>

            <div className="admin-form">
              <input
                placeholder="Offer title"
                value={offerForm.title}
                onChange={(event) => setOfferForm({ ...offerForm, title: event.target.value })}
              />
              <input
                placeholder="State"
                value={offerForm.state}
                onChange={(event) => setOfferForm({ ...offerForm, state: event.target.value })}
              />
              <input
                placeholder="Resort / Hotel name"
                value={offerForm.resortName}
                onChange={(event) => setOfferForm({ ...offerForm, resortName: event.target.value })}
              />
              <input
                placeholder="Image URL"
                value={offerForm.imageUrl}
                onChange={(event) => setOfferForm({ ...offerForm, imageUrl: event.target.value })}
              />
              <textarea
                placeholder="Offer description"
                value={offerForm.description}
                onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })}
              />
              <textarea
                placeholder="Highlights (e.g. Spa, Ocean view, Airport transfer)"
                value={offerForm.highlights}
                onChange={(event) => setOfferForm({ ...offerForm, highlights: event.target.value })}
              />
              <div className="admin-inline">
                <input
                  type="number"
                  min={1}
                  placeholder="Duration days"
                  value={offerForm.durationDays}
                  onChange={(event) =>
                    setOfferForm({
                      ...offerForm,
                      durationDays: Number(event.target.value)
                    })
                  }
                />
                <input
                  type="number"
                  min={1}
                  placeholder="Price"
                  value={offerForm.price}
                  onChange={(event) =>
                    setOfferForm({
                      ...offerForm,
                      price: Number(event.target.value)
                    })
                  }
                />
              </div>
              <div className="btn-row">
                <button type="button" onClick={() => void saveOffer()} disabled={busy}>
                  {editingOfferId ? 'Update' : 'Create'}
                </button>
                {editingOfferId && (
                  <button type="button" className="ghost" onClick={resetOfferForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <h3>Inventory</h3>
            <div className="offer-grid compact">
              {offers.map((offer) => (
                <article className="offer-card compact" key={offer.id}>
                  <img
                    className="offer-image compact"
                    src={offer.imageUrl || fallbackOfferImage}
                    alt={`${offer.resortName} thumbnail`}
                    loading="lazy"
                  />
                  <div className="offer-top">
                    <h4>{offer.title}</h4>
                    <span>{offer.state}</span>
                  </div>
                  <p className="offer-subtitle">{offer.resortName}</p>
                  <div className="btn-row">
                    <button type="button" onClick={() => startEdit(offer)}>
                      Edit
                    </button>
                    <button type="button" className="danger" onClick={() => void deleteOffer(offer.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="admin-messenger">
            <div className="thread-column">
              <h3>Messages</h3>
              <div className="thread-list">
                {adminThreads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={thread.id === activeAdminThreadId ? 'thread active' : 'thread'}
                    onClick={() => setActiveAdminThreadId(thread.id)}
                  >
                    <div>
                      <strong>{thread.clientName}</strong>
                      <span>{thread.offerTitle}</span>
                    </div>
                    {adminUnreadByThread[thread.id] > 0 && (
                      <span className="badge">{adminUnreadByThread[thread.id]}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="conversation-column">
              <div className="conversation-head">
                <strong>{activeAdminThread?.clientName ?? 'Select chat'}</strong>
                <span>{activeAdminThread?.offerTitle ?? ''}</span>
              </div>
              <div className="messages">
                {(activeAdminThread?.messages ?? []).map((message) => (
                  <div
                    key={message.id}
                    className={message.sender === 'admin' ? 'message admin' : 'message client'}
                  >
                    <p>{message.text}</p>
                    <small>
                      {message.sender} • {new Date(message.createdAt).toLocaleTimeString()}
                    </small>
                  </div>
                ))}
              </div>
              <div className="compose-row">
                <input
                  value={adminReply}
                  onChange={(event) => setAdminReply(event.target.value)}
                  placeholder="Reply to selected chat"
                  disabled={!activeAdminThread}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void sendAdminReply();
                    }
                  }}
                />
                <button type="button" onClick={() => void sendAdminReply()} disabled={!activeAdminThread}>
                  Send
                </button>
              </div>
            </div>
          </article>
        </section>
      )}

      <footer className="site-footer" id="contact">
        <div className="footer-grid">
          <div>
            <h4>Orchidea</h4>
            <p>Premium vacations, flights, and hotel coordination with direct advisor support.</p>
          </div>
          <div>
            <h5>Contact</h5>
            <p>Email: contact@orchidea-travel.com</p>
            <p>Phone: +1 (786) 555-0138</p>
          </div>
          <div>
            <h5>Office</h5>
            <p>420 Ocean Drive, Miami, FL</p>
            <p>Mon - Sat: 09:00 - 19:00</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default App;
