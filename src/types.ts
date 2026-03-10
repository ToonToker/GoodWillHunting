export interface AccountCredential {
  id: string;
  username: string;
  password: string;
}

export interface AccountSession {
  id: string;
  username: string;
  password: string;
  token: string;
  refreshedAt: number;
}

export interface LoginResponse {
  isSuccess?: boolean;
  message?: string;
  token?: string;
  jwt?: string;
}

export interface FavoriteItem {
  itemId?: number | string;
  ItemId?: number | string;
  sellerId?: number | string;
  SellerID?: number | string;
  endTime?: string;
  EndTime?: string;
  notes?: string;
  Notes?: string;
  title?: string;
  currentPrice?: number;
  minimumBid?: number;
}

export interface FavoriteResponse {
  data?: FavoriteItem[];
  items?: FavoriteItem[];
}

export interface PlaceBidResult {
  isSuccess: boolean;
  message?: string;
  minimumNextBid?: number;
}

export interface LiveTarget {
  accountId: string;
  itemId: number;
  sellerId: number;
  title: string;
  maxBid: number;
  endTimeMs: number;
  status: string;
  lastBid?: number;
}

export interface BidPayload {
  itemId: number;
  sellerId: number;
  bidAmount: number;
  bidType: 1;
}

export interface SessionStore {
  updatedAt: string;
  sessions: Array<{ id: string; token: string; refreshedAt: number }>;
}
