import type { z } from 'zod';
import { generationQuoteAcceptanceSchema, generationQuoteReceiptSchema, generationQuoteRequestSchema, generationQuoteResponseSchema } from '@/domain/apiSchemas';
export type GenerationQuote = z.infer<typeof generationQuoteResponseSchema>;
export type GenerationQuoteReceipt = z.infer<typeof generationQuoteReceiptSchema>;
export type GenerationQuoteAcceptance = z.infer<typeof generationQuoteAcceptanceSchema>;
export type GenerationQuoteRequest = z.infer<typeof generationQuoteRequestSchema>;
export interface PageQuoteTarget { pageId: string; pageNumber: number; renderStyle: 'color' | 'monochrome'; }
export interface PreparedPageQuoteTarget extends PageQuoteTarget { operation: 'page_generate' | 'page_regenerate'; }
