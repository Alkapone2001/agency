import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgencyInfo, ChatThread, Offer, OfferInput } from '@agency/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? '';

type Panel = 'client' | 'admin';

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

const quickPrompts = [
  'Is this offer family-friendly?',
  'Can I customize travel dates?',
  'What is included in the package?',
  'Do you offer airport transfer?'
];

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
  const [sendingClientMessage, setSendingClientMessage] = useState(false);

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chatBottomRef = useRef<HTMLDivElement | null>(null);

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
  }, [offers, searchQuery, stateFilter]);

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
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [clientThread]);

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

  const sendClientMessage = async (prefill?: string) => {
    const content = (prefill ?? clientChatInput).trim();
    if (!selectedOfferId || !content) {
      return;
    }

    const safeName = clientName.trim() || 'Guest Traveler';
    window.localStorage.setItem('agency-client-name', safeName);
    setClientName(safeName);

    try {
      setError(null);
      setSendingClientMessage(true);
      const thread = await requestJson<ChatThread>(`/api/offers/${selectedOfferId}/chats`, {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          clientName: safeName,
          sender: 'client',
          text: content
        })
      });
      setClientThread(thread);
      setClientChatInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSendingClientMessage(false);
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

  return (
    <main className="professional-shell">
      <header className="professional-nav-wrap">
        <nav className="professional-nav">
          <a className="brand" href="#home">
            <span className="brand-dot" />
            Atlas Agency
          </a>
          {panel === 'client' && (
            <div className="nav-links">
              <a href="#offers">Offers</a>
              <a href="#chat">Live Chat</a>
              <a href="#trust">Why Us</a>
            </div>
          )}
          <div className="nav-actions">
            <button
              type="button"
              className={panel === 'client' ? 'nav-button active' : 'nav-button'}
              onClick={() => switchPanel('client')}
            >
              Client
            </button>
            <button
              type="button"
              className={panel === 'admin' ? 'nav-button active' : 'nav-button'}
              onClick={() => switchPanel('admin')}
            >
              Admin
            </button>
          </div>
        </nav>
      </header>

      <section className="premium-hero" id="home">
        <div className="hero-main">
          <p className="kicker">Premium Travel Curation</p>
          <h1>{agency?.name ?? 'Atlas Escape Agency'}</h1>
          <p className="lead">{agency?.tagline}</p>
          <p className="sublead">{agency?.about}</p>
        </div>
        <aside className="hero-metrics" id="trust">
          <h3>Client Confidence</h3>
          <div className="metric-list">
            <article>
              <strong>24/7</strong>
              <span>Advisor response rhythm</span>
            </article>
            <article>
              <strong>{offers.length}</strong>
              <span>Curated live offers</span>
            </article>
            <article>
              <strong>1:1</strong>
              <span>Dedicated chat per package</span>
            </article>
          </div>
        </aside>
      </section>

      {error && <p className="error-banner">{error}</p>}

      {panel === 'client' && (
        <section className="client-grid" id="offers">
          <article className="panel panel-offers">
            <div className="panel-head">
              <h2>Explore Smart Offers</h2>
              <p>Search by destination, compare package details, and start your conversation instantly.</p>
            </div>

            <div className="filters">
              <label>
                Your name
                <input
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Your full name"
                />
              </label>
              <label>
                State
                <select
                  value={stateFilter}
                  onChange={(event) => setStateFilter(event.target.value)}
                >
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
                  placeholder="Beach, mountain, city..."
                />
              </label>
            </div>

            <div className="offer-list">
              {filteredOffers.map((offer) => (
                <article
                  className={offer.id === selectedOfferId ? 'offer-card selected' : 'offer-card'}
                  key={offer.id}
                >
                  <header>
                    <h3>{offer.title}</h3>
                    <span className="price">${offer.price}</span>
                  </header>
                  <p>{offer.description}</p>
                  <div className="meta">
                    <span>{offer.state}</span>
                    <span>{offer.durationDays} days</span>
                  </div>
                  <div className="cta-row">
                    <button type="button" onClick={() => setSelectedOfferId(offer.id)}>
                      Open Chat
                    </button>
                    <button type="button" className="ghost" onClick={() => startEdit(offer)}>
                      Manage in Admin
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="panel panel-chat" id="chat">
            <div className="panel-head">
              <h2>Conversation Desk</h2>
              <p>
                {selectedOffer
                  ? `Discussing: ${selectedOffer.title}`
                  : 'Pick an offer to start a private conversation.'}
              </p>
            </div>

            <div className="quick-prompt-row">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="quick-chip"
                  onClick={() => void sendClientMessage(prompt)}
                  disabled={!selectedOfferId || sendingClientMessage}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="chat-timeline">
              {(clientThread?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  className={message.sender === 'admin' ? 'message admin' : 'message client'}
                >
                  <p>{message.text}</p>
                  <small>
                    {message.sender === 'admin' ? 'Agency' : clientName || 'Client'} •{' '}
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </small>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            <div className="composer">
              <input
                value={clientChatInput}
                onChange={(event) => setClientChatInput(event.target.value)}
                placeholder={selectedOfferId ? 'Ask anything about this package...' : 'Select an offer first'}
                disabled={!selectedOfferId || sendingClientMessage}
              />
              <button
                type="button"
                onClick={() => void sendClientMessage()}
                disabled={!selectedOfferId || sendingClientMessage}
              >
                {sendingClientMessage ? 'Sending...' : 'Send'}
              </button>
            </div>
          </article>
        </section>
      )}

      {panel === 'admin' && !adminLoggedIn && (
        <section className="admin-login-wrap">
          <article className="panel admin-login-card">
            <h2>Admin Login</h2>
            <p>Enter the admin key to manage offers and client conversations.</p>
            <input
              type="password"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              placeholder="Enter ADMIN_DASHBOARD_KEY"
            />
            <div className="cta-row">
              <button type="button" onClick={() => void loginAdmin()} disabled={busy}>
                Sign In
              </button>
              <button type="button" className="ghost" onClick={() => switchPanel('client')}>
                Back to Client
              </button>
            </div>
          </article>
        </section>
      )}

      {panel === 'admin' && adminLoggedIn && (
        <section className="admin-grid">
          <article className="panel">
            <div className="panel-head split">
              <div>
                <h2>{editingOfferId ? 'Update Offer' : 'Create Offer'}</h2>
                <p>Maintain inventory quality and improve offer conversion.</p>
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
              <div className="admin-split">
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
              <div className="cta-row">
                <button type="button" onClick={() => void saveOffer()} disabled={busy}>
                  {editingOfferId ? 'Update Offer' : 'Create Offer'}
                </button>
                {editingOfferId && (
                  <button type="button" className="ghost" onClick={resetOfferForm}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <h3 className="inventory-title">Offer Inventory</h3>
            <div className="offer-list compact">
              {offers.map((offer) => (
                <article className="offer-card compact" key={offer.id}>
                  <header>
                    <h4>{offer.title}</h4>
                    <span>{offer.state}</span>
                  </header>
                  <div className="cta-row">
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

          <article className="panel panel-chat">
            <div className="panel-head">
              <h2>Client Threads</h2>
              <p>Every client conversation remains grouped by selected offer.</p>
            </div>

            <div className="thread-list">
              {adminThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={thread.id === activeAdminThreadId ? 'thread active' : 'thread'}
                  onClick={() => setActiveAdminThreadId(thread.id)}
                >
                  <strong>{thread.clientName}</strong>
                  <span>{thread.offerTitle}</span>
                </button>
              ))}
            </div>

            <div className="chat-timeline">
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

            <div className="composer">
              <input
                value={adminReply}
                onChange={(event) => setAdminReply(event.target.value)}
                placeholder="Reply to selected client"
                disabled={!activeAdminThread}
              />
              <button type="button" onClick={() => void sendAdminReply()} disabled={!activeAdminThread}>
                Reply
              </button>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}

export default App;
