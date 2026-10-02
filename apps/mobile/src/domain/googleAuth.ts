import type { z } from 'zod';
import { googleAuthCapabilitiesSchema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStateSchema, googleLinkStatusSchema } from '@/domain/apiSchemas';

// Start and status share the server-owned receipt contract, including the
// reauthentication signal on a replay whose authorization URL is withheld.
export { googleAuthCapabilitiesSchema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStateSchema, googleLinkStatusSchema };
export type GoogleAuthCapabilities = z.infer<typeof googleAuthCapabilitiesSchema>;
export type GoogleLinkStart = z.infer<typeof googleLinkStartSchema>;
export type GoogleLinkStatus = z.infer<typeof googleLinkStatusSchema>;
export type GoogleLinkStartBody = z.infer<typeof googleLinkStartBodySchema>;
