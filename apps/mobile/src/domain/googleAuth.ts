import type { z } from 'zod';
import { googleAuthCapabilitiesV2Schema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStateSchema, googleLinkStatusSchema } from '@/domain/apiSchemas';

// Start and status share the server-owned receipt contract, including the
// reauthentication signal on a replay whose authorization URL is withheld.
export { googleAuthCapabilitiesV2Schema as googleAuthCapabilitiesSchema, googleLinkStartBodySchema, googleLinkStartSchema, googleLinkStateSchema, googleLinkStatusSchema };
export type GoogleAuthCapabilities = z.infer<typeof googleAuthCapabilitiesV2Schema>;
export type GoogleLinkStart = z.infer<typeof googleLinkStartSchema>;
export type GoogleLinkStatus = z.infer<typeof googleLinkStatusSchema>;
export type GoogleLinkStartBody = z.infer<typeof googleLinkStartBodySchema>;
