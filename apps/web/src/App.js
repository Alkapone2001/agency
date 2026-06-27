import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
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
    durationDays: Number(form.durationDays),
    price: Number(form.price)
});
const initialOfferForm = {
    title: '',
    description: '',
    state: '',
    durationDays: 4,
    price: 400
};
const initialPanel = window.location.pathname.startsWith('/admin') ? 'admin' : 'client';
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
    const [selectedOfferId, setSelectedOfferId] = useState('');
    const [clientId] = useState(() => getClientId());
    const [clientName, setClientName] = useState(() => getClientName());
    const [clientChatInput, setClientChatInput] = useState('');
    const [clientThread, setClientThread] = useState(null);
    const [adminKeyInput, setAdminKeyInput] = useState(() => window.localStorage.getItem('agency-admin-key') ?? '');
    const [adminKey, setAdminKey] = useState(() => window.localStorage.getItem('agency-admin-key') ?? '');
    const [adminLoggedIn, setAdminLoggedIn] = useState(false);
    const [offerForm, setOfferForm] = useState(initialOfferForm);
    const [editingOfferId, setEditingOfferId] = useState(null);
    const [adminThreads, setAdminThreads] = useState([]);
    const [activeAdminThreadId, setActiveAdminThreadId] = useState('');
    const [adminReply, setAdminReply] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const selectedOffer = useMemo(() => offers.find((offer) => offer.id === selectedOfferId) ?? null, [offers, selectedOfferId]);
    const activeAdminThread = useMemo(() => adminThreads.find((thread) => thread.id === activeAdminThreadId) ?? null, [adminThreads, activeAdminThreadId]);
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
            const thread = await requestJson(`/api/offers/${selectedOfferId}/chats`, {
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
    return (_jsxs("main", { className: "site-shell", children: [_jsxs("header", { className: "hero-wrap", children: [_jsxs("nav", { className: "top-nav", children: [_jsx("p", { className: "brand-mark", children: "Atlas Agency" }), _jsxs("div", { className: "nav-actions", children: [_jsx("button", { type: "button", className: panel === 'client' ? 'pill active' : 'pill', onClick: () => switchPanel('client'), children: "Explore Trips" }), _jsx("button", { type: "button", className: panel === 'admin' ? 'pill active' : 'pill', onClick: () => switchPanel('admin'), children: "Admin" })] })] }), _jsxs("div", { className: "hero-content", children: [_jsxs("div", { children: [_jsx("p", { className: "hero-eyebrow", children: "Boutique Travel Operations" }), _jsx("h1", { children: agency?.name ?? 'Atlas Escape Agency' }), _jsx("p", { className: "hero-tagline", children: agency?.tagline }), _jsx("p", { className: "hero-about", children: agency?.about })] }), _jsxs("aside", { className: "hero-card", children: [_jsx("h3", { children: "Trusted By Travelers" }), _jsxs("ul", { children: [_jsx("li", { children: "Personal itinerary guidance in every offer" }), _jsx("li", { children: "Live chat with agency staff per vacation card" }), _jsx("li", { children: "Transparent pricing with state-based filters" })] })] })] })] }), error && _jsx("p", { className: "error-banner", children: error }), panel === 'client' && (_jsxs("section", { className: "layout-grid", children: [_jsxs("article", { className: "glass-panel", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: agency?.heroCta ?? 'Find your next state getaway' }), _jsx("p", { children: "Filter, compare, and chat with the agency before choosing your package." })] }), _jsxs("div", { className: "field-grid", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "clientName", children: "Your name" }), _jsx("input", { id: "clientName", value: clientName, onChange: (event) => setClientName(event.target.value), placeholder: "Type your name" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "stateFilter", children: "State filter" }), _jsx("select", { id: "stateFilter", value: stateFilter, onChange: (event) => setStateFilter(event.target.value), children: states.map((stateName) => (_jsx("option", { value: stateName, children: stateName }, stateName))) })] })] }), _jsx("div", { className: "offer-grid", children: filteredOffers.map((offer) => (_jsxs("article", { className: "offer-tile", children: [_jsx("h3", { children: offer.title }), _jsx("p", { children: offer.description }), _jsxs("div", { className: "chips", children: [_jsx("span", { children: offer.state }), _jsxs("span", { children: [offer.durationDays, " days"] }), _jsxs("span", { children: ["$", offer.price] })] }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { type: "button", onClick: () => setSelectedOfferId(offer.id), children: "Chat For This Offer" }), _jsx("button", { type: "button", className: "ghost", onClick: () => startEdit(offer), children: "Open In Admin" })] })] }, offer.id))) })] }), _jsxs("article", { className: "glass-panel chat-panel", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Live Chat" }), _jsx("p", { children: selectedOffer
                                            ? `Conversation about ${selectedOffer.title}`
                                            : 'Select an offer card to start chatting.' })] }), _jsx("div", { className: "chat-log", children: (clientThread?.messages ?? []).map((message) => (_jsxs("div", { className: message.sender === 'admin' ? 'bubble admin' : 'bubble client', children: [_jsx("p", { children: message.text }), _jsxs("small", { children: [message.sender, " \u2022 ", new Date(message.createdAt).toLocaleTimeString()] })] }, message.id))) }), _jsxs("div", { className: "chat-compose", children: [_jsx("input", { value: clientChatInput, onChange: (event) => setClientChatInput(event.target.value), placeholder: "Write a message to the agency", disabled: !selectedOfferId }), _jsx("button", { type: "button", onClick: () => void sendClientMessage(), disabled: !selectedOfferId, children: "Send" })] })] })] })), panel === 'admin' && !adminLoggedIn && (_jsx("section", { className: "admin-login-wrap", children: _jsxs("article", { className: "glass-panel admin-login-card", children: [_jsx("h2", { children: "Admin Login" }), _jsx("p", { children: "Access is restricted. Enter your admin key to manage offers and client chats." }), _jsx("input", { type: "password", value: adminKeyInput, onChange: (event) => setAdminKeyInput(event.target.value), placeholder: "Enter ADMIN_DASHBOARD_KEY" }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { type: "button", onClick: () => void loginAdmin(), disabled: busy, children: "Sign In" }), _jsx("button", { type: "button", className: "ghost", onClick: () => switchPanel('client'), children: "Back to Landing" })] })] }) })), panel === 'admin' && adminLoggedIn && (_jsxs("section", { className: "layout-grid admin-layout", children: [_jsxs("article", { className: "glass-panel", children: [_jsxs("div", { className: "section-head split", children: [_jsxs("div", { children: [_jsx("h2", { children: editingOfferId ? 'Update Offer' : 'Create Offer' }), _jsx("p", { children: "Keep your catalog fresh and aligned with client demand." })] }), _jsx("button", { type: "button", className: "ghost", onClick: logoutAdmin, children: "Log out" })] }), _jsxs("div", { className: "form-grid", children: [_jsx("input", { placeholder: "Offer title", value: offerForm.title, onChange: (event) => setOfferForm({ ...offerForm, title: event.target.value }) }), _jsx("input", { placeholder: "State", value: offerForm.state, onChange: (event) => setOfferForm({ ...offerForm, state: event.target.value }) }), _jsx("textarea", { placeholder: "Offer description", value: offerForm.description, onChange: (event) => setOfferForm({ ...offerForm, description: event.target.value }) }), _jsxs("div", { className: "field-grid two", children: [_jsx("input", { type: "number", min: 1, placeholder: "Duration days", value: offerForm.durationDays, onChange: (event) => setOfferForm({
                                                    ...offerForm,
                                                    durationDays: Number(event.target.value)
                                                }) }), _jsx("input", { type: "number", min: 1, placeholder: "Price", value: offerForm.price, onChange: (event) => setOfferForm({
                                                    ...offerForm,
                                                    price: Number(event.target.value)
                                                }) })] }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { type: "button", onClick: () => void saveOffer(), disabled: busy, children: editingOfferId ? 'Update Offer' : 'Create Offer' }), editingOfferId && (_jsx("button", { type: "button", className: "ghost", onClick: resetOfferForm, children: "Cancel" }))] })] }), _jsx("h3", { children: "Offer Inventory" }), _jsx("div", { className: "offer-grid compact", children: offers.map((offer) => (_jsxs("article", { className: "offer-tile", children: [_jsx("h4", { children: offer.title }), _jsx("p", { children: offer.state }), _jsxs("div", { className: "row-actions", children: [_jsx("button", { type: "button", onClick: () => startEdit(offer), children: "Edit" }), _jsx("button", { type: "button", className: "danger", onClick: () => void deleteOffer(offer.id), children: "Delete" })] })] }, offer.id))) })] }), _jsxs("article", { className: "glass-panel chat-panel", children: [_jsxs("div", { className: "section-head", children: [_jsx("h2", { children: "Client Threads" }), _jsx("p", { children: "Each client+offer creates a dedicated conversation channel." })] }), _jsx("div", { className: "thread-list", children: adminThreads.map((thread) => (_jsxs("button", { type: "button", className: thread.id === activeAdminThreadId ? 'thread active' : 'thread', onClick: () => setActiveAdminThreadId(thread.id), children: [_jsx("strong", { children: thread.clientName }), _jsx("span", { children: thread.offerTitle })] }, thread.id))) }), _jsx("div", { className: "chat-log", children: (activeAdminThread?.messages ?? []).map((message) => (_jsxs("div", { className: message.sender === 'admin' ? 'bubble admin' : 'bubble client', children: [_jsx("p", { children: message.text }), _jsxs("small", { children: [message.sender, " \u2022 ", new Date(message.createdAt).toLocaleTimeString()] })] }, message.id))) }), _jsxs("div", { className: "chat-compose", children: [_jsx("input", { value: adminReply, onChange: (event) => setAdminReply(event.target.value), placeholder: "Reply to selected client", disabled: !activeAdminThread }), _jsx("button", { type: "button", onClick: () => void sendAdminReply(), disabled: !activeAdminThread, children: "Reply" })] })] })] }))] }));
}
export default App;
