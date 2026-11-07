import { signal } from '@preact/signals';

export type LegalPage = 'privacy' | 'terms' | 'sources';
export const legalPage = signal<LegalPage | null>(null);
