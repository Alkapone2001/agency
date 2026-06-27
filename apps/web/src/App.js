import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
const apiUrl = import.meta.env.VITE_API_URL ?? '';
const createClientId = () => `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
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
const toOfferInput = (form) => ({
    title: form.title.trim(),
    description: form.description.trim(),
    state: form.state.trim(),
    resortName: form.resortName.trim(),
    highlights: form.highlights.trim(),
    imageUrl: form.imageUrl.trim(),
    durationDays: Number(form.durationDays),
    price: Number(form.price)
});
const initialOfferForm = {
    title: '',
    description: '',
    state: '',
    resortName: '',
    highlights: '',
    imageUrl: '',
    durationDays: 4,
    price: 400
};
const fallbackOfferImage = 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80';
const quickClientPrompts = [
    'Can you share full package details?',
    'Is airport transfer included?',
    'Can you suggest family-friendly options?',
    'What is the cancellation policy?'
];
const initialPanel = window.location.pathname.startsWith('/admin') ? 'admin' : 'client';
const readSeenMap = (key) => {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
};
const saveSeenMap = (key, value) => {
    window.localStorage.setItem(key, JSON.stringify(value));
};
async function requestJson(path, init) {
    const response = await fetch(`${apiUrl}${path}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(init?.headers ?? {})
        },
        ...init
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null));
        throw new Error(payload?.message ?? `Request failed: ${response.status}`);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
function App() {
    const [panel, setPanel] = useState(initialPanel);
    const [agency, setAgency] = useState(null);
    const [offers, setOffers] = useState([]);
    const [stateFilter, setStateFilter] = useState('All States');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedOfferId, setSelectedOfferId] = useState('');
    const [clientId] = useState(() => getClientId());
    const [clientName, setClientName] = useState(() => getClientName());
    const [clientChatInput, setClientChatInput] = useState('');
    const [clientThread, setClientThread] = useState(null);
    const [clientChatOpen, setClientChatOpen] = useState(false);
    const [clientSeenByThread, setClientSeenByThread] = useState(() => readSeenMap('agency-client-seen-map'));
    const [adminKeyInput, setAdminKeyInput] = useState(() => window.localStorage.getItem('agency-admin-key') ?? '');
    const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('agency-admin-key') ?? '');
    const [adminLoggedIn, setAdminLoggedIn] = useState(false);
    const [offerForm, setOfferForm] = useState(initialOfferForm);
    const [editingOfferId, setEditingOfferId] = useState(null);
    const [adminThreads, setAdminThreads] = useState([]);
    const [activeAdminThreadId, setActiveAdminThreadId] = useState('');
    const [adminReply, setAdminReply] = useState('');
    const [adminSeenByThread, setAdminSeenByThread] = useState(() => readSeenMap('agency-admin-seen-map'));
    const clientMessagesEndRef = useRef(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const selectedOffer = useMemo(() => offers.find((offer) => offer.id === selectedOfferId) ?? null, [offers, selectedOfferId]);
    const activeAdminThread = useMemo(() => adminThreads.find((thread) => thread.id === activeAdminThreadId) ?? null, [adminThreads, activeAdminThreadId]);
    const states = useMemo(() => {
        const values = Array.from(new Set(offers.map((offer) => offer.state))).sort();
        return ['All States', ...values];
    }, [offers]);
    const filteredOffers = useMemo(() => {
        const byState = stateFilter === 'All States' ? offers : offers.filter((offer) => offer.state === stateFilter);
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            return byState;
        }
        return byState.filter((offer) => offer.title.toLowerCase().includes(query) ||
            offer.description.toLowerCase().includes(query) ||
            offer.state.toLowerCase().includes(query) ||
            offer.resortName.toLowerCase().includes(query) ||
            offer.highlights.toLowerCase().includes(query));
    }, [offers, stateFilter, searchQuery]);
    const adminRequest = (path, init) => requestJson(path, {
        ...init,
        headers: {
            ...(init?.headers ?? {}),
            'x-admin-key': adminKey
        }
    });
    const refreshOffers = async () => {
        const loaded = await requestJson('/api/offers');
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
        const loaded = await adminRequest('/api/admin/chats');
        setAdminThreads(loaded);
        if (!activeAdminThreadId && loaded.length > 0) {
            setActiveAdminThreadId(loaded[0].id);
        }
    };
    const switchPanel = (nextPanel) => {
        setPanel(nextPanel);
        const targetPath = nextPanel === 'admin' ? '/admin' : '/';
        if (window.location.pathname !== targetPath) {
            window.history.pushState({}, '', targetPath);
        }
    };
    const loadBase = async () => {
        setError(null);
        const [agencyInfo] = await Promise.all([requestJson('/api/agency'), refreshOffers()]);
        setAgency(agencyInfo);
    };
    const validateAdminSession = async (candidate) => {
        await requestJson('/api/admin/session', {
            headers: { 'x-admin-key': candidate }
        });
    };
    useEffect(() => {
        const load = async () => {
            try {
                await loadBase();
            }
            catch (err) {
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
            }
            catch {
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
                const thread = await requestJson(`/api/offers/${selectedOfferId}/chats/${clientId}`);
                setClientThread(thread);
            }
            catch {
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
        }
        catch (err) {
            setAdminLoggedIn(false);
            setError(err instanceof Error ? err.message : 'Admin login failed');
        }
        finally {
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
                await adminRequest(`/api/admin/offers/${editingOfferId}`, {
                    method: 'PUT',
                    body: payload
                });
            }
            else {
                await adminRequest('/api/admin/offers', {
                    method: 'POST',
                    body: payload
                });
            }
            await refreshOffers();
            resetOfferForm();
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save offer');
        }
        finally {
            setBusy(false);
        }
    };
    const deleteOffer = async (offerId) => {
        try {
            setBusy(true);
            setError(null);
            await adminRequest(`/api/admin/offers/${offerId}`, { method: 'DELETE' });
            await Promise.all([refreshOffers(), refreshAdminThreads()]);
            if (selectedOfferId === offerId) {
                setSelectedOfferId('');
            }
            if (editingOfferId === offerId) {
                resetOfferForm();
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete offer');
        }
        finally {
            setBusy(false);
        }
    };
    const startEdit = (offer) => {
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
            const thread = await requestJson(`/api/offers/${selectedOfferId}/chats`, {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send message');
        }
    };
    const sendAdminReply = async () => {
        if (!activeAdminThread || !adminReply.trim()) {
            return;
        }
        try {
            const thread = await adminRequest(`/api/offers/${activeAdminThread.offerId}/chats`, {
                method: 'POST',
                body: JSON.stringify({
                    clientId: activeAdminThread.clientId,
                    clientName: activeAdminThread.clientName,
                    sender: 'admin',
                    text: adminReply
                })
            });
            setAdminReply('');
            setAdminThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
            if (clientThread?.id === thread.id) {
                setClientThread(thread);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send admin reply');
        }
    };
    const clientUnreadCount = useMemo(() => {
        if (!clientThread) {
            return 0;
        }
        const seenAt = clientSeenByThread[clientThread.id] ?? '';
        return clientThread.messages.filter((message) => message.sender === 'admin' && message.createdAt > seenAt).length;
    }, [clientSeenByThread, clientThread]);
    const adminUnreadByThread = useMemo(() => {
        const map = {};
        for (const thread of adminThreads) {
            const seenAt = adminSeenByThread[thread.id] ?? '';
            map[thread.id] = thread.messages.filter((message) => message.sender === 'client' && message.createdAt > seenAt).length;
        }
        return map;
    }, [adminSeenByThread, adminThreads]);
    return (_jsxs("main", { className: "full-shell", children: [_jsx("header", { className: "main-nav-wrap", children: _jsxs("div", { className: "main-nav", children: [_jsxs("div", { className: "logo-box", children: [_jsx("span", { className: "logo-dot" }), _jsx("strong", { children: "Orchidea" })] }), _jsxs("div", { className: "main-links", children: [_jsx("a", { href: "#home", children: "Home" }), _jsx("a", { href: "#solutions", children: "Solutions" }), _jsx("a", { href: "#offers", children: "Offers" }), _jsx("a", { href: "#messenger", children: "Messenger" })] }), _jsxs("div", { className: "main-actions", children: [_jsx("button", { type: "button", className: panel === 'client' ? 'nav-pill active' : 'nav-pill', onClick: () => switchPanel('client'), children: "Client" }), _jsx("button", { type: "button", className: panel === 'admin' ? 'nav-pill active' : 'nav-pill', onClick: () => switchPanel('admin'), children: "Admin" })] })] }) }), _jsxs("section", { className: "hero-grid", id: "home", children: [_jsxs("div", { className: "hero-left", children: [_jsx("p", { className: "hero-kicker", children: "Modern Travel Booking Operations" }), _jsx("h1", { children: agency?.name ?? 'Orchidea' }), _jsx("p", { className: "hero-tag", children: agency?.tagline }), _jsx("p", { className: "hero-text", children: agency?.about }), _jsxs("div", { className: "hero-cta-row", children: [_jsx("button", { type: "button", onClick: () => document.getElementById('offers')?.scrollIntoView(), children: "Explore Offers" }), _jsx("button", { type: "button", className: "ghost", onClick: () => setClientChatOpen(true), children: "Contact Advisor" })] })] }), _jsxs("div", { className: "hero-right", children: [_jsxs("article", { children: [_jsx("h4", { children: "Vacation Offers" }), _jsx("p", { children: "All-inclusive and custom curated experiences by destination and budget." })] }), _jsxs("article", { children: [_jsx("h4", { children: "Flight Tickets" }), _jsx("p", { children: "Flexible flight support from route planning to schedule optimization." })] }), _jsxs("article", { children: [_jsx("h4", { children: "Hotel Bookings" }), _jsx("p", { children: "Premium to smart-stay options tailored to your trip style." })] })] })] }), _jsxs("section", { className: "info-grid", id: "solutions", children: [_jsxs("article", { children: [_jsx("h3", { children: "Dedicated Agency Experts" }), _jsx("p", { children: "Every request is handled by a real advisor with direct context of your travel intent." })] }), _jsxs("article", { children: [_jsx("h3", { children: "Fast Multi-service Quotes" }), _jsx("p", { children: "Packages, flights, and hotels coordinated under one conversation flow." })] }), _jsxs("article", { children: [_jsx("h3", { children: "Messenger-grade Support" }), _jsx("p", { children: "Threaded chat with read/unread awareness for better response management." })] })] }), error && _jsx("p", { className: "error-banner", children: error }), panel === 'client' && (_jsxs("section", { className: "client-layout", id: "offers", children: [_jsxs("article", { className: "catalog-panel", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Find Offers Faster" }), _jsx("p", { children: "Use smart filters and search to get the right package before chatting." })] }), _jsxs("div", { className: "filters", children: [_jsxs("label", { children: ["Name", _jsx("input", { value: clientName, onChange: (event) => setClientName(event.target.value), placeholder: "Your full name" })] }), _jsxs("label", { children: ["State", _jsx("select", { value: stateFilter, onChange: (event) => setStateFilter(event.target.value), children: states.map((stateName) => (_jsx("option", { value: stateName, children: stateName }, stateName))) })] }), _jsxs("label", { children: ["Search", _jsx("input", { value: searchQuery, onChange: (event) => setSearchQuery(event.target.value), placeholder: "Beach, city, mountain" })] })] }), _jsx("div", { className: "offer-grid", children: filteredOffers.map((offer) => (_jsxs("article", { className: offer.id === selectedOfferId ? 'offer-card selected' : 'offer-card', role: "button", tabIndex: 0, onClick: () => {
                                        setSelectedOfferId(offer.id);
                                        setClientChatOpen(true);
                                    }, onKeyDown: (event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelectedOfferId(offer.id);
                                            setClientChatOpen(true);
                                        }
                                    }, children: [_jsx("img", { className: "offer-image", src: offer.imageUrl || fallbackOfferImage, alt: `${offer.resortName} in ${offer.state}`, loading: "lazy" }), _jsxs("div", { className: "offer-top", children: [_jsx("h3", { children: offer.title }), _jsxs("span", { children: ["$", offer.price] })] }), _jsx("p", { className: "offer-subtitle", children: offer.resortName }), _jsx("p", { children: offer.description }), _jsx("p", { className: "offer-highlights", children: offer.highlights }), _jsxs("div", { className: "chips", children: [_jsx("span", { children: offer.state }), _jsxs("span", { children: [offer.durationDays, " days"] })] }), _jsx("div", { className: "btn-row", children: _jsx("button", { type: "button", onClick: (event) => {
                                                    event.stopPropagation();
                                                    setSelectedOfferId(offer.id);
                                                    setClientChatOpen(true);
                                                }, children: "Chat This Offer" }) })] }, offer.id))) })] }), _jsxs("article", { className: "messenger-panel", id: "messenger", children: [_jsxs("div", { className: "messenger-header", children: [_jsxs("div", { children: [_jsx("strong", { children: "Agency Messenger" }), _jsx("p", { children: selectedOffer
                                                    ? `Now discussing: ${selectedOffer.title}`
                                                    : 'Select an offer to start chatting' })] }), _jsxs("button", { type: "button", className: "ghost", onClick: () => setClientChatOpen((value) => !value), children: [clientChatOpen ? 'Minimize' : 'Open', clientUnreadCount > 0 && _jsx("span", { className: "badge", children: clientUnreadCount })] })] }), selectedOffer && (_jsxs("div", { className: "active-offer-banner", children: [_jsx("span", { children: selectedOffer.title }), _jsxs("small", { children: [selectedOffer.state, " \u2022 ", selectedOffer.durationDays, " days \u2022 $", selectedOffer.price] })] })), clientChatOpen && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "messages", children: [!clientThread?.messages.length && (_jsx("div", { className: "chat-empty", children: "Choose an offer and send your first message. Our team replies here in real time." })), (clientThread?.messages ?? []).map((message) => (_jsxs("div", { className: message.sender === 'admin' ? 'message admin' : 'message client', children: [_jsx("p", { children: message.text }), _jsxs("small", { children: [message.sender === 'admin' ? 'Advisor' : clientName || 'You', " \u2022", ' ', new Date(message.createdAt).toLocaleTimeString()] })] }, message.id))), _jsx("div", { ref: clientMessagesEndRef })] }), _jsx("div", { className: "quick-row", children: quickClientPrompts.map((prompt) => (_jsx("button", { type: "button", className: "quick", onClick: () => {
                                                setClientChatInput(prompt);
                                            }, children: prompt }, prompt))) }), _jsxs("div", { className: "compose-row", children: [_jsx("input", { value: clientChatInput, onChange: (event) => setClientChatInput(event.target.value), placeholder: selectedOfferId ? 'Type your message...' : 'Select an offer first', disabled: !selectedOfferId, onKeyDown: (event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        void sendClientMessage();
                                                    }
                                                } }), _jsx("button", { type: "button", onClick: () => void sendClientMessage(), disabled: !selectedOfferId, children: "Send" })] })] }))] })] })), panel === 'admin' && !adminLoggedIn && (_jsx("section", { className: "admin-login-wrap", children: _jsxs("article", { className: "admin-login-card", children: [_jsx("h2", { children: "Admin Login" }), _jsx("p", { children: "Enter secure admin key to manage offers and messenger threads." }), _jsx("input", { type: "password", value: adminKeyInput, onChange: (event) => setAdminKeyInput(event.target.value), placeholder: "ADMIN_DASHBOARD_KEY" }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", onClick: () => void loginAdmin(), disabled: busy, children: "Sign In" }), _jsx("button", { type: "button", className: "ghost", onClick: () => switchPanel('client'), children: "Back" })] })] }) })), panel === 'admin' && adminLoggedIn && (_jsxs("section", { className: "admin-layout", children: [_jsxs("article", { className: "admin-offers", children: [_jsxs("div", { className: "section-head split", children: [_jsxs("div", { children: [_jsx("h2", { children: editingOfferId ? 'Update Offer' : 'Create Offer' }), _jsx("p", { children: "Offer management for vacation, flights, and hotels." })] }), _jsx("button", { type: "button", className: "ghost", onClick: logoutAdmin, children: "Logout" })] }), _jsxs("div", { className: "admin-form", children: [_jsx("input", { placeholder: "Offer title", value: offerForm.title, onChange: (event) => setOfferForm({ ...offerForm, title: event.target.value }) }), _jsx("input", { placeholder: "State", value: offerForm.state, onChange: (event) => setOfferForm({ ...offerForm, state: event.target.value }) }), _jsx("input", { placeholder: "Resort / Hotel name", value: offerForm.resortName, onChange: (event) => setOfferForm({ ...offerForm, resortName: event.target.value }) }), _jsx("input", { placeholder: "Image URL", value: offerForm.imageUrl, onChange: (event) => setOfferForm({ ...offerForm, imageUrl: event.target.value }) }), _jsx("textarea", { placeholder: "Offer description", value: offerForm.description, onChange: (event) => setOfferForm({ ...offerForm, description: event.target.value }) }), _jsx("textarea", { placeholder: "Highlights (e.g. Spa, Ocean view, Airport transfer)", value: offerForm.highlights, onChange: (event) => setOfferForm({ ...offerForm, highlights: event.target.value }) }), _jsxs("div", { className: "admin-inline", children: [_jsx("input", { type: "number", min: 1, placeholder: "Duration days", value: offerForm.durationDays, onChange: (event) => setOfferForm({
                                                    ...offerForm,
                                                    durationDays: Number(event.target.value)
                                                }) }), _jsx("input", { type: "number", min: 1, placeholder: "Price", value: offerForm.price, onChange: (event) => setOfferForm({
                                                    ...offerForm,
                                                    price: Number(event.target.value)
                                                }) })] }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", onClick: () => void saveOffer(), disabled: busy, children: editingOfferId ? 'Update' : 'Create' }), editingOfferId && (_jsx("button", { type: "button", className: "ghost", onClick: resetOfferForm, children: "Cancel" }))] })] }), _jsx("h3", { children: "Inventory" }), _jsx("div", { className: "offer-grid compact", children: offers.map((offer) => (_jsxs("article", { className: "offer-card compact", children: [_jsx("img", { className: "offer-image compact", src: offer.imageUrl || fallbackOfferImage, alt: `${offer.resortName} thumbnail`, loading: "lazy" }), _jsxs("div", { className: "offer-top", children: [_jsx("h4", { children: offer.title }), _jsx("span", { children: offer.state })] }), _jsx("p", { className: "offer-subtitle", children: offer.resortName }), _jsxs("div", { className: "btn-row", children: [_jsx("button", { type: "button", onClick: () => startEdit(offer), children: "Edit" }), _jsx("button", { type: "button", className: "danger", onClick: () => void deleteOffer(offer.id), children: "Delete" })] })] }, offer.id))) })] }), _jsxs("article", { className: "admin-messenger", children: [_jsxs("div", { className: "thread-column", children: [_jsx("h3", { children: "Messages" }), _jsx("div", { className: "thread-list", children: adminThreads.map((thread) => (_jsxs("button", { type: "button", className: thread.id === activeAdminThreadId ? 'thread active' : 'thread', onClick: () => setActiveAdminThreadId(thread.id), children: [_jsxs("div", { children: [_jsx("strong", { children: thread.clientName }), _jsx("span", { children: thread.offerTitle })] }), adminUnreadByThread[thread.id] > 0 && (_jsx("span", { className: "badge", children: adminUnreadByThread[thread.id] }))] }, thread.id))) })] }), _jsxs("div", { className: "conversation-column", children: [_jsxs("div", { className: "conversation-head", children: [_jsx("strong", { children: activeAdminThread?.clientName ?? 'Select chat' }), _jsx("span", { children: activeAdminThread?.offerTitle ?? '' })] }), _jsx("div", { className: "messages", children: (activeAdminThread?.messages ?? []).map((message) => (_jsxs("div", { className: message.sender === 'admin' ? 'message admin' : 'message client', children: [_jsx("p", { children: message.text }), _jsxs("small", { children: [message.sender, " \u2022 ", new Date(message.createdAt).toLocaleTimeString()] })] }, message.id))) }), _jsxs("div", { className: "compose-row", children: [_jsx("input", { value: adminReply, onChange: (event) => setAdminReply(event.target.value), placeholder: "Reply to selected chat", disabled: !activeAdminThread, onKeyDown: (event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        void sendAdminReply();
                                                    }
                                                } }), _jsx("button", { type: "button", onClick: () => void sendAdminReply(), disabled: !activeAdminThread, children: "Send" })] })] })] })] })), _jsx("footer", { className: "site-footer", id: "contact", children: _jsxs("div", { className: "footer-grid", children: [_jsxs("div", { children: [_jsx("h4", { children: "Orchidea" }), _jsx("p", { children: "Premium vacations, flights, and hotel coordination with direct advisor support." })] }), _jsxs("div", { children: [_jsx("h5", { children: "Contact" }), _jsx("p", { children: "Email: contact@orchidea-travel.com" }), _jsx("p", { children: "Phone: +1 (786) 555-0138" })] }), _jsxs("div", { children: [_jsx("h5", { children: "Office" }), _jsx("p", { children: "420 Ocean Drive, Miami, FL" }), _jsx("p", { children: "Mon - Sat: 09:00 - 19:00" })] })] }) })] }));
}
export default App;
