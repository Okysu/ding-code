import { createI18n } from 'vue-i18n';
import en from './en-US';
import zh from './zh-CN';
import { normalizeLocale } from '../../../../shared/types';
const fragment = new URLSearchParams(location.hash.slice(1));
export const initialLocale = normalizeLocale(
  localStorage.getItem('ding-code.locale') ??
    window.__DING_BOOT__?.locale ??
    fragment.get('locale') ??
    navigator.language,
);
export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en-US',
  messages: { 'en-US': en, 'zh-CN': zh },
});
