import { useEffect, useMemo, useState } from 'react';
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
  const [selectedOfferId, setSelectedOfferId] = useState<string>('');

  const [clientId] = useState<string>(() => getClientId());
  const [clientName, setClientName] = useState<string>(() => getClientName());
  const [clientChatInput, setClientChatInput] = useState('');
  const [clientThread, setClientThread] = useState<ChatThread | null>(null);

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
    if (stateFilter === 'All States') {
      return offers;
    }

    return offers.filter((offer) => offer.state === stateFilter);
  }, [offers, stateFilter]);

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
    const timer = window.setInterval(() => void poll(), 2000);
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

  const sendClientMessage = async () => {
    if (!selectedOfferId || !clientChatInput.trim()) {
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
          text: clientChatInput
        })
      });
      setClientThread(thread);
      setClientChatInput('');
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

  return (
    <main className="site-shell">
      <header className="hero-wrap">
        <nav className="top-nav">
          <p className="brand-mark">Atlas Agency</p>
          <div className="nav-actions">
            <button
              type="button"
              className={panel === 'client' ? 'pill active' : 'pill'}
              onClick={() => switchPanel('client')}
            >
              Explore Trips
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

        <div className="hero-content">
          <div>
            <p className="hero-eyebrow">Boutique Travel Operations</p>
            <h1>{agency?.name ?? 'Atlas Escape Agency'}</h1>
            <p className="hero-tagline">{agency?.tagline}</p>
            <p className="hero-about">{agency?.about}</p>
          </div>
          <aside className="hero-card">
            <h3>Trusted By Travelers</h3>
            <ul>
              <li>Personal itinerary guidance in every offer</li>
              <li>Live chat with agency staff per vacation card</li>
              <li>Transparent pricing with state-based filters</li>
            </ul>
          </aside>
        </div>
      </header>

      {error && <p className="error-banner">{error}</p>}

      {panel === 'client' && (
        <section className="layout-grid">
          <article className="glass-panel">
            <div className="section-head">
              <h2>{agency?.heroCta ?? 'Find your next state getaway'}</h2>
              <p>Filter, compare, and chat with the agency before choosing your package.</p>
            </div>

            <div className="field-grid">
              <div>
                <label htmlFor="clientName">Your name</label>
                <input
                  id="clientName"
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                  placeholder="Type your name"
                />
              </div>
              <div>
                <label htmlFor="stateFilter">State filter</label>
                <select
                  id="stateFilter"
                  value={stateFilter}
                  onChange={(event) => setStateFilter(event.target.value)}
                >
                  {states.map((stateName) => (
                    <option key={stateName} value={stateName}>
                      {stateName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="offer-grid">
              {filteredOffers.map((offer) => (
                <article className="offer-tile" key={offer.id}>
                  <h3>{offer.title}</h3>
                  <p>{offer.description}</p>
                  <div className="chips">
                    <span>{offer.state}</span>
                    <span>{offer.durationDays} days</span>
                    <span>${offer.price}</span>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => setSelectedOfferId(offer.id)}>
                      Chat For This Offer
                    </button>
                    <button type="button" className="ghost" onClick={() => startEdit(offer)}>
                      Open In Admin
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="glass-panel chat-panel">
            <div className="section-head">
              <h2>Live Chat</h2>
              <p>
                {selectedOffer
                  ? `Conversation about ${selectedOffer.title}`
                  : 'Select an offer card to start chatting.'}
              </p>
            </div>
            <div className="chat-log">
              {(clientThread?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  className={message.sender === 'admin' ? 'bubble admin' : 'bubble client'}
                >
                  <p>{message.text}</p>
                  <small>
                    {message.sender} • {new Date(message.createdAt).toLocaleTimeString()}
                  </small>
                </div>
              ))}
            </div>
            <div className="chat-compose">
              <input
                value={clientChatInput}
                onChange={(event) => setClientChatInput(event.target.value)}
                placeholder="Write a message to the agency"
                disabled={!selectedOfferId}
              />
              <button type="button" onClick={() => void sendClientMessage()} disabled={!selectedOfferId}>
                Send
              </button>
            </div>
          </article>
        </section>
      )}

      {panel === 'admin' && !adminLoggedIn && (
        <section className="admin-login-wrap">
          <article className="glass-panel admin-login-card">
            <h2>Admin Login</h2>
            <p>Access is restricted. Enter your admin key to manage offers and client chats.</p>
            <input
              type="password"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              placeholder="Enter ADMIN_DASHBOARD_KEY"
            />
            <div className="row-actions">
              <button type="button" onClick={() => void loginAdmin()} disabled={busy}>
                Sign In
              </button>
              <button type="button" className="ghost" onClick={() => switchPanel('client')}>
                Back to Landing
              </button>
            </div>
          </article>
        </section>
      )}

      {panel === 'admin' && adminLoggedIn && (
        <section className="layout-grid admin-layout">
          <article className="glass-panel">
            <div className="section-head split">
              <div>
                <h2>{editingOfferId ? 'Update Offer' : 'Create Offer'}</h2>
                <p>Keep your catalog fresh and aligned with client demand.</p>
              </div>
              <button type="button" className="ghost" onClick={logoutAdmin}>
                Log out
              </button>
            </div>

            <div className="form-grid">
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
              <div className="field-grid two">
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
              <div className="row-actions">
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

            <h3>Offer Inventory</h3>
            <div className="offer-grid compact">
              {offers.map((offer) => (
                <article className="offer-tile" key={offer.id}>
                  <h4>{offer.title}</h4>
                  <p>{offer.state}</p>
                  <div className="row-actions">
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

          <article className="glass-panel chat-panel">
            <div className="section-head">
              <h2>Client Threads</h2>
              <p>Each client+offer creates a dedicated conversation channel.</p>
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

            <div className="chat-log">
              {(activeAdminThread?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  className={message.sender === 'admin' ? 'bubble admin' : 'bubble client'}
                >
                  <p>{message.text}</p>
                  <small>
                    {message.sender} • {new Date(message.createdAt).toLocaleTimeString()}
                  </small>
                </div>
              ))}
            </div>

            <div className="chat-compose">
              <input
                value={adminReply}
                onChange={(event) => setAdminReply(event.target.value)}
                placeholder="Reply to selected client"
                disabled={!activeAdminThread}
              />
              <button
                type="button"
                onClick={() => void sendAdminReply()}
                disabled={!activeAdminThread}
              >
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
