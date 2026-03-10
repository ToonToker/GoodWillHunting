export interface AccountCredential {
  id: string;
  username: string;
  password: string;
}

export interface AccountSession {
  accountId: string;
  username: string;
  password: string;
  token: string;
  tokenRefreshedAt: number;
}

export interface LoginResponse {
  token?: string;
  jwt?: string;
  isSuccess?: boolean;
  message?: string;
}

export interface FavoriteItem {
  itemId?: number | string;
  ItemId?: number | string;
  endTime?: string;
  EndTime?: string;
  notes?: string;
  Notes?: string;
  title?: string;
  currentPrice?: number;
}

export interface FavoriteResponse {
  isSuccess?: boolean;
  data?: FavoriteItem[];
  items?: FavoriteItem[];
  message?: string;
}

export interface PlaceBidResult {
  isSuccess: boolean;
  message?: string;
  minimumNextBid?: number;
}

export interface LiveTargetNote {
  max: number;
}

export interface TrackedAuction {
  accountId: string;
  itemId: number;
  endTimeMs: number;
  maxBid: number;
}
