export interface TelegramLoginConfiguration { readonly available: boolean; readonly botUsername?: string }
export interface TelegramLoginStart { readonly id: string; readonly botUrl: string; readonly code: string; readonly expiresAt: string }
export interface TelegramLoginStatus { readonly status: "PENDING" | "BOT_SEEN" | "APPROVED" | "DENIED" | "EXPIRED" | "CONSUMED" }
export interface TelegramAccountConnection { readonly available: boolean; readonly connected: boolean; readonly username?: string }
