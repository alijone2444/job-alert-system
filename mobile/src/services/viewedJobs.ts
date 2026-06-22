import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'viewed_job_ids';

/** Load the set of job IDs the user has already opened. */
export async function loadViewed(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set<string>();
  }
}

/** Persist the viewed set (keep it bounded so it can't grow forever). */
export async function saveViewed(ids: Set<string>): Promise<void> {
  try {
    const arr = [...ids].slice(-500);
    await AsyncStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    // ignore storage errors
  }
}
