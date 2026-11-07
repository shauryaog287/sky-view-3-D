import { signal } from '@preact/signals';
import type { AlertRecord } from '../../shared/apiTypes';
import { api } from '../api';

/** Hex of the flight whose "Alert me" sheet is open. */
export const alertSheetFor = signal<string | null>(null);
/** This device's alerts (server list, or local list in mock mode). */
export const myAlerts = signal<AlertRecord[]>([]);

export function openAlertSheet(hex: string) {
  alertSheetFor.value = hex;
  void refreshAlerts();
}

export async function refreshAlerts() {
  try {
    myAlerts.value = await api.listAlerts();
  } catch {
    /* keep the old list */
  }
}
