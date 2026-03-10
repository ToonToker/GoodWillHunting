export interface LoginResponse {
  token?: string;
  jwt?: string;
  isSuccess?: boolean;
  message?: string;
}

export interface FavoriteItem {
  itemId: number;
  title?: string;
  notes?: string;
  endTime: string;
  currentPrice?: number;
  minimumBid?: number;
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

export interface LiveTarget {
  max_bid: number;
}

export interface TrackedAuction {
  itemId: number;
  endTimeMs: number;
  maxBid: number;
  currentPrice: number;
  title: string;
}
