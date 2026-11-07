import { signal } from '@preact/signals';

/** Hex of the flight whose "Alert me" sheet is open. */
export const alertSheetFor = signal<string | null>(null);

export function openAlertSheet(hex: string) {
  alertSheetFor.value = hex;
}
