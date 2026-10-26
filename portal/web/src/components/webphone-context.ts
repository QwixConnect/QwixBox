import { createContext, useContext } from "react";

export interface WebphoneContextValue {
	opened: boolean;
	openKeypad: (prefillNumber?: string, prefillName?: string) => void;
	startCall: (number: string, name?: string) => void;
	close: () => void;
	inCall: boolean;
}

/**
 * The browser phone is a UI simulation: a call timer with no SIP client behind it (I23). It used
 * to be reachable in production from the header keypad and click-to-call buttons, so a user could
 * believe a call had been placed. The provider is now mounted only in mock mode, and outside it
 * this is null - so every call site has to handle "there is no phone" to typecheck, rather than
 * rendering a button that silently does nothing. When a real client exists, provide it here.
 */
export const WebphoneContext = createContext<WebphoneContextValue | null>(null);

export function useWebphone(): WebphoneContextValue | null {
	return useContext(WebphoneContext);
}
