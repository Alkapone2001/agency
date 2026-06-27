export interface AgencyInfo {
  name: string;
  tagline: string;
  about: string;
  heroCta: string;
}

export interface Offer {
  id: string;
  title: string;
  description: string;
  state: string;
  durationDays: number;
  price: number;
  createdAt: string;
  updatedAt: string;
}

export interface OfferInput {
  title: string;
  description: string;
  state: string;
  durationDays: number;
  price: number;
}

export type ChatSender = 'client' | 'admin';

export interface ChatMessage {
  id: string;
  threadId: string;
  offerId: string;
  clientId: string;
  clientName: string;
  sender: ChatSender;
  text: string;
  createdAt: string;
}

export interface ChatThread {
  id: string;
  offerId: string;
  offerTitle: string;
  clientId: string;
  clientName: string;
  lastMessageAt: string;
  messages: ChatMessage[];
}

export interface ChatMessageInput {
  clientId: string;
  clientName: string;
  sender: ChatSender;
  text: string;
}
