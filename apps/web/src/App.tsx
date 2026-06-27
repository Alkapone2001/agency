import { useEffect, useMemo, useState } from 'react';
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
  durationDays: Number(form.durationDays),
  price: Number(form.price)
});

const initialOfferForm: OfferInput = {
  title: '',
  description: '',
  state: '',
  durationDays: 4,
  price: 400
};

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
        offer.state.toLowerCase().includes(query)
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
      durationDays: offer.durationDays,
      price: offer.price
    });
    switchPanel('admin');
  };

  const sendClientMessage = async (content?: string) => {
    const text = String(content ?? clientChatInput).trim();
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
    <main className="agency-shell">
      <header className="topbar">
        <nav className="navbar">
          <div className="brand-area">
            <span className="brand-dot" />
            <strong>Atlas Agency</strong>
          </div>
          <div className="menu-links">
            <a href="#home">Home</a>
            <a href="#services">Services</a>
            <a href="#offers">Offers</a>
            <a href="#contact">Contact</a>
          </div>
          <div className="menu-actions">
            <button
              type="button"
              className={panel === 'client' ? 'pill active' : 'pill'}
              onClick={() => switchPanel('client')}
            >
              Client
            </button>
            <button
              type="button"
              className={panel === 'admin' ? 'pill active' : 'pill'}
              onClick={() => switchPanel('admin')}
            >
              Admin
            </button>
          </div>
        </nav>
      </header>

      <section className="hero" id="home">
        <div>
          <p className="eyebrow">Travel Management Studio</p>
          <h1>{agency?.name ?? 'Atlas Escape Agency'}</h1>
          <p className="tagline">{agency?.tagline}</p>
          <p className="about">{agency?.about}</p>
        </div>
        <div className="hero-card" id="contact">
          <h3>Need direct help?</h3>
          <p>Our advisors respond quickly with package details, flight options, hotel upgrades, and quote adjustments.</p>
          <button type="button" onClick={() => setClientChatOpen(true)}>
            Start Conversation
          </button>
        </div>
      </section>

      <section className="services" id="services">
        <article>
          <h3>Vacation Packages</h3>
          <p>Curated destination offers with flexible durations and transparent pricing.</p>
        </article>
        <article>
          <h3>Flight Tickets</h3>
          <p>Support for smart route options, baggage preferences, and schedule matching.</p>
        </article>
        <article>
          <h3>Hotel Bookings</h3>
          <p>Tailored accommodation recommendations based on comfort and budget needs.</p>
        </article>
      </section>

      {error && <p className="error-banner">{error}</p>}

      {panel === 'client' && (
        <section className="client-area" id="offers">
          <article className="offers-panel">
            <div className="panel-head">
              <h2>Find Your Best Offer</h2>
              <p>Filter by destination state and search by package keywords.</p>
            </div>
            <div className="filters">
              <label>
                Your name
                <input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Your name"
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
                  placeholder="Beach, mountain, city"
                />
              </label>
            </div>

            <div className="offer-grid">
              {filteredOffers.map((offer) => (
                <article
                  key={offer.id}
                  className={offer.id === selectedOfferId ? 'offer-card selected' : 'offer-card'}
                >
                  <div className="offer-top">
                    <h3>{offer.title}</h3>
                    <span>${offer.price}</span>
                  </div>
                  <p>{offer.description}</p>
                  <div className="chips">
                    <span>{offer.state}</span>
                    <span>{offer.durationDays} days</span>
                  </div>
                  <div className="offer-actions">
                    <button type="button" onClick={() => setSelectedOfferId(offer.id)}>
                      Open Messenger
                    </button>
                    <button type="button" className="ghost" onClick={() => startEdit(offer)}>
                      Manage in Admin
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="messenger-launcher">
            <button
              type="button"
              className="messenger-toggle"
              onClick={() => setClientChatOpen((value) => !value)}
            >
              {clientChatOpen ? 'Hide Messenger' : 'Open Messenger'}
              {clientUnreadCount > 0 && <span className="badge">{clientUnreadCount}</span>}
            </button>

            {clientChatOpen && (
              <div className="messenger-window">
                <div className="messenger-head">
                  <div>
                    <strong>Agency Messenger</strong>
                    <p>
                      {selectedOffer
                        ? `Offer: ${selectedOffer.title}`
                        : 'Select an offer card to begin'}
                    </p>
                  </div>
                </div>
                <div className="messages">
                  {(clientThread?.messages ?? []).map((message) => (
                    <div
                      key={message.id}
                      className={message.sender === 'admin' ? 'message admin' : 'message client'}
                    >
                      <p>{message.text}</p>
                      <small>
                        {message.sender === 'admin' ? 'Agency' : clientName || 'You'} •{' '}
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="compose-row">
                  <input
                    value={clientChatInput}
                    onChange={(event) => setClientChatInput(event.target.value)}
                    placeholder={selectedOfferId ? 'Type a message...' : 'Select an offer first'}
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
              </div>
            )}
          </aside>
        </section>
      )}

      {panel === 'admin' && !adminLoggedIn && (
        <section className="admin-login-wrap">
          <article className="admin-login-card">
            <h2>Admin Login</h2>
            <p>Enter your key to manage offers and client messages.</p>
            <input
              type="password"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              placeholder="ADMIN_DASHBOARD_KEY"
            />
            <div className="offer-actions">
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
        <section className="admin-area">
          <article className="admin-offers">
            <div className="panel-head split">
              <div>
                <h2>{editingOfferId ? 'Update Offer' : 'Create Offer'}</h2>
                <p>Manage offers for vacation packages, flights, and hotels.</p>
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
              <textarea
                placeholder="Offer description"
                value={offerForm.description}
                onChange={(event) => setOfferForm({ ...offerForm, description: event.target.value })}
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
              <div className="offer-actions">
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

            <h3>Offer Inventory</h3>
            <div className="offer-grid compact">
              {offers.map((offer) => (
                <article className="offer-card compact" key={offer.id}>
                  <div className="offer-top">
                    <h4>{offer.title}</h4>
                    <span>{offer.state}</span>
                  </div>
                  <div className="offer-actions">
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
              <h3>Chats</h3>
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
                <strong>{activeAdminThread?.clientName ?? 'Select a conversation'}</strong>
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
    </main>
  );
}

export default App;
