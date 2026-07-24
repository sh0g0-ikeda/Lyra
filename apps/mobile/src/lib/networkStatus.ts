export interface NetworkReachability {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export function normalizeNetworkOnline(state: NetworkReachability): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}
